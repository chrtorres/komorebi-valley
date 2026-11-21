import { roundedStormBox, stormGroundSurfaces } from "./storm-surfaces.js";

/** Campaign visual overlay; no gameplay writes, renderer, DOM or audio.
 * Y-up/+Z-forward. effects are per-update events: reuse the same array to avoid replay.
 * attack.t is normalized swing progress [0,1]; phase active/strike swings, startup winds up.
 * Boss mode controls warnings; numeric phase is stage 1–3. AoE uses boss.origin.
 * Runtime attack.t is preferred; raw action/timer falls back to campaign weapon timings.
 */
export function createStormEffects(T, scene, player) {
  const geometries = new Set(),
    materials = new Set();
  const geometry = (g) => (geometries.add(g), g);
  const material = (m) => (materials.add(m), m);
  const g = {
    box: geometry(roundedStormBox(T, 0.095)),
    sphere: geometry(new T.IcosahedronGeometry(1, 2)),
    cone: geometry(new T.ConeGeometry(1, 1, 12)),
    beam: geometry(new T.CylinderGeometry(1, 1, 1, 10)),
    ring: geometry(new T.RingGeometry(0.94, 1, 96)),
    swing: geometry(new T.RingGeometry(0.79, 1, 64, 1, 0, Math.PI * 1.3)),
    arc: geometry(new T.TorusGeometry(1, 0.018, 3, 36, Math.PI * 1.3)),
  };
  const solid = (color, roughness = 0.76, metalness = 0) =>
    material(
      new T.MeshStandardMaterial({
        color,
        roughness,
        metalness,
      }),
    );
  const m = {
    cloth: solid(0x222635, 0.92),
    fold: solid(0x30374a, 0.86),
    scarf: solid(0x344962, 0.91),
    metal: solid(0xa0aab1, 0.31, 0.48),
    edge: solid(0xd1dae0, 0.27, 0.33),
    grip: solid(0x302735, 0.79),
    bronze: solid(0x91705e, 0.49, 0.48),
    lacquer: solid(0x563239, 0.48, 0.12),
    spirit: material(new T.MeshStandardMaterial({
      color: 0x829da7, roughness: 0.44, emissive: 0x497b91, emissiveIntensity: 0.64,
    })),
    dark: solid(0x242735, 0.67),
    boss: solid(0x3b4054, 0.52, 0.17),
  };
  function softEffect(color, opacity, profile) {
    const mat = material(new T.MeshBasicMaterial({
      color, opacity, transparent: true, depthWrite: false, side: T.DoubleSide,
    }));
    mat.customProgramCacheKey = () => profile;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = "varying vec2 stormUV;\n" + shader.vertexShader.replace(
        "#include <uv_vertex>", "#include <uv_vertex>\nstormUV = uv;",
      );
      shader.fragmentShader = "varying vec2 stormUV;\n" + shader.fragmentShader.replace(
        "#include <alphamap_fragment>", `#include <alphamap_fragment>\n${profile}`,
      );
    };
    return mat;
  }
  const ringProfile = `
    float r = length(stormUV * 2.0 - 1.0);
    float w = clamp(fwidth(r), 0.002, 0.01);
    float edge = smoothstep(0.94, 0.957 + w, r) * (1.0 - smoothstep(0.985 - w, 1.0, r));
    diffuseColor.a *= edge;`;
  const beamProfile = `
    float ends = smoothstep(0.0, 0.13, stormUV.y) * (1.0 - smoothstep(0.87, 1.0, stormUV.y));
    float grain = 0.74 + 0.26 * sin(stormUV.y * 123.0 + stormUV.x * 11.0);
    diffuseColor.a *= ends * grain;`;
  function mesh(parent, geo, mat, pos = [0, 0, 0], scale = [1, 1, 1]) {
    const o = new T.Mesh(geo, mat);
    o.position.set(...pos);
    o.scale.set(...scale);
    o.castShadow = false;
    o.receiveShadow = false;
    parent.add(o);
    return o;
  }
  function group(parent, name) {
    const o = new T.Group();
    o.name = name;
    parent.add(o);
    return o;
  }
  const root = group(scene, "StormEffects"),
    costume = group(player, "StormCampaignCloth"),
    fallbackCostume = group(costume, "StormFallbackCostume");
  root.visible = false;
  costume.visible = false;
  // An open hood: crown, rear cloth and two cheek panels leave the face readable.
  mesh(fallbackCostume, g.sphere, m.cloth, [0, 1.67, -0.055], [0.215, 0.22, 0.19]);
  mesh(fallbackCostume, g.box, m.dark, [0, 1.54, -0.18], [0.35, 0.27, 0.07]);
  for (const side of [-1, 1]) {
    mesh(
      fallbackCostume,
      g.box,
      m.fold,
      [side * 0.165, 1.51, 0.015],
      [0.075, 0.3, 0.14],
    );
    const shoulder = mesh(
      fallbackCostume,
      g.cone,
      m.cloth,
      [side * 0.23, 1.27, -0.005],
      [0.19, 0.28, 0.24],
    );
    shoulder.rotation.z = -side * 0.35;
    mesh(
      fallbackCostume,
      g.box,
      m.fold,
      [side * 0.14, 0.86, -0.18],
      [0.14, 0.64, 0.045],
    );
  }
  mesh(fallbackCostume, g.sphere, m.scarf, [0, 1.37, 0], [0.23, 0.09, 0.19]);
  const textile = material(m.scarf.clone());
  textile.side = T.DoubleSide;
  textile.roughness = .91;
  const textileTail = material(m.cloth.clone());
  textileTail.side = T.DoubleSide;
  textileTail.roughness = .92;
  const acrossCloth = 4;
  function clothGrid(rows) {
    const indices = [], uv = [];
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= acrossCloth; col++) {
        uv.push(col / acrossCloth, row / rows);
        if (row >= rows || col >= acrossCloth) continue;
        const a = row * (acrossCloth + 1) + col, b = a + acrossCloth + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const buffer = geometry(new T.BufferGeometry());
    buffer.setIndex(indices);
    buffer.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    buffer.setAttribute("position", new T.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
    return buffer;
  }
  const scarf = [];
  let parent = costume;
  for (let i = 0; i < 6; i++) {
    const node = group(parent, `StormScarf_${i}`);
    node.position.set(0, i ? 0 : 1.48, i ? -.129 : -.081);
    scarf.push(node);
    parent = node;
  }
  const scarfRows = 24;
  const scarfGeometry = clothGrid(scarfRows);
  scarfGeometry.attributes.position.setUsage(T.DynamicDrawUsage);
  const scarfMesh = mesh(costume, scarfGeometry, textile);
  scarfMesh.name = "StormScarfFabric";
  scarfMesh.frustumCulled = false;
  const clothPoints = Array.from({ length: scarf.length + 1 }, () => new T.Vector3());
  const clothCurve = new T.CatmullRomCurve3(clothPoints);
  const clothPoint = new T.Vector3();
  const clothInverse = new T.Matrix4();
  const tails = [];
  for (let i = 0; i < 5; i++) {
    const tail = group(costume, `StormRobeTail_${i}`),
      angle = (i - 2) * 0.42;
    tail.position.set(Math.sin(angle) * 0.23, 0.91, -0.17);
    const rows = 15;
    const buffer = clothGrid(rows);
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      for (let col = 0; col <= acrossCloth; col++) {
        const u = col / acrossCloth - .5;
        buffer.attributes.position.setXYZ(row * (acrossCloth + 1) + col,
          u * (.097 + t * .044), -t * (.64 + .028 * Math.cos(Math.PI * u)),
          -.02 - .15 * t * t + .019 * Math.sin(u * 10 + t * 2 + i * .9));
      }
    }
    buffer.computeVertexNormals();
    mesh(tail, buffer, textileTail);
    tail.rotation.y = angle;
    tails.push(tail);
  }
  // Two narrow original lightning ribbons: static buffers, uniform-driven motion, no textures.
  const ribbonGeo = geometry(new T.BufferGeometry()),
    positions = [],
    uvs = [],
    indices = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160,
      angle = t * Math.PI * 4.5,
      radius = 0.9 + 0.2 * Math.sin(t * 13) + 0.06 * Math.sin(t * 127);
    const y = -0.45 + t * 4.2 + 0.035 * Math.sin(t * 153);
    for (const edge of [-1, 1]) {
      const r = radius + edge * 0.095;
      positions.push(Math.cos(angle) * r, y, Math.sin(angle) * r);
      uvs.push((edge + 1) / 2, t);
    }
    if (i < 160) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  ribbonGeo.setAttribute(
    "position",
    new T.Float32BufferAttribute(positions, 3),
  );
  ribbonGeo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  ribbonGeo.setIndex(indices);
  ribbonGeo.computeBoundingSphere();
  const lightningMaterial = material(
    new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, strength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      toneMapped: false,
      vertexShader: `uniform float time; varying vec2 vUv;
      void main(){vUv=uv;vec3 p=position;float a=time*1.65;
      p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
      p.x+=.047*sin(p.y*13.0+time*7.0);p.z+=.032*cos(p.y*21.0-time*6.0);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
      fragmentShader: `uniform float time;uniform float strength;varying vec2 vUv;
      void main(){
        float zig = 0.083 * sin(vUv.y * 119.0) + 0.043 * sin(vUv.y * 281.0 + time * 8.0);
        float d = abs(vUv.x - 0.5 - zig);
        float core = 1.0 - smoothstep(0.035, 0.12, d);
        float halo = 1.0 - smoothstep(0.04, 0.39, d);
        float flow = 0.73 + 0.27 * sin(vUv.y * 37.0 - time * 11.0);
        float ends = smoothstep(0.0, 0.10, vUv.y) * smoothstep(0.0, 0.17, 1.0 - vUv.y);
        vec3 color = mix(vec3(0.14, 0.36, 0.59), vec3(0.56, 0.80, 0.94), core);
        gl_FragColor = vec4(color, (halo * 0.22 + core * 0.44) * flow * ends * strength);
      }`,
    }),
  );
  const lightning = group(costume, "StormCyanHelices");
  lightning.visible = false;
  for (let i = 0; i < 2; i++) {
    const ribbon = mesh(lightning, ribbonGeo, lightningMaterial);
    ribbon.rotation.y = i * Math.PI;
    ribbon.position.y = i * 0.12;
  }
  const hand = group(player, "StormWeaponAttachment");
  const weapons = new Map();
  function weapon(name) {
    const node = group(hand, `StormWeapon_${name}`);
    node.visible = false;
    weapons.set(name, node);
    return node;
  }
  function rod(parent, a, b, r, mat) {
    const delta = new T.Vector3(...b).sub(new T.Vector3(...a));
    const o = mesh(
      parent,
      g.beam,
      mat,
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      [r, delta.length(), r],
    );
    if (delta.lengthSq() > 0)
      o.quaternion.setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        delta.normalize(),
      );
    return o;
  }
  const katana = weapon("katana");
  rod(katana, [0, -0.12, 0], [0, 0.1, 0], 0.026, m.grip);
  mesh(katana, g.box, m.bronze, [0, 0.12, 0], [0.145, 0.024, 0.082]);
  for (let i = 0; i < 6; i++) {
    const wrap = mesh(katana, g.beam, m.lacquer, [0, -0.108 + i * 0.037, 0], [0.028, 0.018, 0.028]);
    wrap.rotation.z = i % 2 ? -0.27 : 0.27;
  }
  const blade = new T.Shape();
  blade.moveTo(-0.026, 0.13);
  blade.quadraticCurveTo(-0.028, 0.67, 0.05, 0.9);
  blade.quadraticCurveTo(0.069, 0.956, 0.115, 0.979);
  blade.quadraticCurveTo(0.043, 0.745, 0.027, 0.13);
  blade.closePath();
  const steel = geometry(new T.ExtrudeGeometry(blade, {
    depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003,
    bevelSegments: 1, curveSegments: 14,
  }).translate(0, 0, -0.004));
  mesh(katana, steel, [m.metal, m.edge]);
  const kunai = weapon("kunai");
  rod(kunai, [0, -0.12, 0], [0, 0.1, 0], 0.024, m.grip);
  const kunaiBlade = mesh(
    kunai,
    g.cone,
    m.metal,
    [0, 0.28, 0],
    [0.115, 0.37, 0.025],
  );
  kunaiBlade.rotation.y = Math.PI / 4;
  const pommel = mesh(
    kunai,
    g.ring,
    m.metal,
    [0, -0.16, 0],
    [0.055, 0.055, 0.055],
  );
  pommel.rotation.y = Math.PI / 2;
  const offhand = kunai.clone(true);
  offhand.name = "StormOffhandKunai";
  player.add(offhand);
  offhand.visible = false;
  const naginata = weapon("naginata");
  rod(naginata, [0, -0.65, 0], [0, 1.05, 0], 0.022, m.grip);
  mesh(naginata, g.box, m.bronze, [0, 0.95, 0], [0.038, 0.13, 0.035]);
  const poleBlade = mesh(
    naginata,
    g.cone,
    m.metal,
    [0.055, 1.29, 0],
    [0.11, 0.47, 0.022],
  );
  poleBlade.rotation.z = -0.22;
  const kusarigama = weapon("kusarigama");
  rod(kusarigama, [0, -0.15, 0], [0, 0.35, 0], 0.026, m.grip);
  const sickle = mesh(
    kusarigama,
    g.arc,
    m.metal,
    [0.13, 0.35, 0],
    [0.25, 0.25, 0.65],
  );
  sickle.rotation.z = -0.5;
  for (let i = 0; i < 9; i++) {
    const link = mesh(
      kusarigama,
      g.ring,
      m.metal,
      [0.07 + Math.sin(i * 0.35) * 0.09, -0.12 - i * 0.08, 0],
      [0.027, 0.045, 0.027],
    );
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
  }
  mesh(kusarigama, g.sphere, m.spirit, [0.08, -0.87, 0], [0.075, 0.075, 0.075]);
  const swing = mesh(
    hand,
    g.swing,
    softEffect(0x9dd0e5, 0.5, `
      vec2 p = stormUV * 2.0 - 1.0;
      float r = length(p);
      float turn = (atan(-p.y, -p.x) + 3.141593) / 4.084071;
      diffuseColor.a *= smoothstep(0.01, 0.35, turn) * (1.0 - smoothstep(0.85, 1.0, turn));
      diffuseColor.a *= smoothstep(0.79, 0.95, r) * (1.0 - smoothstep(0.972, 1.0, r));
    `),
    [0, 0.35, 0.08],
    [0.8, 0.8, 0.8],
  );
  swing.visible = false;
  const boss = group(root, "StormBoss");
  const mantle = geometry(new T.LatheGeometry([
    [0.48, 0.14], [0.47, 0.23], [0.40, 0.54], [0.33, 0.93],
    [0.27, 1.30], [0.30, 1.55], [0.36, 1.75],
  ].map(([r, y]) => new T.Vector2(r, y)), 32));
  const folds = mantle.attributes.position;
  for (let i = 0; i < folds.count; i++) {
    const x = folds.getX(i), y = folds.getY(i), z = folds.getZ(i);
    const angle = Math.atan2(x, z);
    const fold = 1 + 0.09 * Math.cos(angle * 7) * (1 - y / 1.75);
    folds.setXYZ(i, x * fold, y + 0.035 * Math.sin(angle * 5) * (1 - y / 1.75), z * fold);
  }
  mantle.computeVertexNormals();
  const robe = mesh(boss, mantle, m.fold, [0, 0, 0], [1.2, 1, 0.84]);
  for (let i = 0; i < 4; i++) {
    mesh(boss, g.box, i === 0 ? m.lacquer : m.boss, [0, 1.46 + 0.16 * i, 0.035], [0.65 + i * 0.067, 0.22, 0.52]);
  }
  mesh(boss, g.box, m.bronze, [0, 1.48, 0.304], [0.37, 0.065, 0.035]);
  mesh(boss, g.sphere, m.boss, [0, 2.38, 0], [0.3, 0.35, 0.26]);
  mesh(boss, g.box, m.dark, [0, 2.26, 0.152], [0.36, 0.25, 0.235]);
  mesh(boss, g.box, m.bronze, [0, 2.52, 0.14], [0.44, 0.106, 0.29]);
  for (const side of [-1, 1]) {
    const horn = mesh(
      boss,
      g.cone,
      m.bronze,
      [side * 0.25, 2.72, 0],
      [0.095, 0.46, 0.085],
    );
    horn.rotation.z = -side * 0.45;
    const eye = mesh(boss, g.box, m.spirit, [side * 0.104, 2.42, 0.243], [0.13, 0.033, 0.045]);
    eye.rotation.z = side * 0.17;
    for (let i = 0; i < 3; i++) {
      const plate = mesh(boss, g.box, i === 0 ? m.lacquer : m.boss,
        [side * (0.48 + i * 0.06), 2.05 - i * 0.13, 0], [0.36, 0.165, 0.54 - i * 0.04]);
      plate.rotation.z = -side * 0.34;
    }
    rod(boss, [side * 0.52, 1.8, 0], [side * 0.69, 1.08, 0.1], 0.14, m.boss);
  }
  rod(boss, [0.75, 0.65, 0.1], [0.75, 2.4, 0.1], 0.04, m.grip);
  mesh(boss, steel, [m.metal, m.edge], [0.75, 2.3, 0.1], [1.45, 0.63, 1.6]);
  const warningGeometry = geometry(g.ring.clone());
  warningGeometry.attributes.position.setUsage(T.DynamicDrawUsage);
  const bossRing = mesh(root, warningGeometry, softEffect(0xf0ac68, 0.65, ringProfile));
  bossRing.rotation.x = -Math.PI / 2;
  bossRing.frustumCulled = false;
  const lastWarning = new T.Vector4(NaN, NaN, NaN, NaN);
  function followWarningSurface(origin, radius) {
    const ground = stormGroundSurfaces.get(scene);
    if (!ground || (origin.x === lastWarning.x && origin.y === lastWarning.y &&
        origin.z === lastWarning.z && radius === lastWarning.w)) return;
    lastWarning.set(origin.x, origin.y, origin.z, radius);
    // The mesh rotates local +Z up. Only elevations change, so the edge stays at the hazard radius.
    const vertices = warningGeometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const x = origin.x + vertices.getX(i) * radius;
      const z = origin.z - vertices.getY(i) * radius;
      vertices.setZ(i, (ground(x, z) - origin.y) / radius);
    }
    vertices.needsUpdate = true;
  }
  const bossDirection = mesh(
    boss,
    g.cone,
    m.spirit,
    [0, 0.14, 1.1],
    [0.12, 0.45, 0.035],
  );
  bossDirection.rotation.x = Math.PI / 2;
  // Fixed 18 effect slots; each slot has one beam, one ring and three small fragments.
  const pool = [];
  for (let i = 0; i < 18; i++) {
    const node = group(root, `StormBurst_${i}`);
    const ring = mesh(node, g.ring, softEffect(0x9ed5ea, 0.62, ringProfile));
    ring.rotation.x = -Math.PI / 2;
    const beam = mesh(node, g.beam, softEffect(0x9ed5ea, 0.58, beamProfile));
    const spark = material(new T.MeshBasicMaterial({
      color: 0xc9e3e8, transparent: true, opacity: 0.62, depthWrite: false,
    }));
    const shards = [];
    for (let j = 0; j < 3; j++)
      shards.push(mesh(node, g.cone, spark, [0, 0, 0], [0.016, 0.093, 0.016]));
    node.visible = false;
    pool.push({
      node,
      ring,
      beam,
      shards,
      spark,
      age: 0,
      life: 0,
      radius: 1,
      type: "hit",
    });
  }
  const seen = new WeakSet(),
    hidden = new Map(),
    wardrobe = new Map(),
    darkClones = new Map(),
    up = new T.Vector3(0, 1, 0),
    delta = new T.Vector3(),
    lastPos = new T.Vector3();
  let cursor = 0,
    clock = 0,
    disposed = false,
    wasActive = false,
    hasPosition = false,
    scarfLean = 0,
    ascendTime = 0;
  const finite = (n, f = 0) => (Number.isFinite(n) ? n : f);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function isOriginalHat(o) {
    if (/^(?:straw[ _]hat|hat[ _](?:cap|chin|radial|woven))/i.test(o.name))
      return true;
    // Original unnamed procedural fallback has exact authored hat/brim dimensions.
    const p = o.geometry?.parameters;
    return (
      (!o.name || o.name === "Mesh") &&
      p &&
      ((o.geometry.type === "ConeGeometry" &&
        p.radius === 0.53 &&
        p.height === 0.19) ||
        (o.geometry.type === "TorusGeometry" &&
          p.radius === 0.41 &&
          p.tube === 0.025))
    );
  }
  function restoreLegacy() {
    for (const [o, visible] of hidden) o.visible = visible;
    hidden.clear();
    for (const [o, original] of wardrobe) o.material = original;
    wardrobe.clear();
  }
  function dressOriginal(o) {
    const travel =
      /^(?:backpack|pack[ _]|shoulder[ _]strap|brass[ _]buckle|rolled[ _]sleeping|bedroll[ _]tie|canteen|bottle[ _]stopper)/i.test(
        o.name,
      );
    const hood = o.name === "WarriorStormHood";
    if (hood || o.name === "PilgrimCombatWeapon" || o.name === "WarriorHelmet" ||
        o.name === "WarriorMask" || isOriginalHat(o) || travel) {
      if (!hidden.has(o)) hidden.set(o, o.visible);
      o.visible = hood;
    }
    if (!o.isMesh || wardrobe.has(o)) return;
    const original = o.material,
      list = Array.isArray(original) ? original : [original];
    if (!list.some((mat) => /^(robe|trim|cloth|scarf)$/.test(mat?.name)))
      return;
    const dark = list.map((mat) => {
      if (!/^(robe|trim|cloth|scarf)$/.test(mat?.name)) return mat;
      if (!darkClones.has(mat)) {
        const clone = material(mat.clone());
        clone.name = "StormWardrobeDark";
        clone.color.setHex(mat.name === "scarf" ? 0x122337 : 0x0b1422);
        if (clone.emissive) clone.emissive.setHex(0);
        darkClones.set(mat, clone);
      }
      return darkClones.get(mat);
    });
    wardrobe.set(o, original);
    o.material = Array.isArray(original) ? dark : dark[0];
  }
  function resetBursts() {
    for (const slot of pool) {
      slot.node.visible = false;
      slot.life = 0;
    }
  }
  function emit(e) {
    if (!e || ![e.x, e.y, e.z].every(Number.isFinite)) return;
    const slot = pool[cursor++ % pool.length];
    slot.type = e.type;
    slot.age = 0;
    slot.life = e.type === "boss-aoe" ? 0.7 : 0.38;
    slot.radius = clamp(finite(e.radius, 1), 0.1, 12);
    slot.node.position.set(e.x, e.y + 0.04, e.z);
    slot.node.visible = true;
    slot.ring.visible = ["slam", "boss-aoe", "ascend"].includes(e.type);
    slot.beam.visible = ["chain", "dash", "ascend"].includes(e.type);
    slot.shards.forEach((o) => (o.visible = e.type === "hit"));
    delta
      .set(
        finite(e.tx, e.x),
        finite(e.ty, e.y + (e.type === "ascend" ? 3 : 0)),
        finite(e.tz, e.z + (e.type === "dash" ? 2 : 0)),
      )
      .sub(new T.Vector3(e.x, e.y, e.z));
    const length = delta.length();
    slot.beam.visible &&= length > 0.001;
    slot.beam.position.copy(delta).multiplyScalar(0.5);
    slot.beam.scale.set(e.type === "chain" ? 0.025 : 0.05, length, 0.025);
    if (length > 0.001)
      slot.beam.quaternion.setFromUnitVectors(up, delta.normalize());
    slot.ring.material.color.setHex(e.type === "boss-aoe" ? 0xf4a16b : 0x9ed5ea);
  }
  const timings = {
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
  const speeds = {
    katana: 0.82,
    kunai: 0.59,
    naginata: 1.03,
    kusarigama: 1.22,
  };
  function attackProgress(attack, name) {
    if (Number.isFinite(attack?.t)) return clamp(attack.t, 0, 1);
    const timing = timings[attack?.action];
    if (!timing) return 0;
    const [startup, active, recovery] = timing.map((n) => n * speeds[name]);
    const phase = attack.phase,
      attacking = ["active", "strike", "attack"].includes(phase),
      recovering = ["recovery", "recover"].includes(phase);
    return clamp(
      (finite(attack.timer) -
        (attacking ? startup : recovering ? startup + active : 0)) /
        (attacking ? active : recovering ? recovery : startup),
      0,
      1,
    );
  }
  function update(state = {}, dt = 0) {
    if (disposed) return;
    dt = clamp(finite(dt), 0, 0.1);
    clock += dt;
    const active = Boolean(state.active);
    root.visible = active;
    costume.visible = active;
    hand.visible = active;
    if (!active) {
      offhand.visible = false;
      if (wasActive) {
        restoreLegacy();
        resetBursts();
      }
      wasActive = false;
      hasPosition = false;
      ascendTime = 0;
      return;
    }
    wasActive = true;
    // player.clear() during async GLB replacement removes our costume too. Reclaim it next update.
    if (costume.parent !== player) player.add(costume);
    const fittedHood = player.getObjectByName("WarriorStormHood");
    fallbackCostume.visible = !fittedHood;
    player.traverse(dressOriginal);
    const grip = player.getObjectByName("RightGrip");
    const arm = grip || player.getObjectByName("RightArm");
    if (hand.parent !== (arm || player)) {
      (arm || player).add(hand);
    }
    hand.position.set(grip ? 0 : arm ? 0.14 : 0.38, grip ? 0 : arm ? -0.36 : 1.03, grip ? 0 : arm ? 0.025 : 0.1);
    const attack = state.attack,
      name = weapons.has(attack?.weapon)
        ? attack.weapon
        : weapons.has(state.weapon)
          ? state.weapon
          : "katana";
    for (const [key, node] of weapons) node.visible = key === name;
    const leftGrip = player.getObjectByName("LeftGrip");
    const left = leftGrip || player.getObjectByName("LeftArm");
    if (offhand.parent !== (left || player)) (left || player).add(offhand);
    offhand.visible = name === "kunai";
    offhand.position.set(
      leftGrip ? 0 : left ? -0.14 : -0.38,
      leftGrip ? 0 : left ? -0.36 : 1.03,
      leftGrip ? 0 : left ? 0.025 : 0.1,
    );
    offhand.rotation.set(leftGrip ? 1.05 : -0.25, 0, 0.15);
    const phase = attack?.phase,
      t = attackProgress(attack, name),
      striking = ["active", "strike", "attack"].includes(phase);
    hand.rotation.set(grip ? 1.05 : -0.25, 0, -0.15);
    if (["startup", "start", "charging"].includes(phase))
      hand.rotation.set(-1.1, 0.3, -0.5);
    if (striking) {
      if (name === "kunai") hand.rotation.set(-0.8 + t * 1.8, 0, 0.1);
      else if (name === "naginata") hand.rotation.set(-0.6, -1.5 + t * 3, 0.1);
      else if (name === "kusarigama")
        hand.rotation.set(-0.5, t * Math.PI * 2, -0.5);
      else
        hand.rotation.set(-1 + t * 2.3, Math.sin(t * Math.PI), -0.7 + t * 1.4);
    }
    ascendTime = Math.max(0, ascendTime - dt);
    if (
      Array.isArray(state.effects) &&
      !seen.has(state.effects) &&
      state.effects.some((e) => e?.type === "ascend")
    )
      ascendTime = 0.65;
    const spread = Boolean(state.hover || state.airborne || ascendTime > 0);
    lightning.visible = spread;
    lightningMaterial.uniforms.time.value = clock;
    lightningMaterial.uniforms.strength.value =
      state.hover || ascendTime > 0 ? 1 : 0.75;
    if (spread && !striking) {
      hand.rotation.set(-0.55, -0.25, -0.9);
      offhand.rotation.set(-0.55, 0.25, 0.9);
      if (!grip) hand.position.x += 0.1;
      if (!leftGrip) offhand.position.x -= 0.1;
    } else if (striking && name === "kunai")
      offhand.rotation.set(-0.8 + (1 - t) * 1.8, 0, -0.1);
    swing.visible = striking && t > 0.05 && t < 0.95;
    swing.rotation.set(name === "naginata" ? Math.PI / 2 : 0, 0, t * Math.PI);
    swing.scale.setScalar(
      name === "naginata"
        ? 1.4
        : name === "kunai"
          ? 0.4
          : name === "kusarigama"
            ? 1.1
            : 0.8,
    );
    player.getWorldPosition(delta);
    const speed =
      hasPosition && dt > 0 ? Math.min(12, delta.distanceTo(lastPos) / dt) : 0;
    lastPos.copy(delta);
    hasPosition = true;
    const target =
      -0.06 -
      speed * 0.025 -
      (state.hover ? 0.2 : 0) -
      (state.airborne ? 0.1 : 0);
    scarfLean += (target - scarfLean) * (1 - Math.exp(-dt * 8));
    tails.forEach((tail, i) => {
      const target =
        (spread ? 0.65 : 0.12) +
        Math.sin(clock * 5 - i * 0.9) * 0.16 +
        speed * 0.025;
      tail.rotation.x += (target - tail.rotation.x) * (1 - Math.exp(-dt * 9));
      tail.rotation.z = Math.sin(clock * 4 + i) * 0.12;
    });
    if (fittedHood) {
      // Follow the collar as the torso leans and the head counter-rotates.
      fittedHood.localToWorld(clothPoint.set(0, -.071, -.078));
      scarf[0].position.copy(costume.worldToLocal(clothPoint));
    } else scarf[0].position.set(0, 1.48, -.081);
    scarf.forEach((node, i) => {
      node.rotation.x =
        scarfLean + Math.sin(clock * 4 - i * 0.7) * (0.035 + speed * 0.003);
      node.rotation.y = Math.sin(clock * 2.1 - i * 0.6) * 0.07;
    });
    scarf[0].updateWorldMatrix(true, true);
    clothInverse.copy(costume.matrixWorld).invert();
    scarf.forEach((node, i) => clothPoints[i].setFromMatrixPosition(node.matrixWorld).applyMatrix4(clothInverse));
    clothPoints[scarf.length].set(0, 0, -.126).applyMatrix4(scarf.at(-1).matrixWorld).applyMatrix4(clothInverse);
    const scarfPosition = scarfGeometry.attributes.position;
    for (let row = 0; row <= scarfRows; row++) {
      const v = row / scarfRows;
      clothCurve.getPoint(v, clothPoint);
      for (let col = 0; col <= acrossCloth; col++) {
        const u = col / acrossCloth - .5;
        const ripple = Math.sin(u * 7 + v * 8 - clock * 3) * (.004 + .011 * v);
        scarfPosition.setXYZ(row * (acrossCloth + 1) + col, clothPoint.x + u * (.121 - .066 * v),
          clothPoint.y + ripple, clothPoint.z + u * .016 * v);
      }
    }
    scarfPosition.needsUpdate = true;
    scarfGeometry.computeVertexNormals();
    const b = state.boss;
    boss.visible = Boolean(
      b &&
        b.mode !== "victory" &&
        finite(b.health) > 0 &&
        [b.x, b.y, b.z].every(Number.isFinite),
    );
    bossRing.visible = false;
    if (boss.visible) {
      boss.position.set(b.x, b.y, b.z);
      boss.rotation.y = Math.atan2(delta.x - b.x, delta.z - b.z);
      const mode = b.mode || b.phase,
        telegraph = ["telegraph", "windup", "startup", "charging"].includes(
          mode,
        );
      const strike = ["strike", "active", "attack"].includes(mode);
      const stage = clamp(Math.floor(finite(b.phase, 1)), 1, 3);
      const origin =
        b.origin && [b.origin.x, b.origin.y, b.origin.z].every(Number.isFinite)
          ? b.origin
          : b;
      bossRing.visible = telegraph || strike;
      bossRing.position.set(origin.x, origin.y + 0.05, origin.z);
      const duration = 1.55 - stage * 0.2,
        progress = 1 - clamp(finite(b.timer, duration) / duration, 0, 1);
      // Show the full actual hazard radius before detonation, at the locked target origin.
      const radius = 4.5 + stage * 0.65;
      bossRing.scale.setScalar(radius);
      if (bossRing.visible) followWarningSurface(origin, radius);
      bossRing.material.opacity = telegraph ? 0.35 + 0.35 * progress : 0.75;
      bossRing.material.color.setHex(strike ? 0xf27963 : 0xf0ac68);
      bossDirection.visible = telegraph;
      boss.rotation.z =
        b.phase === "hitstun" ? Math.sin(clock * 35) * 0.035 : 0;
    }
    if (Array.isArray(state.effects) && !seen.has(state.effects)) {
      seen.add(state.effects);
      for (const e of state.effects.slice(-18)) emit(e);
    }
    for (const slot of pool)
      if (slot.life > 0) {
        slot.age += dt;
        const p = clamp(slot.age / slot.life, 0, 1);
        slot.node.visible = p < 1;
        slot.ring.material.opacity = (1 - p) * 0.62;
        slot.beam.material.opacity = (1 - p) * 0.58;
        slot.spark.opacity = (1 - p) * 0.62;
        slot.ring.scale.setScalar(slot.radius * (0.3 + 0.7 * p));
        slot.shards.forEach((o, i) =>
          o.position.set(
            Math.cos(i * 2.1) * p * 0.8,
            p * 0.8,
            Math.sin(i * 2.1) * p * 0.8,
          ),
        );
        if (p === 1) slot.life = 0;
      }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    restoreLegacy();
    root.removeFromParent();
    costume.removeFromParent();
    hand.removeFromParent();
    offhand.removeFromParent();
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    geometries.clear();
    materials.clear();
    darkClones.clear();
  }
  return { update, dispose };
}
