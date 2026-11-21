import { chochinGeometry, createKitPlacer, placeTorii } from "./shrine-kit.js";
import { createSakuraGroves, sakuraPlantings } from "./sakura-groves.js";
import { createStormCloudMap, createStormSurfaceMaps, roundedStormBox, stormGroundSurfaces } from "./storm-surfaces.js";

export function createStormScene(T, scene, baseHeight) {
  const root = new T.Group();
  root.name = "Storm temple avenue";
  root.visible = false;
  scene.add(root);
  let active = false,
    snapshot = null,
    seed = 441;
  const rand = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pathX = (z) => 5 + Math.sin((z - 16) * 0.055) * 8;
  // Placement matches the existing valley's analytical surface in this avenue.
  const ground =
    typeof baseHeight === "function"
      ? baseHeight
      : (x, z) =>
          Math.sin(z * 0.045) * 1.4 +
          Math.sin(x * 0.065) * 0.7 +
          Math.max(0, -z - 12) * 0.11;
  function avenueFloor(x, z, groundY) {
    if (z > -9 || z < -67.7) return groundY;
    const width = z < -54 ? 12 : 5;
    const center = z < -54
      ? T.MathUtils.lerp(pathX(z), 9, Math.min(1, (-z - 54) / 7))
      : pathX(z);
    return Math.abs(x - center) <= width * 0.4
      ? Math.max(groundY, ground(x, z) + 0.2625)
      : groundY;
  }
  stormGroundSurfaces.set(scene, (x, z) => avenueFloor(x, z, ground(x, z)));
  const box = new T.BoxGeometry(),
    cylinder = new T.CylinderGeometry(1, 1, 1, 10),
    curb = roundedStormBox(T, 0.09),
    joinery = roundedStormBox(T, 0.045);
  const mats = new Map();
  const cameraObstacles = [];
  const mat = (color, roughness = 0.8, metalness = 0) => {
    const key = `${color}/${roughness}/${metalness}`;
    if (!mats.has(key))
      mats.set(
        key,
        new T.MeshStandardMaterial({ color, roughness, metalness }),
      );
    return mats.get(key);
  };
  const dummy = new T.Object3D();
  function transform(v) {
    dummy.position.set(...v.p);
    dummy.scale.set(...v.s);
    dummy.rotation.set(...(v.r || [0, 0, 0]));
    dummy.updateMatrix();
  }
  function recordCameraBounds(geometry, data) {
    geometry.computeBoundingBox();
    for (const v of data) {
      transform(v);
      const { min, max } = geometry.boundingBox.clone().applyMatrix4(dummy.matrix);
      cameraObstacles.push({ min, max });
    }
  }
  function batch(geometry, material, data, shadow = false) {
    const mesh = new T.InstancedMesh(geometry, material, data.length);
    data.forEach((v, i) => {
      transform(v);
      mesh.setMatrixAt(i, dummy.matrix);
      if (v.c) mesh.setColorAt(i, new T.Color(v.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function mesh(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const m = new T.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.receiveShadow = true;
    root.add(m);
    return m;
  }
  // Broad but low cobbles keep combat lanes open and avoid raised stair edges.
  const stones = [],
    borders = [];
  for (let row = 0; row < 100; row++) {
    const z = -9 - row * 0.59,
      center = pathX(z);
    // Widen into the final boss courtyard without covering checkpoint markers.
    const width = z < -54 ? 12 : 5;
    const cx =
      z < -54
        ? T.MathUtils.lerp(center, 9, Math.min(1, (-z - 54) / 7))
        : center;
    for (let col = 0; col < width; col++) {
      const x = cx + (col - (width - 1) / 2) * 0.8;
      // Base path reaches ground + .145. Leave clearance for the mismatched
      // row samples on a slope as well as depth-buffer precision.
      stones.push({
        p: [x, ground(x, z) + 0.24, z],
        s: [0.79, 0.045, 0.585],
        r: [0, (rand() - 0.5) * 0.015, 0],
        c: ["#62727e", "#74808a", "#858990"][Math.floor(rand() * 3)],
      });
    }
    for (const side of [-1, 1])
      borders.push({
        p: [cx + side * (width * 0.4 + 0.2), ground(cx, z) + 0.27, z],
        s: [0.17, 0.14, 0.58],
      });
  }
  const stoneMaps = createStormSurfaceMaps(T),
    cedarMaps = createStormSurfaceMaps(T, true);
  const surface = (color, maps, roughness, detail) =>
    new T.MeshStandardMaterial({
      color, roughness, ...maps, normalScale: new T.Vector2(detail, detail),
    });
  const wetStone = surface("#eceff2", stoneMaps, 0.93, 0.73),
    darkStone = surface("#47525f", stoneMaps, 0.87, 0.58),
    cedar = surface("#442b31", cedarMaps, 0.92, 0.46),
    lacquer = surface("#873b3e", cedarMaps, 0.68, 0.34);
  batch(curb, wetStone, stones).name = "Frosted avenue setts";
  batch(curb, darkStone, borders);
  const pillars = [],
    redBeams = [],
    caps = [],
    crowns = [],
    bindings = [],
    housings = [],
    panes = [];
  const gates = [
    [pathX(-17), -17, 7, 5.6],
    [pathX(-39), -39, 8, 6],
    [10, -63, 13, 9],
  ];
  for (const [x, z, width, h] of gates) {
    const y = ground(x, z);
    for (const side of [-1, 1]) {
      pillars.push({
        p: [x + (side * width) / 2, y + h / 2, z],
        s: [0.3, h, 0.3],
      });
      const foot = {
        p: [x + (side * width) / 2, y + 0.25, z],
        s: [0.95, 0.5, 0.95],
      };
      caps.push(foot);
      const px = foot.p[0];
      for (const lift of [0.61, h * 0.77, h * 0.93])
        bindings.push({ p: [px, y + lift, z], s: [0.66, 0.085, 0.64] });
      const lx = px - side * 0.54, ly = y + h * 0.68;
      bindings.push({ p: [px - side * 0.28, ly + 0.3, z], s: [0.62, 0.08, 0.15] });
      housings.push(
        { p: [lx, ly + 0.18, z], s: [0.44, 0.12, 0.45] },
        { p: [lx, ly - 0.2, z], s: [0.41, 0.08, 0.43] },
      );
      panes.push({ p: [lx, ly, z], s: [0.32, 0.32, 0.32] });
    }
    redBeams.push({ p: [x, y + h * 0.78, z], s: [width + 1, 0.3, 0.5] });
    redBeams.push({ p: [x, y + h, z], s: [width + 2, 0.4, 0.8] });
    crowns.push({ p: [x, y + h + 0.185, z], s: [width * 1.5 + 1, 0.46, 1.13] });
    for (const side of [-1, 1])
      caps.push({
        p: [x + side * (width / 2 - 0.5), y + h + 0.3, z],
        s: [width / 2 + 2, 0.3, 1.15],
        r: [0, 0, side * 0.065],
      });
  }
  // Camera volumes follow the authored gate footprint, independently of ornamental geometry.
  recordCameraBounds(cylinder, pillars);
  recordCameraBounds(box, redBeams);
  recordCameraBounds(box, caps);
  // The authored kit draws the gates; the records above still define their camera volumes.
  const kit = createKitPlacer(T, root);
  for (const [x, z, width, h] of gates) placeTorii(kit, x, ground(x, z), z, width, h, { thick: width > 10 ? 1.35 : 1.1 });
  // Paper chochin hang where the cube lanterns were.
  const chochin = new T.InstancedMesh(chochinGeometry(T, .2, .44), new T.MeshStandardMaterial({
    color: "#d9643c", emissive: "#ff9a4d", emissiveIntensity: 1.1, roughness: .8,
  }), panes.length);
  panes.forEach(({ p }, i) => chochin.setMatrixAt(i, new T.Matrix4().makeTranslation(p[0], p[1], p[2])));
  chochin.name = "Gate chochin";
  root.add(chochin);

  // Roof decks are intentionally flat playable surfaces; pitched eaves sit outside
  // their footprints. Each ramp meets its deck at exactly the same absolute Y.
  const platforms = [];
  for (const [x, z] of [
    [-9, -31],
    [17, -47],
  ]) {
    const top = ground(x, z) + 3.2,
      halfX = 3.2,
      halfZ = 3.8;
    platforms.push({
      x,
      z,
      top,
      halfX,
      halfZ,
      rampStart: z + halfZ + 8,
      rampEnd: z + halfZ,
    });
    mesh(
      joinery,
      darkStone,
      x,
      top - 0.14,
      z,
      halfX * 2,
      0.28,
      halfZ * 2,
    );
    for (const side of [-1, 1])
      mesh(
        joinery,
        mat("#263444", 0.46),
        x + side * (halfX + 0.5),
        top - 0.3,
        z,
        1.3,
        0.2,
        halfZ * 2 + 1,
      ).rotation.z = side * 0.18;
    // Crimson fascia under the obsidian eaves preserves the roof silhouette.
    for (const side of [-1, 1])
      mesh(
        joinery,
        lacquer,
        x + side * halfX,
        top - 0.42,
        z,
        0.15,
        0.18,
        halfZ * 2,
      );
    const supports = [];
    for (const dx of [-2.7, 2.7])
      for (const dz of [-3.3, 3.3])
        supports.push({ p: [x + dx, top - 1.6, z + dz], s: [0.22, 3, 0.22] });
    batch(joinery, cedar, supports);
    const ramp = new T.BufferGeometry();
    const start = z + halfZ + 8,
      end = z + halfZ;
    const vertices = [];
    const rampUVs = [];
    for (let i = 0; i <= 16; i++) {
      const zz = T.MathUtils.lerp(start, end, i / 16);
      const yy = T.MathUtils.lerp(ground(x, start), top, i / 16);
      vertices.push(x - 1.4, yy, zz, x + 1.4, yy, zz);
      rampUVs.push(0, i / 8, 1, i / 8);
    }
    const indices = [];
    for (let i = 1; i <= 16; i++) {
      const a = i * 2;
      indices.push(a - 2, a, a - 1, a - 1, a, a + 1);
    }
    ramp.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    ramp.setAttribute("uv", new T.Float32BufferAttribute(rampUVs, 2));
    ramp.setIndex(indices);
    ramp.computeVertexNormals();
    mesh(ramp, darkStone, 0, 0, 0);
  }

  const sakura = createSakuraGroves(T, root, ground, "storm");
  const wind = { value: 0 };
  const petalsCount = 500,
    positions = new Float32Array(petalsCount * 3),
    petalsBase = [];
  for (let i = 0; i < petalsCount; i++) {
    const [x, z, , crown] = sakuraPlantings.storm[i % sakuraPlantings.storm.length];
    petalsBase.push({
      x: x + (rand() - .5) * crown * 2.4,
      z: z + (rand() - .5) * crown * 2.4,
      y: rand() * 10,
      phase: rand() * 6.28,
    });
  }
  const particles = new T.BufferGeometry();
  particles.setAttribute("position", new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  const impulseOffsets = new Float32Array(petalsCount * 3);
  let seenEffects = new WeakSet();
  const petalMaterial = new T.PointsMaterial({
    color: "#d1a1ae",
    size: 0.1,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  petalMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", `
      vec2 p = gl_PointCoord - 0.5;
      vec2 petal = vec2(p.x + p.y * 0.55, p.y - p.x * 0.32);
      float shape = length(petal * vec2(2.15, 3.1));
      diffuseColor.a *= 1.0 - smoothstep(0.46, 0.99, shape);
    `);
  };
  const petals = new T.Points(particles, petalMaterial);
  petals.frustumCulled = false;
  root.add(petals);
  const sky = new T.Mesh(
    new T.SphereGeometry(1, 40, 24),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: { storm: { value: 0 }, wind, weather: { value: createStormCloudMap(T) } },
      vertexShader:
        "varying vec3 d; void main(){d=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z=gl_Position.w*.99999;}",
      fragmentShader: `
      varying vec3 d;
      uniform float storm;
      uniform float wind;
      uniform sampler2D weather;
      void main(){
        vec3 n=normalize(d);
        float height = max(n.y, 0.0);
        float facing = pow(max(dot(n, normalize(vec3(-0.13, 0.04, -1.0))), 0.0), 8.0);
        vec3 horizon = mix(vec3(0.079, 0.073, 0.098), vec3(0.31, 0.151, 0.118), facing);
        vec3 zenith = vec3(0.015, 0.026, 0.050);
        vec3 c = mix(horizon, zenith, 1.0 - exp(-height * 6.0));
        float gap = pow(max(dot(n, normalize(vec3(-0.15, 0.075, -1.0))), 0.0), 92.0);
        c += vec3(0.21, 0.094, 0.044) * gap;

        // Project two moving banks on a plane. Haze obscures their seams toward the horizon.
        vec2 plane = n.xz / (height + 0.17);
        vec2 bank = plane * vec2(0.11, 0.24) + vec2(wind * -0.012, wind * 0.004);
        float low = texture2D(weather, bank).r;
        float high = texture2D(weather, bank * 1.57 + vec2(0.31 + wind * -0.004, 0.52)).r;
        float cloud = low * 0.74 + high * 0.26;
        float coverage = smoothstep(0.36, 0.69, cloud + storm * 0.036) * smoothstep(0.015, 0.16, height);
        float rim = exp(-height * 4.1) * facing * smoothstep(0.31, 0.56, cloud);
        vec3 cloudColor = mix(vec3(0.021, 0.029, 0.054), vec3(0.118, 0.078, 0.100), rim);
        c = mix(c, cloudColor, coverage * 0.94);
        c += vec3(0.076, 0.088, 0.15) * storm * coverage * 0.18;
        gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -999;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld(true);
  };
  root.add(sky);
  const fill = new T.HemisphereLight("#afc4e8", "#4d3546", 1.42),
    rim = new T.DirectionalLight("#efb29d", 1.92);
  rim.position.set(-23, 19, -71);
  root.add(fill, rim); // No additional shadow map.
  const lastPlayer = new T.Vector3();
  let hadPlayer = false;
  function setActive(value) {
    const next = Boolean(value);
    if (next === active) return;
    active = next;
    root.visible = active;
    hadPlayer = false;
    impulseOffsets.fill(0);
    seenEffects = new WeakSet();
    if (active) {
      snapshot = {
        background: scene.background,
        fog: scene.fog,
        lights: [],
        skies: [],
      };
      scene.traverse((object) => {
        let parent = object;
        while (parent && parent !== root) parent = parent.parent;
        if (parent === root) return;
        if (object.isLight) {
          snapshot.lights.push([object, object.intensity]);
          object.intensity *= 0.32;
        }
        if (object.name === "Valley atmosphere sky") {
          snapshot.skies.push([object, object.visible]);
          object.visible = false;
        }
      });
      scene.background = new T.Color("#364053");
      scene.fog = new T.FogExp2("#555369", 0.013);
    } else if (snapshot) {
      scene.background = snapshot.background;
      scene.fog = snapshot.fog;
      snapshot.lights.forEach(([light, intensity]) => {
        light.intensity = intensity;
      });
      snapshot.skies.forEach(([object, visible]) => {
        object.visible = visible;
      });
      snapshot = null;
    }
  }
  function height(x, z, groundY, playerY) {
    if (!active) return groundY;
    let floor = avenueFloor(x, z, groundY);
    for (const p of platforms) {
      // Optional feet Y prevents side entry from teleporting onto a roof.
      // The three-argument query remains useful for static floor inspection.
      if (
        Math.abs(x - p.x) <= p.halfX &&
        Math.abs(z - p.z) <= p.halfZ &&
        (playerY === undefined ||
          (Number.isFinite(playerY) && playerY >= p.top - 0.5))
      )
        floor = Math.max(floor, p.top);
      if (Math.abs(x - p.x) <= 1.4 && z >= p.rampEnd && z <= p.rampStart) {
        const t = (p.rampStart - z) / (p.rampStart - p.rampEnd);
        floor = Math.max(
          floor,
          T.MathUtils.lerp(ground(p.x, p.rampStart), p.top, t),
        );
      }
    }
    return floor;
  }
  function update({ time = 0, player, bossPhase = 0, effects } = {}, dt = 0) {
    if (!active) return;
    const t = Number.isFinite(time) ? time : 0,
      position = player?.position || player;
    const validPlayer =
      position && [position.x, position.y, position.z].every(Number.isFinite);
    if (validPlayer) sakura.update(position, t);
    let speed = 0;
    if (validPlayer) {
      if (hadPlayer && dt > 0)
        speed = Math.min(
          10,
          Math.hypot(position.x - lastPlayer.x, position.z - lastPlayer.z) / dt,
        );
      lastPlayer.set(position.x, position.y, position.z);
      hadPlayer = true;
    }
    const phase = Number.isFinite(bossPhase)
      ? T.MathUtils.clamp(bossPhase / 3, 0, 1)
      : 0;
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const decay = Math.exp(-step * 3);
    const impacts = [];
    if (Array.isArray(effects))
      for (const effect of effects.slice(-12)) {
        if (!effect || typeof effect !== "object" || seenEffects.has(effect))
          continue;
        seenEffects.add(effect);
        if (
          ![
            "chain",
            "slam",
            "ascend",
            "boss-aoe",
            "lightning",
            "impact",
          ].includes(effect.type)
        )
          continue;
        const x = effect.type === "chain" ? effect.tx : effect.x;
        const z = effect.type === "chain" ? effect.tz : effect.z;
        if (![x, z].every(Number.isFinite)) continue;
        impacts.push({
          x,
          z,
          radius: Number.isFinite(effect.radius)
            ? T.MathUtils.clamp(effect.radius, 0.5, 12)
            : 5,
        });
      }
    sky.material.uniforms.storm.value = phase;
    wind.value = t;
    const gust = Math.sin(t * 1.3) * 0.5 + Math.sin(t * 2.1 + 0.6) * 0.24;
    rim.intensity = 2.25 + phase * 0.24 + gust * 0.06;
    petalsBase.forEach((p, i) => {
      // The same gust crosses the grove with a position-dependent delay.
      const localGust = Math.sin(t * 1.32 + p.z * 0.14) + gust * 0.45;
      let x = p.x + Math.sin(t * 0.47 + p.phase) * 1.6 + localGust * (0.7 + phase * 0.5),
        z = p.z + Math.cos(t * 0.29 + p.phase) * 0.8 + localGust * 0.34;
      if (validPlayer) {
        const dx = x - position.x,
          dz = z - position.z,
          distance = Math.hypot(dx, dz);
        const push = Math.max(0, 1 - distance / 3) * speed * 0.18;
        x += (dx / Math.max(0.2, distance)) * push;
        z += (dz / Math.max(0.2, distance)) * push;
      }
      const index = i * 3;
      for (let axis = 0; axis < 3; axis++)
        impulseOffsets[index + axis] *= decay;
      for (const impact of impacts) {
        const dx = x - impact.x,
          dz = z - impact.z,
          distance = Math.hypot(dx, dz);
        const strength = Math.max(0, 1 - distance / impact.radius) * 2;
        impulseOffsets[index] += (dx / Math.max(0.25, distance)) * strength;
        impulseOffsets[index + 1] += strength * 0.7;
        impulseOffsets[index + 2] += (dz / Math.max(0.25, distance)) * strength;
      }
      // Clamp bursts from simultaneous impacts; offsets exponentially settle.
      for (let axis = 0; axis < 3; axis++)
        impulseOffsets[index + axis] = T.MathUtils.clamp(
          impulseOffsets[index + axis],
          -5,
          5,
        );
      positions[index] = x + impulseOffsets[index];
      positions[index + 1] =
        ground(x, z) +
        ((((p.y - t * (0.35 + phase * 0.13) + localGust * 0.3) % 10) + 10) % 10) +
        0.2 +
        impulseOffsets[index + 1];
      positions[index + 2] = z + impulseOffsets[index + 2];
    });
    particles.attributes.position.needsUpdate = true;
  }
  return { update, height, setActive, cameraObstacles, kit };
}
