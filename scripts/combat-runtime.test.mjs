import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMBAT_STEP as H } from "../src/combat-core.js";

// Exercise the actual runtime with its real core, controls and capsule solver.
// Node cannot import CSS and needs no GPU: replace only the visual constructor
// and stylesheet import, then resolve remaining imports against the source file.
const runtimeURL = new URL("../src/combat-runtime.js", import.meta.url);
let source = await readFile(runtimeURL, "utf8");
const viewImport =
  /import\s*\{\s*createCombatView\s*\}\s*from\s*["']\.\/combat-view\.js["'];?/;
const cssImport = /import\s*["']\.\/combat\.css["'];?/;
assert.match(
  source,
  viewImport,
  "runtime fixture must replace the real view import",
);
assert.match(
  source,
  cssImport,
  "runtime fixture must replace the stylesheet import",
);
source = source
  .replace(
    viewImport,
    "const createCombatView = () => ({update(){}, dispose(){}});",
  )
  .replace(cssImport, "")
  .replace(
    /from\s*(["'])(\.\/[^"']+)\1/g,
    (_, quote, relative) =>
      `from ${JSON.stringify(new URL(relative, runtimeURL).href)}`,
  );
const { createCombatRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const KEY = "komorebi.combat.v1";
const movement = { grounded: true, moveX: 0, moveZ: 0 };
const documentOwners = new WeakSet();
function fixture(t, options = {}) {
  const priorDocument = globalThis.document;
  const nodes = new Map();
  const panel = {
    setAttribute() {},
    classList: { toggle() {} },
    remove() {},
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {});
      return nodes.get(selector);
    },
  };
  globalThis.document = {
    createElement: () => panel,
    querySelector: () => ({ append() {} }),
  };
  // Multiple reload fixtures in one test share one global restoration hook.
  if (!documentOwners.has(t)) {
    documentOwners.add(t);
    t.after(() => {
      if (priorDocument === undefined) delete globalThis.document;
      else globalThis.document = priorDocument;
    });
  }
  const records = new Map();
  if (options.raw !== undefined) records.set(KEY, options.raw);
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem(key, value) {
      if (options.writeDenied) throw new Error("Storage denied");
      records.set(key, value);
    },
  };
  const player = {
    position: {
      x: 60,
      y: 0,
      z: 60,
      set(x, y, z) {
        Object.assign(this, { x, y, z });
      },
    },
    rotation: { y: options.facing ?? 0 },
  };
  const notices = [],
    respawns = [];
  const runtime = createCombatRuntime(
    {},
    {},
    player,
    options.height ?? (() => 0),
    storage,
    (message) => notices.push(message),
    () => {
      respawns.push({
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      });
      options.onRespawn?.();
    },
  );
  t.after(() => runtime.dispose());
  return { runtime, player, records, nodes, notices, respawns };
}
function step(f, dt = H, keys = new Set(), move = movement) {
  return f.runtime.step(dt, keys, null, move);
}
function advance(f, seconds, move = movement) {
  let state;
  for (let i = 0; i < Math.round(seconds / H); i++)
    state = step(f, H, new Set(), move);
  return state;
}
function tap(f, code) {
  f.runtime.keyDown(code);
  f.runtime.keyUp(code);
}
function engage(f, facing = Math.PI) {
  f.player.position.set(-16, 0, -30.4);
  f.player.rotation.y = facing;
}

test("runtime F1 same-frame F+J turns before dispatch and hits the locked target", (t) => {
  const f = fixture(t);
  engage(f);
  tap(f, "KeyF");
  tap(f, "KeyJ");
  const started = step(f);
  assert.equal(started.targetId, "warden-cedar");
  assert.equal(f.player.rotation.y, 0);
  assert.equal(started.player.action, "light1");
  assert.equal(advance(f, 0.2).enemies[0].health, 72);
});

test("runtime F1 locomotion turn+J captures intended facing before the hit", (t) => {
  const f = fixture(t);
  engage(f);
  tap(f, "KeyJ");
  step(f, H, new Set(), { ...movement, moveZ: 1 });
  assert.equal(f.player.rotation.y, 0);
  assert.equal(
    advance(f, 0.2, { ...movement, moveZ: 1 }).enemies[0].health,
    72,
  );
});

test("runtime F1 swing facing stays frozen through startup, active and recovery", (t) => {
  const f = fixture(t);
  engage(f, 0);
  tap(f, "KeyJ");
  step(f);
  const turnAway = { ...movement, moveZ: -1 };
  let state = advance(f, 0.04, turnAway);
  assert.equal(state.player.phase, "startup");
  assert.equal(f.player.rotation.y, 0);
  state = advance(f, 0.1, turnAway);
  assert.equal(state.player.phase, "active");
  assert.equal(f.player.rotation.y, 0);
  assert.equal(state.enemies[0].health, 72);
  state = advance(f, 0.12, turnAway);
  assert.equal(state.player.phase, "recovery");
  assert.equal(f.player.rotation.y, 0);
  advance(f, 0.3, turnAway);
  assert.equal(f.player.rotation.y, Math.PI);
});

test("runtime F2 complete tap between samples survives and hits once", (t) => {
  const f = fixture(t);
  engage(f, 0);
  tap(f, "KeyJ");
  assert.equal(step(f, H / 2).player.action, "idle");
  assert.equal(step(f, H / 2).player.action, "light1");
  const state = advance(f, 0.3);
  assert.equal(state.enemies[0].health, 72);
  assert.equal(state.player.stamina, 90);
});

test("runtime F2 release/repress between frames starts buffered light2", (t) => {
  const f = fixture(t);
  f.runtime.keyDown("KeyJ");
  step(f);
  advance(f, 0.3);
  f.runtime.keyUp("KeyJ");
  f.runtime.keyDown("KeyJ");
  step(f);
  assert.equal(advance(f, 0.2).player.action, "light2");
});

test("runtime heavy hold/release comes from sampler, including latched release", (t) => {
  const f = fixture(t);
  f.runtime.keyDown("KeyK");
  assert.equal(step(f).player.action, "charging");
  advance(f, 0.7);
  f.runtime.keyUp("KeyK");
  f.runtime.keyDown("KeyK");
  const state = step(f);
  assert.equal(state.player.action, "charged");
  assert.equal(state.player.stamina, 68);
});

test("runtime quick heavy tap produces ordinary heavy rather than charge", (t) => {
  const f = fixture(t);
  tap(f, "KeyK");
  assert.equal(step(f).player.action, "heavy");
});

test("runtime respawn invokes engine reset after teleport and preserves defeated IDs", (t) => {
  let vy = 6,
    grounded = false;
  const f = fixture(t, {
    height: () => 3,
    onRespawn() {
      vy = 0;
      grounded = true;
    },
  });
  assert.equal(
    f.runtime.core.restore({
      version: 1,
      health: 0,
      stamina: 4,
      defeatedIds: ["warden-cedar"],
    }),
    true,
  );
  f.runtime.keyDown("KeyJ");
  const state = f.runtime.respawn();
  assert.equal(vy, 0);
  assert.equal(grounded, true);
  assert.deepEqual(f.respawns, [{ x: 5, y: 3, z: 16 }]);
  assert.equal(state.player.health, 100);
  assert.deepEqual(state.defeatedIds, ["warden-cedar"]);
  assert.equal(
    step(f).player.action,
    "idle",
    "respawn must clear pending input",
  );
  assert.equal(JSON.parse(f.records.get(KEY)).health, 100);
});

test("runtime dead Space respawn invokes callback once and refreshes grounded state", (t) => {
  const f = fixture(t);
  f.runtime.core.restore({
    version: 1,
    health: 0,
    stamina: 0,
    defeatedIds: [],
  });
  step(f);
  const heldSpace = new Set(["Space"]);
  const state = step(f, H, heldSpace, { grounded: false, moveX: 1, moveZ: 1 });
  assert.equal(state.player.health, 100);
  assert.equal(f.respawns.length, 1);
  assert.deepEqual(f.respawns[0], { x: 5, y: 0, z: 16 });
  step(f, H, heldSpace);
  assert.equal(f.respawns.length, 1);
});

test("runtime HUD respawn uses the same engine callback", (t) => {
  const f = fixture(t);
  f.nodes.get("#respawn").onclick();
  assert.equal(f.respawns.length, 1);
  assert.equal(f.runtime.state.player.health, 100);
});

test("runtime malformed JSON is repaired and health survives a new core load", (t) => {
  const f = fixture(t, { raw: "{bad json" });
  f.runtime.core.restore({
    version: 1,
    health: 73,
    stamina: 41,
    defeatedIds: [],
  });
  assert.equal(f.runtime.save(), true);
  const repaired = JSON.parse(f.records.get(KEY));
  assert.deepEqual(repaired, {
    version: 1,
    health: 73,
    stamina: 41,
    defeatedIds: [],
  });
  const loaded = fixture(t, { raw: f.records.get(KEY) });
  assert.equal(loaded.runtime.state.player.health, 73);
  assert.equal(loaded.runtime.state.player.stamina, 41);
});

test("runtime write-denied storage returns false without discarding live state", (t) => {
  const f = fixture(t, { writeDenied: true });
  f.runtime.core.restore({
    version: 1,
    health: 62,
    stamina: 22,
    defeatedIds: [],
  });
  assert.equal(f.runtime.save(), false);
  assert.equal(f.runtime.core.serialize().health, 62);
  assert.equal(f.records.has(KEY), false);
});

test("runtime save unions valid defeated IDs from concurrent storage", (t) => {
  const f = fixture(t);
  f.runtime.core.restore({
    version: 1,
    health: 73,
    stamina: 41,
    defeatedIds: ["warden-cedar"],
  });
  f.records.set(
    KEY,
    JSON.stringify({
      version: 1,
      health: 100,
      stamina: 100,
      defeatedIds: ["warden-stream", "warden-stream", "unknown"],
    }),
  );
  assert.equal(f.runtime.save(), true);
  const saved = JSON.parse(f.records.get(KEY));
  assert.deepEqual(
    new Set(saved.defeatedIds),
    new Set(["warden-cedar", "warden-stream"]),
  );
  assert.equal(saved.defeatedIds.length, 2);
  assert.equal(saved.health, 73);
  const loaded = fixture(t, { raw: f.records.get(KEY) });
  assert.equal(loaded.runtime.state.enemies[0].health, 0);
  assert.equal(loaded.runtime.state.enemies[1].health, 0);
});

test("runtime resetInputs clears unsampled taps and held guard", (t) => {
  const f = fixture(t);
  tap(f, "KeyJ");
  f.runtime.keyDown("KeyQ");
  f.runtime.resetInputs();
  const state = step(f);
  assert.equal(state.player.action, "idle");
  assert.equal(state.player.guarding, false);
});
