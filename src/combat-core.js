/**
 * Deterministic, renderer-free combat. All units are seconds/metres; facing is
 * atan2(dx,dz). createCombat({height(x,z), enemies:[{id,x,z,health?}], ai=true}).
 * update(dt,{light,heavy,dodge,guard,lock,heavyHeld?,heavyRelease?},
 *   {x,y,z,facing=0,grounded?,moveX=0,moveZ=0}) returns a detached snapshot.
 * light/heavy/dodge/lock are press edges, guard/optional heavyHeld are levels.
 * motion.dx/dz is the ONLY displacement to apply externally, through collision.
 * player.knockbackX/Z are velocities (do not apply them again). movementScale
 * scales normal locomotion. Engine owns player vertical movement/jump/terrain.
 * Fixed 120Hz simulation; dt in [0,1], remainder retained. Edges wait for a tick.
 * options.aggroRange defaults to 10. ai:false disables AI but retains physics.
 * One airLight per jump (15 stamina), rearmed on landing. Air light can cancel
 * grounded attack recovery, enabling launcher jump follow-ups; no infinite juggle.
 * Events last one update. Attack: startup -> active -> recovery. Last .24s
 * buffers one follow-up; LLL sweeps, LLH launches, LH/HL finish, HH crushes.
 * Optional charged heavy: heavy+heavyHeld starts charge, release or .9s fires.
 * serialize() persists progression ONLY, not an in-flight replay checkpoint.
 * restore({version:1,health,stamina,defeatedIds}) returns boolean, atomic on error.
 * respawn() resets live actors/resources, retaining defeated IDs. No storage IO.
 * Snapshot: {player:{health,maxHealth,stamina,maxStamina,action,phase,combo,
 * timer,charge,guarding,invulnerable,dodgeCooldown,knockbackX,knockbackZ,
 * movementScale}, enemies:[{id,x,y,z,health,maxHealth,phase,facing,vx,vy,vz,
 * timer}], targetId, defeatedIds, motion:{dx,dz}, events:[{type,id?,damage?,
 * attack?}]}. Enemy phases: idle/approach/telegraph/strike/recover/hitstun/dead.
 */
export const COMBAT_STEP = 1 / 120;
export const ATTACKS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      light1: [0.1, 0.12, 0.25, 10, 13, 2.5, 1.05, 3, 0],
      light2: [0.09, 0.13, 0.27, 11, 16, 2.7, 1.15, 4, 0],
      light3: [0.16, 0.16, 0.38, 16, 25, 3, 1.5, 7, 0],
      heavy: [0.3, 0.18, 0.42, 23, 29, 3, 1.1, 7, 0],
      launcher: [0.18, 0.16, 0.4, 22, 28, 2.8, 1.2, 4, 9],
      finisher: [0.21, 0.17, 0.38, 19, 24, 3.1, 1.3, 8, 0],
      crusher: [0.28, 0.2, 0.48, 27, 38, 3.2, 1.2, 10, 0],
      charged: [0.18, 0.22, 0.48, 32, 48, 3.5, 1.4, 12, 5],
      airLight: [0.08, 0.14, 0.28, 15, 18, 2.7, 1.2, 3, 3],
    }).map(([id, v]) => [
      id,
      Object.freeze(
        Object.fromEntries(
          [
            "startup",
            "active",
            "recovery",
            "cost",
            "damage",
            "range",
            "arc",
            "push",
            "lift",
          ].map((k, i) => [k, v[i]]),
        ),
      ),
    ]),
  ),
);
export const DEFAULT_ENEMIES = Object.freeze([
  Object.freeze({ id: "warden-cedar", x: 9, z: 12 }),
  Object.freeze({ id: "warden-stream", x: -9, z: -8 }),
  Object.freeze({ id: "warden-ridge", x: 16, z: -35 }),
]);
const finite = Number.isFinite;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const inArc = (a, b, f, range, arc) =>
  distance(a, b) <= range &&
  Math.abs(Math.atan2(Math.sin(angle(a, b) - f), Math.cos(angle(a, b) - f))) <=
    arc;

export function createCombat(options = {}) {
  const aggroRange = options.aggroRange ?? 10;
  if (!finite(aggroRange) || aggroRange < 0)
    throw new TypeError("Invalid aggro range");
  const height = options.height ?? (() => 0);
  const attackSpec = (name) =>
    options.attackSpec?.(name, ATTACKS[name]) ?? ATTACKS[name];
  const airLimit = options.airLimit ?? 1;
  const ground = (x, z) => {
    const y = height(x, z);
    if (!finite(y)) throw new TypeError("Nonfinite terrain");
    return y;
  };
  const spawns = (options.enemies ?? DEFAULT_ENEMIES).map((e) => ({
    ...e,
    health: e.health ?? 65,
  }));
  if (
    spawns.some(
      (e) =>
        typeof e.id !== "string" ||
        !e.id ||
        !finite(e.x) ||
        !finite(e.z) ||
        !finite(e.health) ||
        e.health <= 0,
    ) ||
    new Set(spawns.map((e) => e.id)).size !== spawns.length
  )
    throw new TypeError("Invalid enemy spawns");
  const externalEvents = [];
  let defeated = new Set(),
    enemies,
    p,
    attack,
    buffer,
    pending = {},
    accumulator = 0,
    targetId = null,
    events = [];
  function reset(health = 100, stamina = 100) {
    externalEvents.length = 0;
    p = {
      health,
      stamina,
      action: health > 0 ? "idle" : "dead",
      phase: "idle",
      combo: [],
      vx: 0,
      vz: 0,
      timer: 0,
      cooldown: 0,
      regenDelay: 0,
      guardTime: 0,
      guarding: false,
      charge: 0,
      airUsed: 0,
    };
    enemies = spawns.map((e) => ({
      ...e,
      maxHealth: e.health,
      y: ground(e.x, e.z),
      vx: 0,
      vy: 0,
      vz: 0,
      phase: defeated.has(e.id) ? "dead" : "idle",
      timer: 0,
      facing: 0,
    }));
    for (const e of enemies) if (defeated.has(e.id)) e.health = 0;
    attack = null;
    buffer = null;
    pending = {};
    accumulator = 0;
    targetId = null;
  }
  reset();
  const emit = (type, extra = {}) => events.push({ type, ...extra });
  function spend(n) {
    if (p.stamina + 1e-9 < n) return false;
    p.stamina = Math.max(0, p.stamina - n);
    p.regenDelay = 0.8;
    return true;
  }
  function start(kind, pos, charged = false) {
    const combo = [...p.combo, kind];
    const aerial = kind === "airLight";
    let name = aerial
      ? "airLight"
      : charged
        ? "charged"
        : kind === "light"
          ? "light1"
          : "heavy";
    if (!charged && !aerial && p.combo.length)
      name =
        combo.join("") === "lightlightheavy"
          ? "launcher"
          : combo.join("") === "lightlightlight"
            ? "light3"
            : combo.join("") === "lightlight"
              ? "light2"
              : combo.join("") === "heavyheavy"
                ? "crusher"
                : "finisher";
    const spec = attackSpec(name);
    if (!spend(spec.cost)) return false;
    if (aerial) p.airUsed++;
    p.combo = combo;
    p.action = name;
    p.phase = "startup";
    p.timer = 0;
    attack = { name, age: 0, facing: pos.facing, hit: new Set(), spec };
    buffer = null;
    emit("attack", { attack: name });
    return true;
  }
  function hitEnemy(e, spec, pos, name) {
    const damage =
      options.enemyDamage?.(e.id, spec.damage, pos, name) ?? spec.damage;
    if (damage <= 0) return;
    e.health = Math.max(0, e.health - damage);
    const f = angle(pos, e);
    e.vx = Math.sin(f) * spec.push;
    e.vz = Math.cos(f) * spec.push;
    e.vy = options.anchored?.(e.id) ? 0 : Math.max(e.vy, spec.lift);
    if (options.anchored?.(e.id)) e.vx = e.vz = 0;
    e.timer = 0.34;
    e.phase = "hitstun";
    emit("enemyHit", { id: e.id, damage, attack: name });
    if (e.health === 0) {
      e.phase = "dead";
      defeated.add(e.id);
      emit("enemyDefeated", { id: e.id });
      if (targetId === e.id) targetId = null;
    }
  }
  function strike(e, pos) {
    if (
      p.health <= 0 ||
      !inArc(e, pos, e.facing, 2.5, 0.95) ||
      Math.abs(e.y - pos.y) > 1.8
    )
      return;
    if (p.action === "dodge" && p.timer >= 0.04 && p.timer < 0.3) {
      emit("evade", { id: e.id });
      return;
    }
    const facingEnemy = inArc(pos, e, pos.facing, 3, 1.25);
    if (p.guarding && facingEnemy && p.guardTime <= 0.14) {
      e.phase = "hitstun";
      e.timer = 0.9;
      p.stamina = Math.min(100, p.stamina + 12);
      emit("parry", { id: e.id });
      return;
    }
    let damage = 18,
      push = 5;
    if (p.guarding && facingEnemy) {
      if (spend(16)) {
        damage = 4;
        push = 1;
        emit("block", { id: e.id });
      } else {
        p.guarding = false;
        emit("guardBreak", { id: e.id });
      }
    }
    hurt(damage, push, e, pos);
  }
  function hurt(damage, push, e, pos) {
    if (!p.health) return;
    p.health = Math.max(0, p.health - damage);
    p.regenDelay = 0.8;
    const f = angle(e, pos);
    p.vx = Math.sin(f) * push;
    p.vz = Math.cos(f) * push;
    p.action = p.health ? "hitstun" : "dead";
    p.phase = p.action;
    p.timer = 0.35;
    attack = null;
    buffer = null;
    p.combo = [];
    emit("playerHit", { id: e.id, damage });
    if (!p.health) {
      p.guarding = false;
      emit("playerDeath");
    }
  }
  function tick(input, pos, h) {
    p.cooldown = Math.max(0, p.cooldown - h);
    p.regenDelay = Math.max(0, p.regenDelay - h);
    const grounded =
      pos.grounded ?? Math.abs(pos.y - ground(pos.x, pos.z)) < 0.18;
    if (grounded) p.airUsed = 0;
    if (input.lock) {
      const alive = enemies
        .filter((e) => e.health > 0 && distance(e, pos) < 24)
        .sort(
          (a, b) =>
            distance(a, pos) - distance(b, pos) || a.id.localeCompare(b.id),
        );
      targetId = targetId ? null : (alive[0]?.id ?? null);
    }
    const canGuard =
      p.health > 0 &&
      grounded &&
      !attack &&
      !["dodge", "hitstun", "charging"].includes(p.action);
    const guarding = Boolean(input.guard && canGuard);
    p.guardTime = guarding ? (p.guarding ? p.guardTime + h : 0) : 0;
    p.guarding = guarding;
    if (p.health > 0) {
      if (
        input.dodge &&
        grounded &&
        p.cooldown === 0 &&
        p.action !== "hitstun" &&
        p.action !== "dodge" &&
        spend(22)
      ) {
        attack = null;
        buffer = null;
        p.combo = [];
        p.action = "dodge";
        p.phase = "dodge";
        p.timer = 0;
        p.cooldown = 0.75;
        p.guarding = false;
        const len = Math.hypot(pos.moveX, pos.moveZ),
          f = len ? Math.atan2(pos.moveX, pos.moveZ) : pos.facing;
        p.vx = Math.sin(f) * 10;
        p.vz = Math.cos(f) * 10;
        emit("dodge");
      }
      if (p.action === "dodge") {
        p.timer += h;
        if (p.timer >= 0.42) {
          p.action = "idle";
          p.phase = "idle";
        }
      } else if (p.action === "hitstun") {
        p.timer -= h;
        if (p.timer <= 0) {
          p.action = "idle";
          p.phase = "idle";
        }
      } else if (p.action === "charging") {
        p.charge += h;
        if (!grounded) {
          p.action = "idle";
          p.phase = "idle";
          p.charge = 0;
        } else if (input.heavyRelease || !input.heavyHeld || p.charge >= 0.9) {
          const charged = p.charge >= 0.6;
          p.action = "idle";
          p.phase = "idle";
          start("heavy", pos, charged);
          p.charge = 0;
        }
      } else {
        const kind = input.heavy ? "heavy" : input.light ? "light" : null;
        if (attack && kind === "light" && !grounded && p.airUsed < airLimit) {
          const a = attack.spec;
          if (
            attack.age >= a.startup + a.active &&
            p.stamina >= ATTACKS.airLight.cost
          ) {
            p.combo = [];
            start("airLight", pos);
          }
        }
        if (attack) {
          const a = attack.spec,
            duration = a.startup + a.active + a.recovery;
          if (
            kind &&
            grounded &&
            attack.age >= duration - 0.24 &&
            ["light1", "light2", "heavy"].includes(attack.name)
          )
            buffer = { kind };
          if (
            kind === "light" &&
            !grounded &&
            p.airUsed < airLimit &&
            attack.age >= duration - 0.24
          )
            buffer = { kind: "airLight" };
          const before = attack.age;
          attack.age += h;
          p.phase =
            attack.age < a.startup
              ? "startup"
              : attack.age < a.startup + a.active
                ? "active"
                : "recovery";
          p.timer = attack.age;
          // Intersect the active interval, including a tick that crosses its end.
          if (attack.age >= a.startup && before < a.startup + a.active)
            for (const e of enemies)
              if (
                e.health > 0 &&
                !attack.hit.has(e.id) &&
                Math.abs(e.y - pos.y) < 2.8 &&
                inArc(pos, e, attack.facing, a.range, a.arc)
              ) {
                attack.hit.add(e.id);
                hitEnemy(e, a, pos, attack.name);
              }
          if (attack.age + 1e-9 >= duration) {
            const next = buffer?.kind;
            attack = null;
            buffer = null;
            p.action = "idle";
            p.phase = "idle";
            if (
              !next ||
              (next === "airLight"
                ? grounded || p.airUsed >= airLimit
                : !grounded) ||
              !start(next, pos)
            )
              p.combo = [];
          }
        } else if (
          kind &&
          !p.guarding &&
          (grounded || (kind === "light" && p.airUsed < airLimit))
        ) {
          p.combo = [];
          if (
            kind === "heavy" &&
            input.heavyHeld &&
            p.stamina >= ATTACKS.heavy.cost
          ) {
            p.action = "charging";
            p.phase = "charging";
            p.charge = 0;
          } else start(grounded ? kind : "airLight", pos);
        }
      }
      if (!attack && p.action === "idle" && !p.guarding && p.regenDelay === 0)
        p.stamina = Math.min(100, p.stamina + 24 * h);
    }
    for (const e of enemies) {
      // Exponential drag is independent of host frame partition. Vertical gravity
      // remains active during stun/death; terrain always resolves penetration.
      e.x += e.vx * h;
      e.z += e.vz * h;
      e.vx *= Math.exp(-6 * h);
      e.vz *= Math.exp(-6 * h);
      e.vy -= 24 * h;
      e.y += e.vy * h;
      const floor = ground(e.x, e.z);
      if (e.y <= floor) {
        e.y = floor;
        e.vy = 0;
      }
      if (e.health <= 0) continue;
      if (e.phase === "hitstun") {
        e.timer -= h;
        if (e.timer <= 0 && e.y <= floor + 0.01) e.phase = "idle";
        continue;
      }
      if (options.ai === false || options.anchored?.(e.id) || p.health <= 0)
        continue;
      const d = distance(e, pos);
      if (e.phase === "telegraph") {
        e.timer -= h;
        if (e.timer <= 0) {
          e.phase = "strike";
          e.timer = 0.12;
          strike(e, pos);
          emit("enemyStrike", { id: e.id });
        }
      } else if (e.phase === "strike") {
        e.timer -= h;
        if (e.timer <= 0) {
          e.phase = "recover";
          e.timer = 0.75;
        }
      } else if (e.phase === "recover") {
        e.timer -= h;
        if (e.timer <= 0) e.phase = "idle";
      } else if (d < aggroRange) {
        e.facing = angle(e, pos);
        if (d <= 2) {
          e.phase = "telegraph";
          e.timer = 0.65;
          emit("telegraph", { id: e.id });
        } else {
          e.phase = "approach";
          e.x += Math.sin(e.facing) * 2.2 * h;
          e.z += Math.cos(e.facing) * 2.2 * h;
          e.y = ground(e.x, e.z);
        }
      } else e.phase = "idle";
    }
    const drag = p.action === "dodge" ? 3 : 8;
    const decay = Math.exp(-drag * h),
      factor = (1 - decay) / drag;
    const dx = p.vx * factor,
      dz = p.vz * factor;
    p.vx *= decay;
    p.vz *= decay;
    return { dx, dz };
  }
  function snapshot(motion) {
    return {
      player: {
        health: p.health,
        maxHealth: 100,
        stamina: p.stamina,
        maxStamina: 100,
        action: p.action,
        phase: p.phase,
        combo: [...p.combo],
        timer: p.timer,
        charge: p.charge,
        guarding: p.guarding,
        invulnerable: p.action === "dodge" && p.timer >= 0.04 && p.timer < 0.3,
        dodgeCooldown: p.cooldown,
        knockbackX: p.vx,
        knockbackZ: p.vz,
        movementScale:
          p.health <= 0 || ["hitstun", "charging", "dodge"].includes(p.action)
            ? 0
            : attack
              ? 0.35
              : p.guarding
                ? 0.45
                : 1,
      },
      enemies: enemies.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        z: e.z,
        health: e.health,
        maxHealth: e.maxHealth,
        phase: e.phase,
        facing: e.facing,
        vx: e.vx,
        vy: e.vy,
        vz: e.vz,
        timer: e.timer,
      })),
      targetId,
      defeatedIds: [...defeated].sort(),
      motion,
      events: events.map((e) => ({ ...e })),
    };
  }
  return {
    get hasPendingAction() {
      return Boolean(pending.light || pending.heavy || pending.dodge || pending.lock || pending.heavyRelease);
    },
    update(dt, input = {}, position = { x: 0, y: 0, z: 0 }) {
      if (!finite(dt) || dt < 0 || dt > 1)
        throw new RangeError("dt must be in [0,1]");
      const pos = { facing: 0, moveX: 0, moveZ: 0, ...position };
      if (
        !["x", "y", "z", "facing", "moveX", "moveZ"].every((k) =>
          finite(pos[k]),
        )
      )
        throw new TypeError("Invalid player position");
      events = externalEvents.splice(0);
      for (const k of ["light", "heavy", "dodge", "lock", "heavyRelease"])
        if (input[k]) pending[k] = true;
      accumulator += dt;
      let dx = 0,
        dz = 0;
      while (accumulator + 1e-12 >= COMBAT_STEP) {
        // Press edges are consumed once, even when one host frame spans many ticks.
        const m = tick(
          { guard: input.guard, heavyHeld: input.heavyHeld, ...pending },
          pos,
          COMBAT_STEP,
        );
        pending = {};
        dx += m.dx;
        dz += m.dz;
        accumulator = Math.max(0, accumulator - COMBAT_STEP);
      }
      return snapshot({ dx, dz });
    },
    spell(ids, spec, position, name) {
      events = [];
      for (const enemy of enemies) {
        if (enemy.health > 0 && ids.includes(enemy.id))
          hitEnemy(enemy, spec, position, name);
      }
      externalEvents.push(...events);
    },
    hazard(damage, source, position) {
      events = [];
      hurt(damage, 5, source, position);
      externalEvents.push(...events);
    },
    serialize() {
      return {
        version: 1,
        health: p.health,
        stamina: p.stamina,
        defeatedIds: [...defeated].sort(),
      };
    },
    restore(data) {
      if (
        !data ||
        data.version !== 1 ||
        !finite(data.health) ||
        data.health < 0 ||
        data.health > 100 ||
        !finite(data.stamina) ||
        data.stamina < 0 ||
        data.stamina > 100 ||
        !Array.isArray(data.defeatedIds) ||
        data.defeatedIds.length > spawns.length ||
        new Set(data.defeatedIds).size !== data.defeatedIds.length ||
        data.defeatedIds.some((id) => !spawns.some((e) => e.id === id))
      )
        return false;
      defeated = new Set(data.defeatedIds);
      reset(data.health, data.stamina);
      events = [];
      return true;
    },
    respawn() {
      reset();
      events = [];
      return snapshot({ dx: 0, dz: 0 });
    },
  };
}
