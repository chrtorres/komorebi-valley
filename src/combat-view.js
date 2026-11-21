/**
 * Visuals only: positions and health always come from combat-core.
 * update({ enemies, player?, hits? }, dt):
 * enemies: [{id,x,y,z,health,maxHealth,phase,facing,attackTime?,duration?}]
 * player: core {phase, action, combo:[], timer}; legacy attackTime/duration accepted.
 * events: core per-update events; enemyHit positions come from enemy id.
 * hits: [{id,x,y,z}] also accepted; give each explicit hit a unique id.
 * Y-up, +Z forward, facing in radians. Call after locomotion pose updates.
 * Enemy phases: windup/telegraph, attack/active/strike, recover/recovery, dead.
 * Core enemy timer counts DOWN; player timer is total elapsed attack time.
 * Unknown phases are safe idle poses. This helper never changes gameplay state.
 */
export function createCombatView(T, scene, player, { playerWeapon = true } = {}) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  const ownGeometry = (g) => (geometries.add(g), g);
  const ownMaterial = (m) => (materials.add(m), m);
  const geo = {
    box: ownGeometry(new T.BoxGeometry(1, 1, 1)),
    sphere: ownGeometry(new T.IcosahedronGeometry(1, 1)),
    cone: ownGeometry(new T.ConeGeometry(1, 1, 6)),
    ring: ownGeometry(new T.RingGeometry(0.93, 1, 48)),
    spark: ownGeometry(new T.OctahedronGeometry(1, 0)),
  };
  const material = (color, emissive = color, intensity = 0.18) =>
    ownMaterial(
      new T.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: intensity,
        roughness: 0.65,
      }),
    );
  const mat = {
    spirit: material(0x476a71, 0x5bc7b2, 0.35),
    armor: material(0x233e4a, 0x4caca4, 0.18),
    trim: material(0xabcfc4, 0x69d9c6, 0.45),
    steel: material(0xd2e0de, 0x94d5cf, 0.12),
    gold: material(0xb99b54, 0x58401f, 0.15),
    grip: material(0x513e36, 0x000000, 0),
    glow: ownMaterial(new T.MeshBasicMaterial({ color: 0xa3ffee })),
    trail: ownMaterial(
      new T.MeshBasicMaterial({
        color: 0xbaf9e4,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    ),
  };
  const root = new T.Group();
  root.name = "CombatVisuals";
  scene.add(root);
  const mesh = (parent, geometry, m, position, scale) => {
    const o = new T.Mesh(geometry, m);
    o.position.set(...position);
    o.scale.set(...scale);
    // Small combat details intentionally do not add shadow passes.
    o.castShadow = false;
    o.receiveShadow = false;
    parent.add(o);
    return o;
  };
  function sword(parent, name) {
    const pivot = new T.Group();
    pivot.name = name;
    parent.add(pivot);
    // Blade length .77 m; ridge and tapered tip retain a forged silhouette.
    mesh(pivot, geo.box, mat.grip, [0, 0.035, 0], [0.038, 0.17, 0.043]);
    mesh(pivot, geo.sphere, mat.gold, [0, -0.06, 0], [0.035, 0.035, 0.035]);
    mesh(pivot, geo.box, mat.gold, [0, 0.13, 0], [0.21, 0.035, 0.065]);
    mesh(pivot, geo.box, mat.steel, [0, 0.475, 0], [0.065, 0.64, 0.021]);
    mesh(pivot, geo.box, mat.trim, [0, 0.475, -0.013], [0.012, 0.61, 0.006]);
    mesh(pivot, geo.cone, mat.steel, [0, 0.845, 0], [0.038, 0.1, 0.014]);
    for (let i = 0; i < 3; i++)
      mesh(
        pivot,
        geo.box,
        mat.gold,
        [0, -0.015 + i * 0.045, -0.024],
        [0.042, 0.009, 0.006],
      );
    return pivot;
  }
  const held = new T.Group();
  held.name = "PilgrimCombatWeapon";
  const blade = sword(held, "PilgrimSwordSwing");
  const trail = mesh(
    blade,
    geo.box,
    mat.trail,
    [0.055, 0.52, 0],
    [0.045, 0.64, 0.007],
  );
  trail.visible = false;
  let attachedArm = null;
  function attachSword() {
    const grip = player.getObjectByName("RightGrip");
    const arm = grip || player.getObjectByName("RightArm");
    if (arm === attachedArm && held.parent === arm) return;
    held.removeFromParent();
    attachedArm = arm || null;
    if (arm) {
      arm.add(held);
      held.position.set(grip ? 0 : 0.14, grip ? 0 : -0.36, grip ? 0 : 0.025);
      held.rotation.set(0, 0, -0.12);
    }
  }
  const wardens = new Map();
  function healthSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 24;
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    textures.add(texture);
    const m = ownMaterial(
      new T.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    const sprite = new T.Sprite(m);
    sprite.scale.set(1.1, 0.21, 1);
    sprite.position.y = 2.25;
    return { sprite, canvas, texture, ratio: -1 };
  }
  function makeWarden(id) {
    const node = new T.Group();
    node.name = `SpiritWarden_${id}`;
    root.add(node);
    mesh(node, geo.cone, mat.spirit, [0, 0.7, 0], [0.34, 1.2, 0.26]);
    mesh(node, geo.box, mat.armor, [0, 1.23, 0], [0.52, 0.42, 0.29]);
    mesh(node, geo.sphere, mat.trim, [0, 1.66, 0], [0.17, 0.19, 0.16]);
    mesh(node, geo.box, mat.armor, [0, 1.69, 0.12], [0.34, 0.1, 0.12]);
    mesh(node, geo.box, mat.glow, [0, 1.68, 0.189], [0.2, 0.025, 0.012]);
    for (const side of [-1, 1]) {
      mesh(node, geo.box, mat.armor, [side * 0.32, 1.3, 0], [0.22, 0.15, 0.32]);
      const horn = mesh(
        node,
        geo.cone,
        mat.trim,
        [side * 0.18, 1.88, 0],
        [0.05, 0.28, 0.05],
      );
      horn.rotation.z = -side * 0.5;
    }
    const weapon = sword(node, "WardenSword");
    weapon.position.set(0.43, 1.06, 0.1);
    const telegraphMaterial = ownMaterial(
      new T.MeshBasicMaterial({
        color: 0xefb458,
        transparent: true,
        opacity: 0.7,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    const ring = mesh(
      root,
      geo.ring,
      telegraphMaterial,
      [0, 0, 0],
      [1.3, 1.3, 1.3],
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    const health = healthSprite();
    node.add(health.sprite);
    return { node, weapon, ring, health };
  }
  function removeWarden(v) {
    v.node.removeFromParent();
    v.ring.removeFromParent();
    for (const m of [v.ring.material, v.health.sprite.material]) {
      m.dispose();
      materials.delete(m);
    }
    v.health.texture.dispose();
    textures.delete(v.health.texture);
  }
  const sparks = [];
  for (let i = 0; i < 12; i++) {
    const node = mesh(
      root,
      geo.spark,
      mat.glow,
      [0, 0, 0],
      [0.022, 0.022, 0.022],
    );
    node.visible = false;
    sparks.push({ node, life: 0, velocity: new T.Vector3() });
  }
  const seenHits = new Set(),
    seenEventBatches = new WeakSet();
  let eventCounter = 0,
    sparkCursor = 0,
    disposed = false,
    clock = 0;
  const number = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
  // Visual timing mirrors the core checkpoint; an explicit duration overrides phase length.
  const attackTiming = {
    airLight: [0.08, 0.14, 0.28],
    light1: [0.1, 0.12, 0.25],
    light2: [0.09, 0.13, 0.27],
    light3: [0.16, 0.16, 0.38],
    heavy: [0.3, 0.18, 0.42],
    launcher: [0.18, 0.16, 0.4],
    finisher: [0.21, 0.17, 0.38],
    crusher: [0.28, 0.2, 0.48],
    charged: [0.18, 0.22, 0.48],
  };
  const isAttack = (phase) => ["attack", "active", "strike"].includes(phase);
  const isWindup = (phase) =>
    ["windup", "telegraph", "start", "startup", "charging"].includes(phase);
  function phaseProgress(state, enemy = false) {
    const phase = state.phase || state.action;
    if (Number.isFinite(state.attackTime))
      return T.MathUtils.clamp(
        state.attackTime / Math.max(0.01, number(state.duration, 0.65)),
        0,
        1,
      );
    if (enemy) {
      const duration = number(
        state.duration,
        phase === "strike"
          ? 0.12
          : ["recover", "recovery"].includes(phase)
            ? 0.75
            : 0.65,
      );
      return T.MathUtils.clamp(
        1 - number(state.timer, duration) / Math.max(0.01, duration),
        0,
        1,
      );
    }
    if (state.action === "charging")
      return T.MathUtils.clamp(number(state.charge) / 0.9, 0, 1);
    const [startup, active, recovery] = attackTiming[state.action] || [
      0.1, 0.12, 0.25,
    ];
    const offset = isAttack(phase)
      ? startup
      : ["recovery", "recover"].includes(phase)
        ? startup + active
        : 0;
    const duration = number(
      state.duration,
      isAttack(phase)
        ? active
        : ["recovery", "recover"].includes(phase)
          ? recovery
          : startup,
    );
    return T.MathUtils.clamp(
      (number(state.timer) - offset) / Math.max(0.01, duration),
      0,
      1,
    );
  }
  function update(combatState = {}, dt = 0) {
    if (disposed) return;
    dt = T.MathUtils.clamp(number(dt), 0, 0.1);
    clock += dt;
    if (playerWeapon) attachSword();
    const pose = combatState.player || {};
    const phase = pose.phase || pose.action || "idle",
      progress = phaseProgress(pose);
    const combo = Array.isArray(pose.combo)
      ? Math.max(0, pose.combo.length - 1)
      : Math.max(0, Math.floor(number(pose.combo)));
    held.visible = pose.action !== "dead";
    // Animate only the weapon's private pivot; do not overwrite locomotion arm rotations.
    blade.position.set(0, 0, 0);
    blade.rotation.set(attachedArm?.name === "RightGrip" ? 1.05 : -0.35, 0, -0.15);
    if (isWindup(phase) || pose.action === "charging")
      blade.rotation.set(-1.1, 0.2, -0.6);
    if (isAttack(phase)) {
      const arc = Math.sin(progress * Math.PI);
      blade.rotation.set(
        -1.1 + progress * 2.4,
        combo % 2 ? -arc : arc,
        -0.7 + arc * 1.4,
      );
    }
    trail.visible = isAttack(phase) && progress > 0.1 && progress < 0.9;
    if (pose.guarding) {
      // Raise the blade across the chest using only the private weapon pivot.
      if (!player.getObjectByName("RightGrip")) blade.position.set(-0.22, 0.38, 0.2);
      blade.rotation.set(0.45, 0, 0.65);
      trail.visible = false;
    }
    const visibleIds = new Set();
    for (const e of Array.isArray(combatState.enemies)
      ? combatState.enemies
      : []) {
      if (!e || e.id == null || visibleIds.has(e.id) || visibleIds.size >= 3)
        continue;
      if (
        !Number.isFinite(e.x) ||
        !Number.isFinite(e.y) ||
        !Number.isFinite(e.z)
      )
        continue;
      if (number(e.health) <= 0 || e.phase === "dead") continue;
      visibleIds.add(e.id);
      let v = wardens.get(e.id);
      if (!v) {
        v = makeWarden(e.id);
        wardens.set(e.id, v);
      }
      v.node.position.set(e.x, e.y, e.z);
      v.node.rotation.y = number(e.facing);
      const windup = isWindup(e.phase);
      const t = phaseProgress(e, true);
      v.weapon.rotation.set(
        windup
          ? -0.4 - t * 0.7
          : isAttack(e.phase)
            ? -1.2 + t * 2.5
            : ["recover", "recovery"].includes(e.phase)
              ? 1.3 - t * 1.5
              : -0.2,
        0,
        windup ? -0.5 : -0.15,
      );
      v.ring.visible = windup || isAttack(e.phase);
      v.ring.position.set(e.x, e.y + 0.035, e.z);
      v.ring.scale.setScalar(windup ? 1.1 + t * 0.5 : 1.6);
      v.ring.material.color.setHex(windup ? 0xefb458 : 0xf27759);
      v.ring.material.opacity = windup ? 0.45 + 0.25 * t : 0.7;
      const ratio = Math.round(
        T.MathUtils.clamp(
          number(e.health) / Math.max(1, number(e.maxHealth, 100)),
          0,
          1,
        ) * 100,
      );
      if (ratio !== v.health.ratio) {
        const ctx = v.health.canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, 128, 24);
          ctx.fillStyle = "#142e35";
          ctx.fillRect(1, 3, 126, 18);
          ctx.fillStyle = "#8fe0c8";
          ctx.fillRect(4, 6, (120 * ratio) / 100, 12);
          v.health.texture.needsUpdate = true;
        }
        v.health.ratio = ratio;
      }
    }
    for (const [id, v] of wardens)
      if (!visibleIds.has(id)) {
        removeWarden(v);
        wardens.delete(id);
      }
    const hits = Array.isArray(combatState.hits) ? [...combatState.hits] : [];
    const events = combatState.events;
    // Core events last one update. Array identity avoids replay if the same snapshot is rendered twice.
    if (Array.isArray(events) && !seenEventBatches.has(events)) {
      seenEventBatches.add(events);
      const batch = ++eventCounter;
      events.forEach((event, index) => {
        if (event?.type !== "enemyHit") return;
        const enemy = combatState.enemies?.find((e) => e.id === event.id);
        if (enemy)
          hits.push({
            id: `core:${batch}:${index}:${event.id}`,
            x: enemy.x,
            y: enemy.y + 1.1,
            z: enemy.z,
          });
      });
    }
    for (const hit of hits) {
      if (
        !hit ||
        hit.id == null ||
        seenHits.has(hit.id) ||
        ![hit.x, hit.y, hit.z].every(Number.isFinite)
      )
        continue;
      seenHits.add(hit.id);
      // Bounded recent-event cache and fixed spark pool prevent unbounded allocations.
      if (seenHits.size > 256) seenHits.delete(seenHits.values().next().value);
      for (let i = 0; i < 4; i++) {
        const s = sparks[sparkCursor++ % sparks.length],
          angle = (i * Math.PI) / 2 + clock;
        s.life = 0.18;
        s.node.visible = true;
        s.node.position.set(hit.x, hit.y, hit.z);
        s.velocity.set(
          Math.cos(angle) * 1.2,
          0.5 + i * 0.16,
          Math.sin(angle) * 1.2,
        );
      }
    }
    for (const s of sparks)
      if (s.life > 0) {
        s.life -= dt;
        s.node.visible = s.life > 0;
        s.node.position.addScaledVector(s.velocity, dt);
        s.velocity.y -= dt * 3;
        s.node.scale.setScalar((0.025 * Math.max(0, s.life)) / 0.18);
      }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    held.removeFromParent();
    root.removeFromParent();
    for (const v of wardens.values()) removeWarden(v);
    wardens.clear();
    seenHits.clear();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
  }
  return { update, dispose };
}
