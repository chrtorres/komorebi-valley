import test from "node:test";
import assert from "node:assert/strict";
import { createCombat, COMBAT_STEP as H, ATTACKS } from "../src/combat-core.js";
const pos = { x: 0, y: 0, z: 0, facing: 0, grounded: true };
const spawn = { id: "test", x: 0, z: 1.8, health: 500 };
const make = (opts = {}) =>
  createCombat({ enemies: [spawn], ai: false, ...opts });
function advance(c, seconds, input = {}, p = pos) {
  let s;
  for (let i = 0; i < Math.round(seconds / H); i++) s = c.update(H, input, p);
  return s;
}
function combo(c, keys) {
  let s;
  for (let i = 0; i < keys.length; i++) {
    if (i === 0) c.update(H, { [keys[i]]: true }, pos);
    else c.update(H, { [keys[i]]: true }, pos);
    if (i < keys.length - 1) advance(c, i === 0 ? 0.3 : 0.32);
    else s = c.update(0, {}, pos);
  }
  return s;
}
test("default wardens have fixed unique IDs and positions", () => {
  assert.deepEqual(
    createCombat().update(0).enemies,
    createCombat().update(0).enemies,
  );
  assert.equal(createCombat().update(0).enemies.length, 3);
});
test("light consumes explicit stamina and has startup", () => {
  const s = make().update(H, { light: true }, pos);
  assert.equal(s.player.action, "light1");
  assert.equal(s.player.stamina, 90);
  assert.equal(s.enemies[0].health, 500);
});
test("queued attack is visible to movement until a combat tick consumes it", () => {
  const fight = make();
  assert.equal(fight.hasPendingAction, false);
  const before = fight.update(H / 2, { light: true }, pos);
  assert.equal(before.player.action, "idle");
  assert.equal(fight.hasPendingAction, true);
  const after = fight.update(H / 2, {}, pos);
  assert.equal(after.player.action, "light1");
  assert.equal(fight.hasPendingAction, false);
});
test("active swing damages each target only once", () => {
  const c = make();
  c.update(H, { light: true }, pos);
  const s = advance(c, 0.3);
  assert.equal(s.enemies[0].health, 487);
});
test("recovery cannot damage a newly entering target", () => {
  const c = make({ enemies: [{ ...spawn, z: 4 }] });
  c.update(H, { light: true }, pos);
  advance(c, 0.25);
  assert.equal(c.update(H, {}, { ...pos, z: 3 }).enemies[0].health, 500);
});
test("three buffered lights select sweep finisher", () => {
  const c = make();
  c.update(H, { light: true }, pos);
  advance(c, 0.3);
  c.update(H, { light: true }, pos);
  advance(c, 0.2);
  assert.equal(c.update(0, {}, pos).player.action, "light2");
  advance(c, 0.3);
  c.update(H, { light: true }, pos);
  assert.equal(advance(c, 0.2).player.action, "light3");
});
test("early input is discarded instead of becoming permanent buffer", () => {
  const c = make();
  c.update(H, { light: true }, pos);
  c.update(H, { light: true }, pos);
  assert.equal(advance(c, 0.6).player.action, "idle");
});
test("light heavy selects mixed finisher", () => {
  const c = make();
  combo(c, ["light", "heavy"]);
  assert.equal(advance(c, 0.2).player.action, "finisher");
});
test("heavy light selects mixed finisher", () => {
  const c = make();
  c.update(H, { heavy: true }, pos);
  advance(c, 0.7);
  c.update(H, { light: true }, pos);
  assert.equal(advance(c, 0.25).player.action, "finisher");
});
test("heavy heavy selects crusher", () => {
  const c = make();
  c.update(H, { heavy: true }, pos);
  advance(c, 0.7);
  c.update(H, { heavy: true }, pos);
  assert.equal(advance(c, 0.25).player.action, "crusher");
});
test("LLH launches with upward velocity then gravity lands", () => {
  const c = make();
  c.update(H, { light: true }, pos);
  advance(c, 0.3);
  c.update(H, { light: true }, pos);
  advance(c, 0.5);
  const follow = { ...pos, z: 1 };
  c.update(H, { heavy: true }, follow);
  const launched = advance(c, 0.34, {}, follow);
  assert.equal(launched.player.action, "launcher");
  assert.ok(launched.enemies[0].vy > 0);
  assert.ok(launched.enemies[0].y > 0);
  assert.equal(advance(c, 2).enemies[0].y, 0);
});
test("air light hits a launched enemy and caps one aerial per landing", () => {
  const c = make();
  c.update(H, { light: true }, pos);
  advance(c, 0.3);
  c.update(H, { light: true }, pos);
  advance(c, 0.5);
  const follow = { ...pos, z: 1 };
  c.update(H, { heavy: true }, follow);
  advance(c, 0.49, {}, follow);
  const air = { ...pos, y: 1.4, z: 2, grounded: false };
  c.update(H, { light: true }, air);
  const s = advance(c, 0.2, {}, air);
  assert.equal(s.player.action, "airLight");
  assert.equal(s.enemies[0].health, 425);
  assert.ok(s.enemies[0].y > 1);
  assert.ok(s.enemies[0].vy < ATTACKS.airLight.lift);
  advance(c, 0.5, {}, air);
  assert.equal(c.update(H, { light: true }, air).player.action, "idle");
  assert.equal(c.update(H, { light: true }, air).enemies[0].health, 425);
  c.update(H, {}, pos);
  assert.equal(c.update(H, { light: true }, air).player.action, "airLight");
});
test("air light has explicit cost and heavy requires ground", () => {
  const c = make();
  const air = { ...pos, y: 2, grounded: false };
  assert.equal(c.update(H, { heavy: true }, air).player.action, "idle");
  const s = c.update(H, { light: true }, air);
  assert.equal(s.player.action, "airLight");
  assert.equal(s.player.stamina, 85);
});
test("vertical hit test rejects high targets", () => {
  const c = make();
  c.update(H, { light: true }, { ...pos, y: 8, grounded: false });
  assert.equal(
    advance(c, 0.2, {}, { ...pos, y: 8, grounded: false }).enemies[0].health,
    500,
  );
});
test("range and facing arc reject behind and distant enemies", () => {
  const c = make({
    enemies: [
      { ...spawn, z: -1 },
      { ...spawn, id: "far", z: 9 },
    ],
  });
  c.update(H, { heavy: true }, pos);
  assert.deepEqual(
    advance(c, 0.5).enemies.map((e) => e.health),
    [500, 500],
  );
});
test("one swing can hit multiple distinct enemies", () => {
  const c = make({ enemies: [spawn, { ...spawn, id: "two", x: 0.3 }] });
  c.update(H, { light: true }, pos);
  assert.deepEqual(
    advance(c, 0.2).enemies.map((e) => e.health),
    [487, 487],
  );
});
test("charged heavy threshold and auto release", () => {
  const c = make();
  c.update(H, { heavy: true, heavyHeld: true }, pos);
  assert.equal(advance(c, 0.7, { heavyHeld: true }).player.action, "charging");
  assert.equal(
    c.update(H, { heavyRelease: true }, pos).player.action,
    "charged",
  );
  const d = make();
  d.update(H, { heavy: true, heavyHeld: true }, pos);
  assert.equal(advance(d, 0.92, { heavyHeld: true }).player.action, "charged");
});
test("early charge release produces ordinary heavy", () => {
  const c = make();
  c.update(H, { heavy: true, heavyHeld: true }, pos);
  advance(c, 0.2, { heavyHeld: true });
  assert.equal(c.update(H, { heavyRelease: true }, pos).player.action, "heavy");
});
test("insufficient stamina rejects attack and regeneration waits", () => {
  const c = make();
  c.restore({ version: 1, health: 100, stamina: 9, defeatedIds: [] });
  assert.equal(c.update(H, { heavy: true }, pos).player.action, "idle");
  const d = make();
  d.update(H, { heavy: true }, pos);
  assert.equal(advance(d, 0.7).player.stamina, 77);
  assert.ok(advance(d, 1).player.stamina > 77);
});
test("dodge outputs displacement once, iFrames expire and cooldown prevents repeat", () => {
  const c = make();
  let s = c.update(H, { dodge: true }, { ...pos, moveX: 1 });
  assert.ok(s.motion.dx > 0);
  assert.ok(Math.abs(s.motion.dz) < 1e-12);
  assert.equal(s.player.stamina, 78);
  assert.equal(advance(c, 0.08).player.invulnerable, true);
  assert.equal(advance(c, 0.3).player.invulnerable, false);
  advance(c, 0.08);
  assert.equal(c.update(H, { dodge: true }, pos).player.action, "idle");
});
test("airborne dodge is rejected", () => {
  assert.equal(
    make().update(H, { dodge: true }, { ...pos, grounded: false, y: 3 }).player
      .action,
    "idle",
  );
});
const ai = () => make({ ai: true });
test("AI telegraphs then strikes once and recovers", () => {
  const c = ai();
  assert.equal(c.update(H, {}, pos).enemies[0].phase, "telegraph");
  let s = advance(c, 0.68);
  assert.equal(s.player.health, 82);
  s = advance(c, 0.2);
  assert.equal(s.enemies[0].phase, "recover");
  assert.equal(s.player.health, 82);
  assert.ok(s.motion.dz < 0);
});
test("timed parry prevents damage and stuns attacker", () => {
  const c = ai();
  advance(c, 0.57);
  const s = advance(c, 0.12, { guard: true });
  assert.equal(s.player.health, 100);
  assert.equal(s.enemies[0].phase, "hitstun");
});
test("held guard outside parry window reduces damage and spends stamina", () => {
  const c = ai();
  const s = advance(c, 0.7, { guard: true });
  assert.equal(s.player.health, 96);
  assert.equal(s.player.stamina, 84);
});
test("guard facing away takes full damage", () => {
  const c = ai();
  assert.equal(
    advance(c, 0.7, { guard: true }, { ...pos, facing: Math.PI }).player.health,
    82,
  );
});
test("exhausted guard breaks and takes full damage", () => {
  const c = ai();
  c.restore({ version: 1, health: 100, stamina: 0, defeatedIds: [] });
  const s = advance(c, 0.7, { guard: true });
  assert.equal(s.player.health, 82);
  assert.equal(s.player.action, "hitstun");
});
test("dodge iFrames evade an otherwise connecting strike", () => {
  const c = ai();
  advance(c, 0.55);
  c.update(H, { dodge: true }, pos);
  assert.equal(advance(c, 0.16).player.health, 100);
});
test("enemy approach respects configurable aggro range", () => {
  const c = make({ ai: true, aggroRange: 1 });
  assert.equal(advance(c, 1).enemies[0].phase, "idle");
  const d = make({ ai: true, enemies: [{ ...spawn, z: 5 }], aggroRange: 8 });
  assert.ok(advance(d, 0.5).enemies[0].z < 5);
});
test("telegraph locks facing; leaving range avoids strike", () => {
  const c = ai();
  advance(c, 0.3);
  assert.equal(advance(c, 0.4, {}, { ...pos, z: -10 }).player.health, 100);
});
test("knockback inertia decays and terrain resolves landing", () => {
  const c = make({ height: () => 2 });
  const p2 = { ...pos, y: 2 };
  c.update(H, { heavy: true }, p2);
  const a = advance(c, 0.4, {}, p2).enemies[0];
  assert.ok(a.vz > 0);
  const b = advance(c, 1, {}, p2).enemies[0];
  assert.ok(b.z > a.z);
  assert.ok(b.vz < a.vz);
  assert.equal(b.y, 2);
});
test("defeat is persisted and survives respawn and roundtrip", () => {
  const c = make({ enemies: [{ ...spawn, health: 5 }] });
  c.update(H, { light: true }, pos);
  advance(c, 0.2);
  const saved = c.serialize();
  assert.deepEqual(saved.defeatedIds, ["test"]);
  assert.equal(c.respawn().enemies[0].phase, "dead");
  const d = make({ enemies: [{ ...spawn, health: 5 }] });
  assert.equal(d.restore(JSON.parse(JSON.stringify(saved))), true);
  assert.equal(d.update(0).enemies[0].health, 0);
});
test("death prevents actions; respawn restores resources", () => {
  const c = ai();
  c.restore({ version: 1, health: 1, stamina: 50, defeatedIds: [] });
  assert.equal(advance(c, 0.7).player.action, "dead");
  assert.equal(c.update(H, { light: true }, pos).player.action, "dead");
  assert.equal(c.respawn().player.health, 100);
});
test("malformed save validation is atomic", () => {
  const c = make();
  const before = c.serialize();
  for (const d of [
    null,
    {},
    { ...before, version: 2 },
    { ...before, health: NaN },
    { ...before, health: -1 },
    { ...before, stamina: 101 },
    { ...before, defeatedIds: ["unknown"] },
    { ...before, defeatedIds: ["test", "test"] },
  ]) {
    assert.equal(c.restore(d), false);
    assert.deepEqual(c.serialize(), before);
  }
});
test("snapshots and saved arrays cannot mutate internal state", () => {
  const c = make();
  const s = c.update(0);
  s.enemies[0].health = 0;
  s.player.combo.push("heavy");
  s.defeatedIds.push("test");
  assert.equal(c.update(0).enemies[0].health, 500);
  assert.deepEqual(c.serialize().defeatedIds, []);
});
test("same inputs produce same snapshots across frame partitions", () => {
  const a = make(),
    b = make();
  a.update(H, { heavy: true }, pos);
  b.update(H, { heavy: true }, pos);
  const sa = a.update(0.5, {}, pos);
  let sb;
  for (let i = 0; i < 30; i++) sb = b.update(1 / 60, {}, pos);
  assert.deepEqual(sa.player, sb.player);
  assert.deepEqual(sa.enemies, sb.enemies);
});
test("subtick edges are retained until simulation advances", () => {
  const c = make();
  c.update(H / 2, { light: true }, pos);
  assert.equal(c.update(H / 2, {}, pos).player.action, "light1");
});
test("invalid time, positions, terrain and spawn data fail explicitly", () => {
  const c = make();
  for (const dt of [-1, NaN, Infinity, 1.1])
    assert.throws(() => c.update(dt), RangeError);
  assert.throws(() => c.update(H, {}, { ...pos, x: NaN }), TypeError);
  assert.throws(() => make({ height: () => NaN }), TypeError);
  assert.throws(() => make({ enemies: [spawn, spawn] }), TypeError);
  assert.throws(() => make({ aggroRange: -1 }), TypeError);
});
test("lock selects nearest live target, toggles off and clears on defeat", () => {
  const c = make({
    enemies: [
      { ...spawn, id: "far", z: 8 },
      { ...spawn, health: 5 },
    ],
  });
  assert.equal(c.update(H, { lock: true }, pos).targetId, "test");
  assert.equal(c.update(H, { lock: true }, pos).targetId, null);
  c.update(H, { lock: true, light: true }, pos);
  assert.equal(advance(c, 0.2).targetId, null);
  assert.equal(c.update(H, { lock: true }, pos).targetId, "far");
});
test("events are one-update notifications and hit event is unique", () => {
  const c = make();
  const started = c.update(H, { light: true }, pos);
  assert.equal(started.events[0].type, "attack");
  assert.deepEqual(c.update(H, {}, pos).events, []);
  const s = c.update(0.3, {}, pos);
  assert.equal(s.events.filter((e) => e.type === "enemyHit").length, 1);
  assert.deepEqual(c.update(0, {}, pos).events, []);
});
test("mixed finisher is terminal even with a late buffered input", () => {
  const c = make();
  combo(c, ["light", "heavy"]);
  advance(c, 0.6);
  c.update(H, { light: true }, pos);
  assert.equal(advance(c, 0.4).player.action, "idle");
});
test("restore resets transient attacks and copies supplied defeated IDs", () => {
  const c = make();
  c.update(H, { heavy: true }, pos);
  const save = { version: 1, health: 62, stamina: 43, defeatedIds: ["test"] };
  assert.equal(c.restore(save), true);
  save.defeatedIds.length = 0;
  const s = c.update(0);
  assert.equal(s.player.action, "idle");
  assert.equal(s.player.health, 62);
  assert.equal(s.player.stamina, 43);
  assert.deepEqual(s.defeatedIds, ["test"]);
});
test("grounding can be inferred against terrain; height difference blocks air guard", () => {
  const c = make({ height: () => 4 });
  assert.equal(
    c.update(H, { light: true }, { x: 0, y: 4, z: 0 }).player.action,
    "light1",
  );
  const d = make({ height: () => 4 });
  assert.equal(
    d.update(H, { guard: true }, { x: 0, y: 7, z: 0 }).player.guarding,
    false,
  );
});
test("guard suppresses attacks and releasing it permits a fresh edge", () => {
  const c = make();
  assert.equal(
    c.update(H, { guard: true, light: true }, pos).player.action,
    "idle",
  );
  c.update(H, {}, pos);
  assert.equal(c.update(H, { light: true }, pos).player.action, "light1");
});
test("one press edge is consumed once across a long host frame", () => {
  const c = make();
  const s = c.update(0.7, { light: true }, pos);
  assert.equal(s.player.action, "idle");
  assert.equal(s.enemies[0].health, 487);
  assert.equal(s.events.filter((e) => e.type === "attack").length, 1);
  const d = make();
  const dodge = d.update(1, { dodge: true }, pos);
  assert.equal(dodge.events.filter((e) => e.type === "dodge").length, 1);
  assert.equal(dodge.player.action, "idle");
});
