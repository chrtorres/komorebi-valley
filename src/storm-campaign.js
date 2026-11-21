import { createCombat } from "./combat-core.js";

export const SHRINES = [
  {
    id: "entrance",
    name: "First Gate",
    x: 1,
    z: -14,
    inscription: "Let the storm pass through you. Carry none of its anger.",
  },
  {
    id: "roofs",
    name: "Sakura Court",
    x: 3,
    z: -39,
    inscription:
      "When the bells fell silent, the Order left its testimony beneath the blossoms.",
  },
  {
    id: "grand",
    name: "Grand Torii",
    x: 10,
    z: -60,
    inscription:
      "Meet the guardian in the air when the ground becomes a river of light.",
  },
];
export const SCROLLS = [
  {
    id: "vow",
    x: 4,
    z: -20,
    title: "The First Vow",
    body: "The Shrine Order gathered lightning in four weapons. Their first vow was to return every spark to the sky.",
  },
  {
    id: "fall",
    x: 0,
    z: -34,
    title: "The Last Bell",
    body: "We sealed the Celestial Storm beneath the Grand Torii. The guardian heard our final order and could no longer hear our voices.",
  },
  {
    id: "mercy",
    x: 13,
    z: -56,
    title: "The Guardian’s Letter",
    body: "Cross the final gate when you are ready. Break the storm’s hold. Leave the guardian its name.",
  },
];
export const WEAPONS = {
  katana: {
    name: "Storm-forged Katana",
    reach: 1,
    speed: 0.82,
    power: 1,
    arc: 1,
  },
  kunai: {
    name: "Twin Spirit Kunai",
    reach: 0.76,
    speed: 0.59,
    power: 0.77,
    arc: 1.25,
  },
  naginata: {
    name: "Thunder Naginata",
    reach: 1.46,
    speed: 1.03,
    power: 1.14,
    arc: 1.07,
  },
  kusarigama: {
    name: "Obsidian Kusarigama",
    reach: 1.66,
    speed: 1.22,
    power: 1.23,
    arc: 0.72,
  },
};
export const RINGS = [
  { x: 3, z: -40, lift: 2.7 },
  { x: 5, z: -44, lift: 3.6 },
  { x: 7, z: -48, lift: 3.4 },
  { x: 9, z: -52, lift: 2.8 },
];
export const STONES = [
  { id: "stone-1", x: 3, z: -16 },
  { id: "stone-2", x: 0, z: -25 },
  { id: "stone-3", x: 2, z: -32 },
  { id: "stone-4", x: 6, z: -41 },
  { id: "stone-5", x: 7, z: -49 },
  { id: "stone-6", x: 13, z: -57 },
];
const WARDENS = [
  { id: "sentry", x: -3, z: -26, health: 48 },
  { id: "keeper", x: 6, z: -46, health: 63 },
  { id: "guardian", x: 10, z: -65, health: 210 },
];
export const STORM_SAVE = "komorebi.storm.v1";
const weaponIds = Object.keys(WEAPONS);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const boundedInt = (n, min, max) =>
  Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : min;
const validIds = (list, allowed) =>
  Array.isArray(list)
    ? [...new Set(list.filter((id) => allowed.includes(id)))]
    : [];

export function readStorm(value) {
  const data = value?.version === 1 ? value : {};
  return {
    version: 1,
    active: data.active === true,
    shrine: boundedInt(data.shrine, 0, 2),
    weapon: weaponIds.includes(data.weapon) ? data.weapon : "katana",
    levels: Object.fromEntries(
      weaponIds.map((id) => [id, boundedInt(data.levels?.[id], 0, 3)]),
    ),
    shards: boundedInt(data.shards, 0, 999),
    scrolls: validIds(
      data.scrolls,
      SCROLLS.map((s) => s.id),
    ),
    broken: validIds(
      data.broken,
      STONES.map((s) => s.id),
    ),
    trials: validIds(data.trials, ["flight", "parry"]),
    defeated: validIds(
      data.defeated,
      WARDENS.map((e) => e.id),
    ),
    health: Number.isFinite(data.health)
      ? Math.max(0, Math.min(100, data.health))
      : 100,
  };
}

export function createStormCampaign({
  height,
  saveData,
  notify = () => {},
  changed = () => {},
}) {
  const progress = readStorm(saveData);
  let spirit = 100,
    trial = null,
    effects = [],
    dash = null,
    hover = 0,
    slam = false,
    airDashUsed = false,
    ascensionUsed = false,
    boss = null,
    spellRemaining = 0,
    selectedShrine = null,
    time = 0,
    bolts = [],
    liveSwing = false;
  let state;
  const restoredCombat = () => ({
    version: 1,
    health: progress.health,
    stamina: 100,
    defeatedIds: progress.defeated,
  });
  const combat = createCombat({
    height,
    enemies: WARDENS,
    aggroRange: 9,
    airLimit: 3,
    anchored: (id) => id === "guardian",
    attackSpec(name, base) {
      const w = WEAPONS[progress.weapon],
        upgrade = progress.levels[progress.weapon];
      return {
        ...base,
        startup: base.startup * w.speed,
        active: base.active * w.speed,
        recovery: base.recovery * w.speed,
        range: base.range * w.reach,
        arc: base.arc * w.arc,
        damage: Math.round(base.damage * w.power * (1 + upgrade * 0.24)),
        lift: name === "airLight" ? 4 : base.lift,
      };
    },
    enemyDamage(id, damage, position) {
      if (id !== "guardian") return damage;
      if (!boss || boss.mode !== "counter") return 0;
      return damage * (position.grounded ? 0.42 : 1.35);
    },
  });
  combat.restore(restoredCombat());
  state = combat.update(0);
  const persist = () => changed();
  const emit = (type, pos, extra = {}) =>
    effects.push({ type, x: pos.x, y: pos.y, z: pos.z, ...extra });
  const nearShrine = (pos) => SHRINES.findIndex((s) => distance(s, pos) < 3);
  function enter() {
    progress.active = true;
    persist();
    notify("The Celestial Storm stirs. Follow the crimson gates.");
  }
  function leave() {
    progress.active = false;
    selectedShrine = null;
    trial = null;
    boss = null;
    dash = null;
    slam = false;
    hover = 0;
    bolts = [];
    persist();
  }
  function interact(pos) {
    if (!progress.active || !state.player.health) return null;
    const index = nearShrine(pos);
    if (index >= 0) {
      if (index > progress.shrine + 1) {
        notify("Attune the earlier gate first.");
        return null;
      }
      progress.shrine = Math.max(progress.shrine, index);
      selectedShrine = index;
      spirit = 100;
      if (!boss || boss.mode === "victory") {
        // Checkpoints refill resources while preserving defeated wardens.
        progress.health = 100;
        combat.restore(restoredCombat());
        state = combat.update(0);
      }
      persist();
      return { kind: "shrine", index, ...SHRINES[index] };
    }
    const scroll = SCROLLS.find((s) => distance(s, pos) < 3);
    if (scroll) {
      if (!progress.scrolls.includes(scroll.id)) {
        progress.scrolls.push(scroll.id);
        progress.shards += 2;
        persist();
      }
      return { kind: "scroll", ...scroll };
    }
    return null;
  }
  function equip(id, index) {
    if (selectedShrine !== index || !weaponIds.includes(id)) return false;
    progress.weapon = id;
    persist();
    return true;
  }
  function upgrade(id, index) {
    if (selectedShrine !== index || !weaponIds.includes(id)) return false;
    const rank = progress.levels[id],
      cost = 2 + rank * 2;
    if (rank >= 3 || progress.shards < cost) return false;
    progress.shards -= cost;
    progress.levels[id]++;
    persist();
    return true;
  }
  function startTrial(id, index) {
    if (
      selectedShrine !== index ||
      ["ready", "active"].includes(trial?.status) ||
      boss?.mode === "telegraph" ||
      !["flight", "parry"].includes(id)
    )
      return false;
    if ((id === "flight" && index !== 1) || (id === "parry" && index !== 0))
      return false;
    trial = {
      id,
      status: "ready",
      remaining: id === "flight" ? 22 : 27,
      count: 0,
      wave: 0.8,
      parries: 0,
    };
    selectedShrine = null;
    notify(
      id === "flight"
        ? "Leap through four rings in one flight."
        : "Parry three storm pulses. Guard just before they strike.",
    );
    return true;
  }
  function endTrial(status) {
    trial.status = status;
    if (status === "victory") {
      const first = !progress.trials.includes(trial.id);
      if (first) progress.trials.push(trial.id);
      progress.shards += first ? 5 : 1;
      persist();
      notify(
        first
          ? "Trial cleared. Five shards and a spirit art awakened."
          : "Trial cleared again. One shard earned.",
      );
    } else notify("Trial ended. Return to the shrine to try again.");
  }
  function breakStones(pos, range, wide = false) {
    for (const s of STONES) {
      if (progress.broken.includes(s.id) || distance(s, pos) > range) continue;
      const bearing = Math.atan2(s.x - pos.x, s.z - pos.z) - pos.facing;
      if (
        !wide &&
        Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) > 1.2
      )
        continue;
      progress.broken.push(s.id);
      progress.shards += 2;
      spirit = Math.min(100, spirit + 18);
      emit("hit", { ...s, y: height(s.x, s.z) + 0.7 });
      notify("Stone lantern shattered. +2 shards");
      persist();
    }
  }
  function useLightning(pos) {
    const targets = state.enemies
      .filter((e) => e.health > 0)
      .sort((a, b) => distance(a, pos) - distance(b, pos));
    const first = targets.find((e) => distance(e, pos) < 13);
    if (!first) {
      breakStones(pos, 5, true);
      return;
    }
    const chain = [first],
      limit = progress.trials.includes("parry") ? 4 : 3;
    while (chain.length < limit) {
      const from = chain.at(-1);
      const next = targets
        .filter((e) => !chain.includes(e) && distance(e, from) < 9)
        .sort((a, b) => distance(a, from) - distance(b, from))[0];
      if (!next) break;
      chain.push(next);
    }
    let from = { ...pos, y: pos.y + 1.2 },
      delay = 0;
    for (const target of chain) {
      emit("chain", from, { tx: target.x, ty: target.y + 1, tz: target.z });
      delay += 0.08 + distance(from, target) / 52;
      const stormArt = progress.trials.includes("parry") ? 5 : 0;
      bolts.push({
        id: target.id,
        remaining: delay,
        from: pos,
        damage: 22 + progress.levels[progress.weapon] * 5 + stormArt,
      });
      from = { ...target, y: target.y + 1 };
    }
  }
  function landing(pos) {
    if (!slam) return false;
    slam = false;
    const range = progress.trials.includes("flight") ? 8 : 6;
    emit("slam", pos, { radius: range });
    combat.spell(
      state.enemies.filter((e) => distance(e, pos) < range).map((e) => e.id),
      { damage: 35 + progress.levels[progress.weapon] * 6, push: 7, lift: 6 },
      { ...pos, grounded: false },
      "slam",
    );
    breakStones(pos, range, true);
    return true;
  }
  function updateBoss(dt, pos) {
    const guardian = state.enemies.find((e) => e.id === "guardian");
    if (!guardian.health) {
      if (boss && boss.mode !== "victory") {
        boss.mode = "victory";
        notify("Guardian: I remember the sky. The avenue is yours.");
      }
      return;
    }
    if (boss && distance(guardian, pos) > 15) {
      boss = null;
      bolts = [];
      notify("You left the arena. The shrine offers a moment of rest.");
      return;
    }
    if (!boss && progress.shrine === 2 && distance(guardian, pos) < 7) {
      boss = {
        mode: "telegraph",
        phase: 1,
        timer: 1.25,
        origin: { x: pos.x, y: height(pos.x, pos.z), z: pos.z },
      };
      notify("Guardian: The Order is gone. Its storm is not.");
    }
    if (!boss || boss.mode === "defeat") return;
    const phase = guardian.health <= 70 ? 3 : guardian.health <= 140 ? 2 : 1;
    if (phase > boss.phase) {
      boss.phase = phase;
      notify(
        phase === 2
          ? "Guardian: Hear the bells beneath the thunder."
          : "Guardian: Come, then. Take the storm from me.",
      );
    }
    boss.timer -= dt;
    if (boss.mode === "telegraph" && boss.timer <= 0) {
      const radius = 4.5 + boss.phase * 0.65;
      emit("boss-aoe", boss.origin, { radius });
      if (
        distance(pos, boss.origin) < radius &&
        pos.y - boss.origin.y < 2.2 &&
        !state.player.invulnerable &&
        !dash
      )
        combat.hazard(19 + boss.phase * 7, boss.origin, pos);
      boss.mode = "counter";
      boss.timer = 2.5 - boss.phase * 0.12;
    } else if (boss.mode === "counter" && boss.timer <= 0) {
      boss.mode = "telegraph";
      boss.timer = 1.55 - boss.phase * 0.2;
      boss.origin = { x: pos.x, y: height(pos.x, pos.z), z: pos.z };
    }
  }
  let guardAge = Infinity;
  function updateTrial(dt, pos, input) {
    if (!trial || !["ready", "active"].includes(trial.status)) return;
    trial.remaining -= dt;
    if (
      trial.remaining <= 0 ||
      distance(pos, SHRINES[trial.id === "flight" ? 1 : 0]) > 26
    ) {
      endTrial("defeat");
      return;
    }
    if (trial.id === "flight") {
      if (!pos.grounded) trial.status = "active";
      if (trial.status === "active" && pos.grounded) {
        endTrial("defeat");
        return;
      }
      const ring = RINGS[trial.count];
      if (
        trial.status === "active" &&
        distance(pos, ring) < 2.2 &&
        Math.abs(pos.y - height(ring.x, ring.z) - ring.lift) < 2.1
      ) {
        trial.count++;
        spirit = Math.min(100, spirit + 25);
        airDashUsed = false;
        emit("ascend", pos);
        if (trial.count === RINGS.length) endTrial("victory");
      }
    } else {
      trial.status = "active";
      trial.wave -= dt;
      if (trial.wave <= 0) {
        emit(
          "boss-aoe",
          { ...SHRINES[0], y: height(SHRINES[0].x, SHRINES[0].z) },
          { radius: 8 },
        );
        if (input.guard && guardAge <= 0.24) {
          trial.parries++;
          notify("Perfect parry. " + trial.parries + " / 3");
        } else if (!dash && !state.player.invulnerable)
          combat.hazard(input.guard ? 5 : 16, SHRINES[0], pos);
        if (trial.parries >= 3) endTrial("victory");
        trial.wave = 2.25;
        trial.count++;
      }
    }
  }
  function update(dt, pos, input) {
    effects = [];
    time += dt;
    const motion = { dx: 0, dz: 0, vertical: null, gravity: 1 };
    spirit = Math.min(100, spirit + dt * (pos.grounded ? 16 : 6));
    spellRemaining = Math.max(0, spellRemaining - dt);
    hover = Math.max(0, hover - dt);
    guardAge = input.guard
      ? Number.isFinite(guardAge)
        ? guardAge + dt
        : 0
      : Infinity;
    if (pos.grounded) {
      ascensionUsed = false;
      airDashUsed = false;
      hover = 0;
    }
    if (state.player.health > 0) {
      if (input.magic && spirit >= 20 && spellRemaining === 0) {
        spirit -= 20;
        spellRemaining = 0.55;
        useLightning(pos);
      }
      if (!pos.grounded && input.ascend && !ascensionUsed && spirit >= 22) {
        spirit -= 22;
        ascensionUsed = true;
        hover = 1.65;
        motion.vertical = 8;
        emit("ascend", pos);
      } else if (hover > 0) {
        motion.gravity = 0.12;
        if (hover < 1.25) motion.vertical = 0.25;
      }
      if (!pos.grounded && input.dodge && !airDashUsed && spirit >= 14) {
        const angle =
          Math.hypot(pos.moveX, pos.moveZ) > 0.1
            ? Math.atan2(pos.moveX, pos.moveZ)
            : pos.facing;
        spirit -= 14;
        airDashUsed = true;
        dash = { angle, time: 0.25 };
        hover = 0;
        emit("dash", pos);
      }
      if (!pos.grounded && input.heavy && !slam && spirit >= 16) {
        spirit -= 16;
        slam = true;
        dash = null;
        hover = 0;
        motion.vertical = -24;
      }
      if (dash) {
        dash.time -= dt;
        motion.dx = Math.sin(dash.angle) * 24 * dt;
        motion.dz = Math.cos(dash.angle) * 24 * dt;
        motion.vertical = 0.18;
        motion.gravity = 0;
        if (dash.time <= 0) dash = null;
      }
      updateBoss(dt, pos);
      updateTrial(dt, pos, input);
      for (const bolt of bolts) {
        bolt.remaining -= dt;
        if (bolt.remaining <= 0)
          combat.spell(
            [bolt.id],
            { damage: bolt.damage, push: 3, lift: 4 },
            bolt.from,
            "chain",
          );
      }
      bolts = bolts.filter((b) => b.remaining > 0);
    }
    state = combat.update(
      dt,
      {
        ...input,
        heavy: pos.grounded && input.heavy,
        dodge: pos.grounded && input.dodge,
      },
      pos,
    );
    progress.health = state.player.health;
    progress.defeated = state.defeatedIds;
    for (const e of state.events) {
      if (e.type === "enemyDefeated") {
        progress.shards += e.id === "guardian" ? 12 : 3;
        persist();
      }
      if (e.type === "enemyHit") {
        const enemy = state.enemies.find((s) => s.id === e.id);
        emit("hit", { ...enemy, y: enemy.y + 1.2 });
      }
      if (e.type === "playerDeath") {
        if (boss && boss.mode !== "victory") boss.mode = "defeat";
        if (trial && ["active", "ready"].includes(trial.status))
          endTrial("defeat");
        persist();
        notify("The storm claimed this attempt. Press A / Space to return.");
      }
    }
    if (state.player.phase === "active" && !liveSwing)
      breakStones(pos, 2.6 * WEAPONS[progress.weapon].reach);
    liveSwing = state.player.phase === "active";
    motion.dx += state.motion.dx;
    motion.dz += state.motion.dz;
    return motion;
  }
  function respawn() {
    progress.health = 100;
    spirit = 100;
    dash = null;
    hover = 0;
    slam = false;
    airDashUsed = false;
    ascensionUsed = false;
    boss = null;
    trial = null;
    selectedShrine = null;
    bolts = [];
    liveSwing = false;
    combat.restore(restoredCombat());
    state = combat.update(0);
    persist();
    return SHRINES[progress.shrine];
  }
  return {
    enter,
    leave,
    interact,
    equip,
    upgrade,
    startTrial,
    update,
    landing,
    respawn,
    closeShrine() {
      selectedShrine = null;
    },
    serialize() {
      return readStorm(progress);
    },
    get snapshot() {
      const guardian = state.enemies.find((e) => e.id === "guardian");
      return {
        ...readStorm(progress),
        time,
        spirit,
        hover: hover > 0,
        attack: state.player,
        combat: state,
        trial: trial && { ...trial },
        effects: effects.slice(),
        boss: {
          ...guardian,
          ...(boss || {
            mode: guardian.health ? "idle" : "victory",
            phase: guardian.health ? 1 : 3,
          }),
        },
      };
    },
  };
}
