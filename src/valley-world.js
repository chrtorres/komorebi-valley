import { createSakuraGroves } from "./sakura-groves.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createKoiHabitat, pondHeight, pondRadius, POND_X, POND_Z } from "./koi/habitat.js";
import { createLeafCards, createGrassGeometry } from "./valley-vegetation.js";
// Deterministic authored landscape: collision height and rendered ground share one function.
export function createWorld(T, scene) {
  const cameraObstacles = [];
  const cameraBox = (x, y, z, rx, height, rz) =>
    cameraObstacles.push({
      min: { x: x - rx, y, z: z - rz },
      max: { x: x + rx, y: y + height, z: z + rz },
    });
  const cameraMesh = object => {
    object.updateMatrixWorld(true);
    const { min, max } = new T.Box3().setFromObject(object, true);
    cameraObstacles.push({ min, max });
  };
  let seed = 817;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pathX = (z) => 5 + Math.sin((z - 16) * 0.055) * 8;
  const rawHeight = (x, z) =>
    Math.sin(z * 0.045) * 1.4 +
    Math.sin(x * 0.065) * 0.7 +
    Math.max(0, -z - 12) * 0.11;
  const pondY = rawHeight(POND_X, POND_Z) + 0.05;
  const height = (x, z) => pondHeight(x, z, rawHeight(x, z), pondY);
  scene.background = new T.Color("#bac8c5");
  scene.fog = new T.FogExp2("#bac8c5", 0.0068);
  scene.add(new T.HemisphereLight("#d6e6f6", "#6f6a4c", 1.5));
  const fill = new T.DirectionalLight("#c1d8eb", 0.55);
  fill.position.set(24, 22, 48);
  scene.add(fill);
  const sun = new T.DirectionalLight("#ffd8a6", 3.7);
  sun.name = "Veiled Pass sunlight";
  sun.position.set(-31, 33, -62);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -65;
  sun.shadow.camera.right = 65;
  sun.shadow.camera.top = 65;
  sun.shadow.camera.bottom = -65;
  sun.shadow.camera.far = 220;
  sun.shadow.radius = 3.2;
  sun.shadow.normalBias = 0.055;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  const colors = {
    stone: "#7b8070",
    wood: "#534a36",
    red: "#8e3c2b",
    roof: "#354b43",
  };
  function texture(kind) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = kind === "wood" ? "#a49583" : "#cbcbc1";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 15000; i++) {
      const x = rand() * 256,
        y = rand() * 256,
        a = rand() * 0.2;
      ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,248,231" : "33,38,33"},${a})`;
      ctx.fillRect(
        x,
        y,
        kind === "wood" ? 1 : rand() * 5,
        kind === "wood" ? 20 : rand() * 4,
      );
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }
  const stoneTexture = texture("stone"),
    woodTexture = texture("wood"),
    materials = new Map();
  function mat(color, map) {
    const key = color + (map?.uuid || "");
    if (!materials.has(key)) {
      materials.set(
        key,
        new T.MeshStandardMaterial({
          color,
          map: map ?? null,
          roughness: 0.92,
        }),
      );
      materials.get(key).userData.valleySurface = "prop";
    }
    return materials.get(key);
  }
  const cube = new T.BoxGeometry(),
    rock = new T.IcosahedronGeometry(1, 2),
    cylinder = new T.CylinderGeometry(1, 1, 1, 10);
  function mesh(
    g,
    color,
    x,
    y,
    z,
    sx = 1,
    sy = 1,
    sz = 1,
    map = null,
    parent = scene,
  ) {
    const m = new T.Mesh(g, mat(color, map));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function beam(a, b, r, color, map = null) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      delta = end.clone().sub(start);
    const m = mesh(
      cylinder,
      color,
      ...start.clone().add(end).multiplyScalar(0.5).toArray(),
      r,
      delta.length(),
      r,
      map,
    );
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
    return m;
  }
  // Subdivide shoreline cells only; the valley retains its coarse distant mesh.
  const terrainAxis = (center) => {
    const axis = [];
    for (let i = 0; i < 150; i++) {
      const start = -120 + i * 1.6;
      const segments = Math.abs(start + .8 - center) < 10 ? 4 : 1;
      for (let j = 0; j < segments; j++) axis.push(start + 1.6 * j / segments);
    }
    return [...axis, 120];
  };
  const xs = terrainAxis(POND_X), zs = terrainAxis(POND_Z);
  const ground = new T.PlaneGeometry(240, 240, xs.length - 1, zs.length - 1);
  ground.rotateX(-Math.PI / 2);
  const p = ground.attributes.position,
    uv = ground.attributes.uv,
    cs = [];
  const bed = new T.Color("#526254"),
    moss = new T.Color("#637255"),
    humus = new T.Color("#5e5343"),
    fern = new T.Color("#47583f"),
    shoulder = new T.Color("#706551"),
    tint = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = xs[i % xs.length],
      z = zs[Math.floor(i / xs.length)],
      y = height(x, z);
    p.setXYZ(i, x, y, z);
    uv.setXY(i, (x + 120) / 240, (120 - z) / 240);
    const patches = Math.sin(x * .15 + z * .065) * Math.sin(z * .14 - x * .073);
    const scatter = Math.sin(x * .72 + z * .43) * Math.sin(x * .35 - z * .83);
    const c = tint.copy(humus).lerp(moss, .54 + patches * .33 + scatter * .12);
    c.lerp(fern, .22 + scatter * .16);
    const pathDistance = Math.abs(x - pathX(z));
    const verge = (1 - T.MathUtils.smoothstep(pathDistance + scatter * .4, 1.5, 3.7)) *
      T.MathUtils.smoothstep(z, -76, -69) * (1 - T.MathUtils.smoothstep(z, 29, 33));
    c.lerp(shoulder, verge * .72);
    if (Math.hypot((x - POND_X) / 7.5, (z - POND_Z) / 5.9) < 1)
      c.lerp(bed, T.MathUtils.smoothstep(pondY - y, -.14, .60) * .85);
    cs.push(c.r, c.g, c.b);
  }
  // Retain the established distribution of trees and architecture after ground refinement.
  for (let i = 0; i < 151 * 151; i++) rand();
  ground.setAttribute("color", new T.Float32BufferAttribute(cs, 3));
  ground.computeVertexNormals();
  const terrain = new T.Mesh(
    ground,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  terrain.receiveShadow = true;
  terrain.name = "Veiled Pass terrain";
  scene.add(terrain);
  // Rounded top edges catch low sunlight while the path retains its original footprint.
  const paver = new RoundedBoxGeometry(1, 1, 1, 1, .13);
  for (let i = 0; i < 145; i++) {
    const z = 30 - i * 0.72,
      x = pathX(z);
    for (let j = 0; j < 3; j++) {
      const px = x + (j - 1) * 1.03 + (rand() - 0.5) * 0.12;
      const m = mesh(
        paver,
        ["#909187", "#a2a296", "#99998d", "#878980"][(i * 7 + j * 3) % 4],
        px,
        height(px, z) + 0.07,
        z,
        0.98,
        0.15,
        0.69,
        stoneTexture,
      );
      m.material.userData.valleySurface = "path";
      m.rotation.y = (rand() - 0.5) * 0.07;
    }
  }
  function torii(z) {
    const x = pathX(z),
      y = height(x, z);
    for (const s of [-1, 1]) {
      cameraBox(x + s * 2.65, y, z, 0.4, 5.7, 0.4);
      const pole = mesh(
        cylinder,
        colors.red,
        x + s * 2.65,
        y + 2.8,
        z,
        0.25,
        5.6,
        0.25,
        woodTexture,
      );
      pole.rotation.z = s * 0.045;
      mesh(cube, "#42473b", x + s * 2.65, y + 0.3, z, 0.65, 0.55, 0.65);
    }
    cameraMesh(mesh(cube, colors.red, x, y + 4.5, z, 6.3, 0.26, 0.38, woodTexture));
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(x - 3.9, y + 6, z),
      new T.Vector3(x - 2, y + 5.72, z),
      new T.Vector3(x + 2, y + 5.72, z),
      new T.Vector3(x + 3.9, y + 6, z),
    ]);
    cameraMesh(mesh(new T.TubeGeometry(curve, 24, 0.23, 6, false), "#443c2f", 0, 0, 0));
    cameraMesh(mesh(cube, colors.red, x, y + 5.45, z, 7.2, 0.3, 0.48, woodTexture));
    cameraMesh(mesh(cube, "#b2955c", x, y + 5, z, 0.55, 0.75, 0.1));
  }
  torii(8);
  torii(-37);
  // Leaf cards and grass are instanced so vegetation density does not imply thousands of draws.
  const leaves = createLeafCards(T, 22400);
  scene.add(leaves);
  const dummy = new T.Object3D();
  let leafIndex = 0;
  const palette = ["#796a59", "#897660", "#818453", "#627557", "#718250"];
  const foliageTint = new T.Color();
  for (let i = 0; i < 120; i++) {
    const x = (rand() - 0.5) * 145,
      z = (rand() - 0.5) * 160;
    if (Math.abs(x - pathX(z)) < 6 || Math.hypot(x + 15, z + 8) < 12) continue;
    const y = height(x, z),
      h = 5 + rand() * 6;
    cameraBox(x, y, z, 0.4, h, 0.4);
    beam([x, y, z], [x + 0.25, y + h, z], 0.16 + rand() * 0.12, "#69564a", woodTexture);
    const tint = new T.Color(palette[i % palette.length]);
    for (let branch = 0; branch < 4; branch++) {
      const angle = rand() * 6.28,
        r = 1.8 + rand() * 2.8,
        bx = x + Math.cos(angle) * r,
        bz = z + Math.sin(angle) * r,
        by = y + h - 1 + rand() * 2;
      beam([x, y + h * 0.62, z], [bx, by, bz], 0.08, "#69564a", woodTexture);
      for (let l = 0; l < 45 && leafIndex < 18000; l++) {
        const angle = rand() * 6.28,
          r = Math.sqrt(rand()) * 2.6;
        dummy.position.set(
          bx + Math.cos(angle) * r,
          by + (rand() - 0.5) * 1.6,
          bz + Math.sin(angle) * r,
        );
        dummy.rotation.set(rand() * 2, rand() * 6.28, rand());
        dummy.scale.setScalar((0.8 + rand() * 1.1) * 1.23);
        dummy.updateMatrix();
        leaves.setMatrixAt(leafIndex, dummy.matrix);
        foliageTint.copy(tint).multiplyScalar(.82 + .23 * Math.sin(l * 2.4) ** 2);
        leaves.setColorAt(leafIndex, foliageTint);
        leaves.geometry.attributes.leafRow.setX(leafIndex, i % 5 > 2 ? 1 : 0);
        leafIndex++;
      }
    }
  }
  leaves.count = leafIndex;
  const bamboo = [];
  for (let i = 0; i < 85; i++) {
    const x = 16 + rand() * 15,
      z = 14 - rand() * 62,
      y = height(x, z),
      h = 7 + rand() * 4;
    bamboo.push({ x, y, z, h });
    mesh(cylinder, "#657352", x, y + h * 0.5, z, 0.085, h, 0.085);
    for (let j = 1; j < 7; j++)
      mesh(
        new T.TorusGeometry(0.09, 0.014, 4, 8),
        "#899573",
        x,
        y + (j * h) / 7,
        z,
      ).rotation.x = Math.PI / 2;
    for (let j = 0; j < 12; j++) {
      const angle = rand() * 6.28;
      dummy.position.set(
        x + Math.cos(angle) * rand() * 1.2,
        y + h - 2 + rand() * 2,
        z + Math.sin(angle) * rand() * 1.2,
      );
      dummy.rotation.set(rand() * 2, angle, 0);
      dummy.scale.set(1.85, 1.15, 1);
      dummy.updateMatrix();
      if (leafIndex < 18000) {
        leaves.setMatrixAt(leafIndex, dummy.matrix);
        leaves.setColorAt(leafIndex, foliageTint.set("#718a52"));
        leaves.geometry.attributes.leafRow.setX(leafIndex, 1);
        leafIndex++;
      }
    }
  }
  leaves.count = leafIndex;
  leaves.instanceMatrix.needsUpdate = true;
  const grassMat = new T.MeshStandardMaterial({
    vertexColors: true,
    side: T.DoubleSide,
    roughness: 1,
  });
  grassMat.userData.valleySurface = "grass";
  const grass = new T.InstancedMesh(createGrassGeometry(T), grassMat, 19200);
  scene.add(grass);
  let grassIndex = 0;
  for (let i = 0; i < 17000; i++) {
    let x = (rand() - 0.5) * 140,
      z = (rand() - 0.5) * 150;
    if (Math.abs(x - pathX(z)) < 2.3) {
      x += 4;
    }
    dummy.position.set(x, height(x, z) - .012, z);
    dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, 0);
    dummy.scale.setScalar(0.45 + rand() * 0.75);
    dummy.updateMatrix();
    if (pondRadius(x, z) >= .985) {
      grass.setMatrixAt(grassIndex, dummy.matrix);
      grass.setColorAt(grassIndex++, foliageTint.set(i % 7 === 0 ? "#b4a06c" : i % 3 === 0 ? "#7f9f5c" : "#8aa866"));
    }
  }
  // Short banks of sedge trace the edge of the hand-laid path.
  for (let i = 0; i < 2200; i++) {
    const u = Math.sin(i * 51.7 + 3.8) * 43758.5453;
    const v = Math.sin(i * 87.3 + .7) * 23421.631;
    const offset = u - Math.floor(u);
    const z = 29 - (v - Math.floor(v)) * 102;
    const side = i % 2 === 0 ? -1 : 1;
    const x = pathX(z) + side * (1.72 + offset ** 2 * 3.6);
    if (pondRadius(x, z) < 1.05) continue;
    dummy.position.set(x, height(x, z) - .01, z);
    dummy.rotation.set(.09 * Math.sin(i), i * 2.39996, 0);
    dummy.scale.setScalar(.52 + .45 * (Math.sin(i * 3.1) * .5 + .5));
    dummy.updateMatrix();
    grass.setMatrixAt(grassIndex, dummy.matrix);
    grass.setColorAt(grassIndex++, foliageTint.set(i % 6 === 0 ? "#b6a17a" : "#90aa6c"));
  }
  grass.count = grassIndex;
  for (let i = 0; i < 100; i++) {
    const x = (rand() - 0.5) * 130,
      z = (rand() - 0.5) * 150;
    if (Math.abs(x - pathX(z)) < 3) continue;
    mesh(
      rock,
      "#697461",
      x,
      height(x, z) + 0.15,
      z,
      0.4 + rand() * 1.8,
      0.4 + rand(),
      0.4 + rand() * 1.4,
      stoneTexture,
    );
  }
  // Mountain ridges are irregular meshes, with progressively paler atmospheric layers.
  for (let layer = 0; layer < 3; layer++) {
    const g = new T.PlaneGeometry(650, 140, 200, 15);
    const v = g.attributes.position;
    for (let i = 0; i < v.count; i++) {
      const x = v.getX(i),
        t = (v.getY(i) + 70) / 140;
      v.setZ(i, Math.sin(x * 0.023 + layer) * 12 + Math.sin(x * 0.08) * 4);
      v.setY(
        i,
        -12 +
          t *
            (35 +
              layer * 15 +
              Math.sin(x * 0.025 + layer) * 19 +
              Math.sin(x * 0.064 + 2) * 12),
      );
    }
    g.computeVertexNormals();
    const ridge = mesh(
      g,
      ["#455b58", "#60777a", "#849699"][layer],
      0,
      0,
      -115 - layer * 48,
    );
    ridge.material.userData.valleySurface = "ridge";
    ridge.castShadow = ridge.receiveShadow = false;
  }
  function temple(x, z) {
    const y = height(x, z);
    cameraBox(x, y, z, 4.1, 4.2, 3.1);
    mesh(cube, "#686d59", x, y + 0.25, z, 10, 0.5, 8, stoneTexture);
    mesh(cube, "#806747", x, y + 2.2, z, 8, 3.7, 6, woodTexture);
    for (const dx of [-3.8, -1.3, 1.3, 3.8])
      mesh(
        cube,
        "#4c4435",
        x + dx,
        y + 2.3,
        z + 3.1,
        0.2,
        4.1,
        0.25,
        woodTexture,
      );
    for (let j = 0; j < 2; j++) {
      const roof = mesh(
        new T.ConeGeometry(1, 1, 4),
        colors.roof,
        x,
        y + 4.5 + j * 0.2,
        z,
        8 - j * 0.7,
        2.2,
        6.4 - j * 0.4,
      );
      roof.rotation.y = Math.PI / 4;
      cameraMesh(roof);
    }
    for (let i = -9; i <= 9; i++)
      beam(
        [x + i * 0.44, y + 4.6, z - 4.1],
        [x + i * 0.44, y + 5.75, z],
        0.045,
        "#6d7b65",
      );
    mesh(cube, "#453b2c", x, y + 1.9, z + 3.13, 1.4, 2.8, 0.2);
  }
  temple(-15, -37);
  temple(15, -65);
  const pond = createKoiHabitat(T, scene, pondY, height);
  const sakura = createSakuraGroves(T, scene, height, "pass");
  // Lateral sprays break up the bamboo poles while leaving the grove open at eye level.
  for (const { x, y, z, h } of bamboo) {
    for (let tier = 0; tier < 4; tier++) {
      const angle = (x + z) * .9 + tier * 2.39996;
      for (let j = 1; j <= 6; j++) {
        const spread = j * .24;
        dummy.position.set(x + Math.cos(angle) * spread,
          y + h - .5 - tier * .78 + .27 * Math.sin(j),
          z + Math.sin(angle) * spread);
        dummy.rotation.set(.7 + j * .28, -angle + j * .54, .25 * Math.sin(j * 3));
        dummy.scale.set(1.6 - j * .10, 1.1, 1);
        dummy.updateMatrix();
        leaves.setMatrixAt(leafIndex, dummy.matrix);
        leaves.geometry.attributes.leafRow.setX(leafIndex, 1);
        leaves.setColorAt(leafIndex++, foliageTint.set(j < 4 ? "#70875b" : "#849865"));
      }
    }
  }
  leaves.count = leafIndex;
  leaves.instanceMatrix.needsUpdate = true;
  leaves.geometry.attributes.leafRow.needsUpdate = true;
  for (let i = 0; i < 10; i++) {
    const x = -8.4 + i * .57;
    const z = -8.9 - Math.sin(i * .21) * .54;
    const step = mesh(paver, "#868477", x, height(x, z) + .035, z,
      .49 + (i % 3) * .05, .12, .57 + (i % 4) * .11, stoneTexture);
    step.rotation.y = Math.sin(i * 2.4) * .4;
  }
  // Ruined retaining walls form an optional route east of the first torii.
  const vaultBarriers = [];
  for (const [id, x, z, heightAboveGround] of [
    ["watch-wall", 10.8, 11, .67],
    ["ridge-wall", 10.8, 6.6, .80],
  ]) {
    const halfWidth = 1.27, halfDepth = .28;
    const floor = Math.min(height(x - halfWidth, z), height(x + halfWidth, z)) - .16;
    const top = height(x, z) + heightAboveGround;
    const wall = mesh(paver, "#71685a", x, (floor + top - .08) / 2, z,
      2 * halfWidth, top - floor - .08, 2 * halfDepth, stoneTexture);
    cameraMesh(wall);
    const cap = mesh(paver, "#a39a82", x, top - .045, z,
      2 * halfWidth, .09, 2 * halfDepth, stoneTexture);
    cameraMesh(cap);
    for (const side of [-1, 1]) {
      const stripe = mesh(cube, "#9c4734", x + side * .98, top - .17, z,
        .105, .15, 2 * halfDepth + .01, woodTexture);
      stripe.castShadow = false;
    }
    vaultBarriers.push({ id, x, z, halfWidth, halfDepth, top });
  }
  for (let i = 0; i < 18; i++) {
    const z = 16.4 - i * .69;
    if (vaultBarriers.some(barrier => Math.abs(z - barrier.z) < .54)) continue;
    const x = 10.8 - Math.max(0, z - 13.1) * 1.03;
    mesh(paver, "#827966", x, height(x, z) + .012, z,
      .67 + .12 * Math.cos(i * 2), .08, .53, stoneTexture).rotation.y = .15 * Math.sin(i * 2.8);
  }
  const watchMarker = { x: 11.6, z: 4.3 };
  const markerY = height(watchMarker.x, watchMarker.z);
  mesh(paver, "#71685a", watchMarker.x, markerY + .12, watchMarker.z,
    .78, .24, .53, stoneTexture);
  const marker = mesh(paver, "#776d55", watchMarker.x, markerY + .61, watchMarker.z,
    .50, .92, .25, stoneTexture);
  cameraMesh(marker);
  mesh(cube, "#a15b36", watchMarker.x, markerY + .85, watchMarker.z + .132,
    .32, .08, .018, woodTexture);
  for (let line = 0; line < 3; line++)
    mesh(cube, "#463c2f", watchMarker.x - .08 + line * .08, markerY + .62,
      watchMarker.z + .133, .015, .21 + .04 * (line % 2), .017);
  const lanterns = [];
  for (let i = 0; i < 7; i++) {
    const z = 8 - i * 11,
      x = pathX(z) + (i % 2 ? 3.1 : -3.1),
      y = height(x, z);
    mesh(cube, "#747866", x, y + 0.13, z, 0.95, 0.26, 0.95, stoneTexture);
    mesh(cylinder, "#747866", x, y + 0.75, z, 0.18, 1.2, 0.18, stoneTexture);
    mesh(cube, "#727765", x, y + 1.45, z, 0.75, 0.16, 0.75, stoneTexture);
    const lamp = mesh(cube, "#9d9675", x, y + 1.85, z, 0.47, 0.55, 0.47);
    for (const dx of [-0.3, 0.3])
      for (const dz of [-0.3, 0.3])
        mesh(cube, "#6a705c", x + dx, y + 1.85, z + dz, 0.08, 0.65, 0.08);
    mesh(new T.ConeGeometry(0.68, 0.5, 4), "#69715d", x, y + 2.4, z);
    mesh(rock, "#78816a", x, y + 2.74, z, 0.15, 0.19, 0.15);
    const light = new T.PointLight("#ffc983", 0, 5, 2);
    light.position.set(x, y + 1.8, z);
    scene.add(light);
    lanterns.push({ x, z, lamp, light });
  }
  const particles = new T.BufferGeometry(),
    positions = new Float32Array(360 * 3);
  for (let i = 0; i < 360; i++) {
    positions[i * 3] = (rand() - 0.5) * 100;
    positions[i * 3 + 1] = 3 + rand() * 16;
    positions[i * 3 + 2] = (rand() - 0.5) * 120;
  }
  particles.setAttribute("position", new T.BufferAttribute(positions, 3));
  const petals = new T.Points(
    particles,
    new T.PointsMaterial({
      color: "#f4cdb4",
      size: 0.14,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  scene.add(petals);
  const currents = [];
  for (const w of [
    { x: 10, z: -20 },
    { x: -8, z: -42 },
  ]) {
    const points = [];
    for (let j = 0; j < 80; j++) {
      const angle = j * 0.25;
      points.push(
        new T.Vector3(
          w.x + Math.cos(angle) * 2,
          height(w.x, w.z) + j * 0.1,
          w.z + Math.sin(angle) * 2,
        ),
      );
    }
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(points),
      new T.LineBasicMaterial({
        color: "#e9ead3",
        transparent: true,
        opacity: 0.18,
      }),
    );
    scene.add(line);
    currents.push(line);
  }
  // Bake static architecture by material. The pond group and interactive lamps stay independent.
  const dynamic = new Set(lanterns.map((l) => l.lamp)),
    batches = new Map();
  scene.updateMatrixWorld(true);
  for (const object of [...scene.children]) {
    if (
      !object.isMesh ||
      object.isInstancedMesh ||
      dynamic.has(object) ||
      object === terrain
    )
      continue;
    const g = object.geometry.clone();
    g.applyMatrix4(object.matrixWorld);
    const key =
      object.material.uuid +
      ":" +
      !!g.index +
      ":" +
      Object.keys(g.attributes).sort().join(",");
    if (!batches.has(key))
      batches.set(key, {
        material: object.material,
        objects: [],
        geometries: [],
      });
    const batch = batches.get(key);
    batch.objects.push(object);
    batch.geometries.push(g);
  }
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geometries, false);
    if (merged) {
      const m = new T.Mesh(merged, batch.material);
      m.castShadow = batch.objects.some((object) => object.castShadow);
      m.receiveShadow = batch.objects.some((object) => object.receiveShadow);
      scene.add(m);
      batch.objects.forEach((o) => scene.remove(o));
    }
    batch.geometries.forEach((g) => g.dispose());
  }
  return {
    height,
    pond,
    cameraObstacles,
    vaultBarriers,
    watchMarker,
    lanterns,
    spawn: [5, height(5, 16), 16],
    update(dt, time, position, stormActive) {
      sakura.update(position, time, !stormActive);
      petals.rotation.y = Math.sin(time * 0.03) * 0.08;
      petals.position.x = Math.sin(time * 0.08) * 4;
      petals.position.y = (-time * 0.09) % 6;
      leaves.rotation.z = Math.sin(time * 0.4) * 0.0006;
      currents.forEach(
        (c, i) => (c.material.opacity = 0.12 + Math.sin(time * 1.4 + i) * 0.07),
      );
    },
  };
}
