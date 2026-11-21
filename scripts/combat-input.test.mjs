import { test } from "node:test";
import assert from "node:assert/strict";
import { createCombatControls } from "../src/combat-input.js";
import { createCombat, COMBAT_STEP } from "../src/combat-core.js";
const pad = (indices) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: indices.includes(i),
  })),
});
for (const [action, key, button] of [
  ["light", "KeyJ", 5],
  ["heavy", "KeyK", 4],
  ["dodge", "AltLeft", 1],
  ["lock", "KeyF", 11],
]) {
  test(`${action} keyboard edge and release`, () => {
    const c = createCombatControls();
    assert(c.sample(new Set([key]))[action]);
    assert.equal(c.sample(new Set([key]))[action], false);
    c.sample(new Set());
    assert(c.sample(new Set([key]))[action]);
  });
  test(`${action} Xbox edge and release`, () => {
    const c = createCombatControls();
    assert(c.sample(new Set(), pad([button]))[action]);
    assert.equal(c.sample(new Set(), pad([button]))[action], false);
    c.sample(new Set(), pad([]));
    assert(c.sample(new Set(), pad([button]))[action]);
  });
}
test("guard remains held on keyboard and Xbox", () => {
  const c = createCombatControls();
  assert(c.sample(new Set(["KeyQ"])).guard);
  assert(c.sample(new Set(["KeyQ"])).guard);
  assert(c.sample(new Set(), pad([6])).guard);
  assert.equal(c.sample(new Set(), pad([])).guard, false);
});
test("Xbox RT sprint does not trigger combat", () => {
  assert.deepEqual(createCombatControls().sample(new Set(), pad([7])), {
    light: false,
    heavy: false,
    dodge: false,
    guard: false,
    lock: false,
    heavyHeld: false,
    heavyRelease: false,
  });
});
test("input disconnect releases edges for reconnect", () => {
  const c = createCombatControls();
  c.sample(new Set(), pad([5]));
  c.sample(new Set());
  assert(c.sample(new Set(), pad([5])).light);
});
test("reset releases latched attacks", () => {
  const c = createCombatControls();
  c.sample(new Set(["KeyJ"]));
  c.reset();
  assert(c.sample(new Set(["KeyJ"])).light);
});

for (const [action, code] of [
  ["light", "KeyJ"],
  ["heavy", "KeyK"],
  ["dodge", "AltLeft"],
  ["dodge", "AltRight"],
  ["lock", "KeyF"],
]) {
  test(`${action} retains a complete keyboard tap between samples`, () => {
    const c = createCombatControls();
    c.sample();
    c.keyDown(code);
    c.keyUp(code);
    assert.equal(c.sample()[action], true);
    assert.equal(c.sample()[action], false);
  });
}

test("release and repress between samples rearms a combo edge", () => {
  const c = createCombatControls();
  c.keyDown("KeyJ");
  assert.equal(c.sample().light, true);
  c.keyUp("KeyJ");
  c.keyDown("KeyJ");
  assert.equal(c.sample().light, true);
  assert.equal(c.sample().light, false);
});

test("event-held keys and key repeat produce only one press", () => {
  const c = createCombatControls();
  c.keyDown("KeyJ");
  assert.equal(c.sample(new Set(["KeyJ"])).light, true);
  c.keyDown("KeyJ");
  assert.equal(c.sample().light, false);
  c.keyUp("KeyJ");
  c.keyDown("KeyJ");
  assert.equal(c.sample().light, true);
});

test("guard follows held state and retains a quick tap for one parry sample", () => {
  const c = createCombatControls();
  c.keyDown("KeyQ");
  assert.equal(c.sample().guard, true);
  assert.equal(c.sample().guard, true);
  c.keyUp("KeyQ");
  assert.equal(c.sample().guard, false);
  c.keyDown("KeyQ");
  c.keyUp("KeyQ");
  assert.equal(c.sample().guard, true);
  assert.equal(c.sample().guard, false);
});

test("heavy tap retains both edges with final released level", () => {
  const c = createCombatControls();
  c.keyDown("KeyK");
  c.keyUp("KeyK");
  const input = c.sample();
  assert.equal(input.heavy, true);
  assert.equal(input.heavyHeld, false);
  assert.equal(input.heavyRelease, true);
  assert.equal(c.sample().heavyRelease, false);
});

test("heavy release and repress is retained even while final level is held", () => {
  const c = createCombatControls();
  c.keyDown("KeyK");
  let input = c.sample();
  assert.equal(input.heavy, true);
  assert.equal(input.heavyHeld, true);
  assert.equal(input.heavyRelease, false);
  c.keyUp("KeyK");
  c.keyDown("KeyK");
  input = c.sample();
  assert.equal(input.heavy, true);
  assert.equal(input.heavyHeld, true);
  assert.equal(input.heavyRelease, true);
  assert.equal(c.sample().heavyRelease, false);
});

test("polling-only keyboard and Xbox hold/release retain compatibility", () => {
  for (const [keys, controller] of [
    [new Set(["KeyK"]), undefined],
    [new Set(), pad([4])],
  ]) {
    const c = createCombatControls();
    assert.equal(c.sample(keys, controller).heavyHeld, true);
    const held = c.sample(keys, controller);
    assert.equal(held.heavy, false);
    assert.equal(held.heavyHeld, true);
    assert.equal(held.heavyRelease, false);
    const released = c.sample(new Set(), pad([]));
    assert.equal(released.heavyHeld, false);
    assert.equal(released.heavyRelease, true);
    assert.equal(c.sample().heavyRelease, false);
  }
});

test("releasing keyboard K while Xbox LB is held does not release charge", () => {
  const c = createCombatControls();
  c.keyDown("KeyK");
  c.sample(new Set(), pad([4]));
  c.keyUp("KeyK");
  const input = c.sample(new Set(), pad([4]));
  assert.equal(input.heavyHeld, true);
  assert.equal(input.heavyRelease, false);
  assert.equal(c.sample(new Set(), pad([])).heavyRelease, true);
});

test("reset for blur clears held keyboard, press and release latches", () => {
  const c = createCombatControls();
  c.keyDown("KeyQ");
  c.keyDown("KeyJ");
  c.keyDown("KeyK");
  c.keyUp("KeyK");
  c.keyDown("KeyK");
  c.reset();
  assert.deepEqual(c.sample(), {
    light: false, heavy: false, dodge: false, guard: false, lock: false,
    heavyHeld: false, heavyRelease: false,
  });
  c.keyDown("KeyJ");
  assert.equal(c.sample().light, true);
});

test("unknown keys and duplicate releases cannot synthesize combat edges", () => {
  const c = createCombatControls();
  c.keyDown("Space");
  c.keyDown("KeyW");
  c.keyUp("KeyK");
  c.keyUp("KeyK");
  const input = c.sample();
  assert.equal(Object.values(input).some(Boolean), false);
});

test("a latched tap survives a zero-tick frame and is consumed once by core", () => {
  const c = createCombatControls();
  const core = createCombat({ enemies: [], ai: false });
  const position = { x: 0, y: 0, z: 0, grounded: true };
  c.keyDown("KeyJ");
  c.keyUp("KeyJ");
  let state = core.update(COMBAT_STEP / 2, c.sample(), position);
  assert.equal(state.player.action, "idle");
  state = core.update(COMBAT_STEP / 2, c.sample(), position);
  assert.equal(state.player.action, "light1");
  assert.equal(state.player.stamina, 90);
  assert.equal(state.events.filter(e => e.type === "attack").length, 1);
  state = core.update(.7, c.sample(), position);
  assert.equal(state.player.action, "idle");
  assert.equal(state.events.some(e => e.type === "attack"), false);
});

test("latched heavy release ends charge after a zero-tick frame", () => {
  const c = createCombatControls();
  const core = createCombat({ enemies: [], ai: false });
  const position = { x: 0, y: 0, z: 0, grounded: true };
  c.keyDown("KeyK");
  core.update(COMBAT_STEP, c.sample(), position);
  assert.equal(core.update(.7, c.sample(), position).player.action, "charging");
  c.keyUp("KeyK");
  core.update(COMBAT_STEP / 2, c.sample(), position);
  const state = core.update(COMBAT_STEP / 2, c.sample(), position);
  assert.equal(state.player.action, "charged");
  assert.equal(state.player.stamina, 68);
});
