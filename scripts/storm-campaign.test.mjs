import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStormCampaign,
  readStorm,
  RINGS,
  SCROLLS,
  SHRINES,
  STONES,
  WEAPONS,
} from "../src/storm-campaign.js";

const at = (place, more = {}) => ({
  x: place.x,
  z: place.z,
  y: 0,
  facing: 0,
  grounded: true,
  moveX: 0,
  moveZ: 0,
  ...more,
});
function fixture(data) {
  let written = 0;
  const notes = [];
  const campaign = createStormCampaign({
    height: () => 0,
    saveData: data,
    notify: (msg) => notes.push(msg),
    changed: () => written++,
  });
  campaign.enter();
  return {
    campaign,
    notes,
    get writes() {
      return written;
    },
  };
}
function tick(campaign, pos, seconds, input = {}) {
  const frames = Math.ceil(seconds * 120);
  for (let i = 0; i < frames; i++)
    campaign.update(seconds / frames, pos, input);
  return campaign.snapshot;
}
function enterArena(campaign) {
  for (const shrine of SHRINES)
    assert.equal(campaign.interact(at(shrine)).kind, "shrine");
  campaign.closeShrine();
  const p = at({ x: 10, z: -63 }, { facing: Math.PI });
  tick(campaign, p, 0.02);
  assert.equal(campaign.snapshot.boss.mode, "telegraph");
  return p;
}

test("only a nearby unlocked checkpoint opens and can equip gear", () => {
  const { campaign } = fixture();
  assert.equal(campaign.interact(at(SHRINES[2])), null);
  assert.equal(campaign.equip("kunai", 0), false);
  for (const [i, shrine] of SHRINES.entries())
    assert.equal(campaign.interact(at(shrine)).index, i);
  assert.equal(campaign.equip("katana", 0), false);
  for (const weapon of Object.keys(WEAPONS)) {
    assert(campaign.equip(weapon, 2));
    assert.equal(campaign.snapshot.weapon, weapon);
  }
  campaign.closeShrine();
  assert.equal(campaign.upgrade("katana", 2), false);
});
test("all weapon upgrades spend shards and survive restoring a saved session", () => {
  const { campaign } = fixture({ version: 1, shards: 30 });
  campaign.interact(at(SHRINES[0]));
  for (const weapon of Object.keys(WEAPONS))
    assert(campaign.upgrade(weapon, 0));
  assert.equal(campaign.snapshot.shards, 22);
  campaign.equip("kusarigama", 0);
  const restored = fixture(campaign.serialize()).campaign.snapshot;
  assert.equal(restored.weapon, "kusarigama");
  assert.deepEqual(Object.values(restored.levels), [1, 1, 1, 1]);
  assert.equal(restored.shards, 22);
});
test("scroll awards once, and lantern breaks produce durable shards", () => {
  const f = fixture(),
    { campaign } = f;
  assert.equal(campaign.interact(at(SCROLLS[0])).title, "The First Vow");
  campaign.interact(at(SCROLLS[0]));
  const stone = STONES[0];
  campaign.update(
    0.025,
    at({ x: stone.x, z: stone.z + 0.8 }, { facing: Math.PI }),
    { light: true },
  );
  tick(
    campaign,
    at({ x: stone.x, z: stone.z + 0.8 }, { facing: Math.PI }),
    0.12,
  );
  assert.deepEqual(campaign.snapshot.broken, [stone.id]);
  assert.equal(campaign.snapshot.shards, 4);
  assert(f.writes >= 3);
  assert.deepEqual(fixture(campaign.serialize()).campaign.snapshot.scrolls, [
    SCROLLS[0].id,
  ]);
});
test("weapon timing and effective range change real melee hits", () => {
  function damage(weapon) {
    const { campaign } = fixture({ version: 1, weapon });
    const p = at({ x: -3, z: -22.6 }, { facing: Math.PI });
    tick(campaign, p, 0.06, { light: true });
    tick(campaign, p, 0.21);
    return campaign.snapshot.combat.enemies.find((e) => e.id === "sentry")
      .health;
  }
  assert.equal(damage("kunai"), 48);
  assert(damage("naginata") < 48);
  assert(damage("kusarigama") < 48);
});
test("aerial arts consume spirit and respect dash and ascension limits", () => {
  const { campaign } = fixture();
  const p = at(SHRINES[0], { y: 3, grounded: false, moveX: 1 });
  assert.equal(campaign.update(0.02, p, { ascend: true }).vertical, 8);
  assert.equal(campaign.snapshot.hover, true);
  assert.equal(campaign.update(0.02, p, { dodge: true }).dx, 0.48);
  assert.equal(campaign.snapshot.hover, false);
  const spirit = campaign.snapshot.spirit;
  campaign.update(0.3, p, {});
  assert.equal(campaign.update(0.02, p, { dodge: true }).dx, 0);
  assert(campaign.snapshot.spirit > spirit);
  assert.equal(campaign.update(0.02, p, { heavy: true }).vertical, -24);
  assert(campaign.landing(at(STONES[0])));
  assert(campaign.snapshot.effects.some((e) => e.type === "slam"));
  assert(campaign.snapshot.broken.includes(STONES[0].id));
});
test("parry trial can be won twice and the first clear unlocks a permanent reward", () => {
  const { campaign } = fixture();
  const p = at(SHRINES[0]);
  for (let attempt = 0; attempt < 2; attempt++) {
    campaign.interact(p);
    assert(campaign.startTrial("parry", 0));
    for (let hit = 0; hit < 3; hit++) {
      const wait = campaign.snapshot.trial.wave;
      tick(campaign, p, wait - 0.12, { guard: false });
      tick(campaign, p, 0.14, { guard: true });
    }
    assert.equal(campaign.snapshot.trial.status, "victory");
  }
  assert.deepEqual(campaign.snapshot.trials, ["parry"]);
  assert.equal(campaign.snapshot.shards, 6);
});
test("flight fails on touching ground and can be retried to victory", () => {
  const { campaign } = fixture();
  const p = at(SHRINES[1]);
  campaign.interact(p);
  assert(campaign.startTrial("flight", 1));
  tick(campaign, { ...p, y: 2, grounded: false }, 0.05);
  tick(campaign, p, 0.05);
  assert.equal(campaign.snapshot.trial.status, "defeat");
  campaign.interact(p);
  assert(campaign.startTrial("flight", 1));
  for (const ring of RINGS)
    tick(campaign, at(ring, { y: ring.lift, grounded: false }), 0.03);
  assert.equal(campaign.snapshot.trial.status, "victory");
  assert.deepEqual(campaign.snapshot.trials, ["flight"]);
});
test("guardian ward rejects hits outside the counter and all three phases lead to persistent victory", () => {
  const { campaign } = fixture({ version: 1, levels: { katana: 3 } });
  const p = enterArena(campaign);
  campaign.update(0.025, p, { magic: true });
  assert.equal(campaign.snapshot.boss.health, 210);
  const air = { ...p, y: 3.2, grounded: false };
  tick(campaign, air, 1.3);
  const phases = new Set();
  for (let i = 0; i < 200 && campaign.snapshot.boss.mode !== "victory"; i++) {
    phases.add(campaign.snapshot.boss.phase);
    tick(campaign, air, 0.11, {
      magic: campaign.snapshot.boss.mode === "counter",
    });
  }
  assert.deepEqual([...phases], [1, 2, 3]);
  assert.equal(campaign.snapshot.boss.mode, "victory");
  assert(campaign.snapshot.defeated.includes("guardian"));
  assert.equal(
    fixture(campaign.serialize()).campaign.snapshot.boss.mode,
    "victory",
  );
});
test("guardian storms can defeat a grounded player and return at the last checkpoint", () => {
  const { campaign } = fixture();
  const p = enterArena(campaign);
  tick(campaign, p, 18);
  assert.equal(campaign.snapshot.health, 0);
  assert.equal(campaign.snapshot.boss.mode, "defeat");
  assert.equal(campaign.respawn().id, "grand");
  assert.equal(campaign.snapshot.health, 100);
});
test("stepping out of the arena stops the boss targeting the player", () => {
  const { campaign } = fixture();
  enterArena(campaign);
  const escaped = tick(campaign, at({ x: 50, z: 10 }), 10);
  assert.equal(escaped.health, 100);
  assert.equal(escaped.boss.mode, "idle");
});
test("lightning travels before hitting and successive airborne swings are bounded", () => {
  const { campaign } = fixture();
  const p = at({ x: -3, z: -24 }, { y: 2, grounded: false, facing: Math.PI });
  campaign.update(0.025, p, { magic: true });
  const sentry = () =>
    campaign.snapshot.combat.enemies.find((e) => e.id === "sentry");
  assert.equal(sentry().health, 48);
  tick(campaign, p, 0.3);
  assert(sentry().health < 48);
  for (let i = 0; i < 3; i++) {
    campaign.update(0.025, p, { light: true });
    assert.equal(campaign.snapshot.attack.action, "airLight");
    tick(campaign, p, 0.55);
  }
  campaign.update(0.025, p, { light: true });
  assert.equal(campaign.snapshot.attack.action, "idle");
});
test("save parser sanitizes old, malformed and out-of-range fields", () => {
  assert.equal(readStorm({ version: 99, active: true }).active, false);
  const s = readStorm({
    version: 1,
    shrine: 50,
    weapon: "missing",
    shards: -4,
    health: Infinity,
    levels: { katana: 19, naginata: -1 },
    scrolls: ["fall", "fall", "fake"],
  });
  assert.deepEqual(
    [
      s.shrine,
      s.weapon,
      s.shards,
      s.health,
      s.levels.katana,
      s.levels.naginata,
    ],
    [2, "katana", 0, 100, 3, 0],
  );
  assert.deepEqual(s.scrolls, ["fall"]);
});
