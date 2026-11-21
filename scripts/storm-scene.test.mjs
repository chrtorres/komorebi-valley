import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createStormScene } from "../src/storm-scene.js";

function fixture(baseHeight) {
  const scene = new T.Scene();
  scene.background = new T.Color("#c3d0c3");
  scene.fog = new T.FogExp2("#c3d0c3", 0.008);
  const light = new T.DirectionalLight("#ffffff", 3);
  const sky = new T.Mesh(new T.SphereGeometry(), new T.MeshBasicMaterial());
  sky.name = "Valley atmosphere sky";
  scene.add(light, sky);
  return { scene, light, sky, api: createStormScene(T, scene, baseHeight) };
}

test("inactive campaign preserves base height and scene lighting", () => {
  const f = fixture();
  assert.equal(f.api.height(-9, -31, 1.2), 1.2);
  assert.equal(f.light.intensity, 3);
  assert.equal(f.scene.getObjectByName("Storm temple avenue").visible, false);
});
test("activation and repeated toggles restore exact original environment", () => {
  const f = fixture(),
    background = f.scene.background,
    fog = f.scene.fog;
  f.api.setActive(true);
  f.api.setActive(true);
  assert.equal(f.light.intensity, 0.96);
  assert.equal(f.sky.visible, false);
  assert.equal(f.scene.getObjectByName("Storm temple avenue").visible, true);
  f.api.setActive(false);
  f.api.setActive(false);
  assert.equal(f.scene.background, background);
  assert.equal(f.scene.fog, fog);
  assert.equal(f.light.intensity, 3);
  assert.equal(f.sky.visible, true);
});
test("roof and ramp are continuous at the shared join and inactive floor is unchanged", () => {
  const { api } = fixture();
  api.setActive(true);
  const deck = api.height(-9, -31, 0),
    join = api.height(-9, -27.2, 0);
  assert(Math.abs(deck - join) < 1e-9);
  const bottom = api.height(-9, -19.2, 0),
    middle = api.height(-9, -23.2, 0);
  assert(bottom < middle && middle < deck);
  assert.equal(api.height(50, 50, 8), 8);
  assert.equal(api.height(-9, -31, 100), 100);
  api.setActive(false);
  assert.equal(api.height(-9, -31, 0), 0);
});
test("active particle updates remain finite for moving player and invalid time", () => {
  const f = fixture();
  f.api.setActive(true);
  for (const time of [0, 1, 100, NaN])
    f.api.update(
      { time, player: { x: time || 0, y: 2, z: -30 }, bossPhase: 3 },
      0.016,
    );
  f.scene.traverse((o) => {
    if (o.isPoints)
      assert(
        Array.from(o.geometry.attributes.position.array).every(Number.isFinite),
      );
  });
});
test("setpiece keeps geometry batched and adds no shadow-casting lights", () => {
  const f = fixture(),
    root = f.scene.getObjectByName("Storm temple avenue");
  let meshes = 0,
    instances = 0,
    lights = 0;
  root.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.isInstancedMesh) instances += o.count;
    if (o.isLight) {
      lights++;
      assert.equal(o.castShadow, false);
    }
  });
  assert(meshes < 52, `${meshes} meshes`);
  assert(instances > 2000);
  assert.equal(lights, 2);
});
test("construction is deterministic across fresh scenes", () => {
  const a = fixture(),
    b = fixture();
  const batches = (f) => {
    const v = [];
    f.scene.traverse((o) => {
      if (o.isInstancedMesh) v.push(o);
    });
    return v;
  };
  const left = batches(a),
    right = batches(b);
  assert.equal(left.length, right.length);
  left.forEach((batch, i) =>
    assert.deepEqual(batch.instanceMatrix.array, right[i].instanceMatrix.array),
  );
});

test("injected canonical height anchors geometry and roof collision", () => {
  const f = fixture(() => 20);
  f.api.setActive(true);
  assert.equal(f.api.height(-9, -31, 20), 23.2);
  const root = f.scene.getObjectByName("Storm temple avenue");
  const stones = root.children.find((o) => o.isInstancedMesh);
  const transform = new T.Matrix4();
  stones.getMatrixAt(0, transform);
  const position = new T.Vector3(),
    scale = new T.Vector3();
  transform.decompose(position, new T.Quaternion(), scale);
  assert(position.y - scale.y / 2 > 20.145);
  assert(
    Math.abs(
      f.api.height(5 + Math.sin((-9 - 16) * 0.055) * 8, -9, 20) - 20.2625,
    ) < 1e-8,
  );
});

test("roof side entry stays on ground while above-deck and ramp queries work", () => {
  const f = fixture(() => 0);
  f.api.setActive(true);
  assert.equal(f.api.height(-9, -31, 0, 0), 0);
  assert.equal(f.api.height(-9, -31, 0, 2.8), 3.2);
  assert.equal(f.api.height(-9, -31, 0), 3.2);
  assert(f.api.height(-9, -23.2, 0, 0) > 0);
});

test("guardian gate centers on x10 at z-63", () => {
  const f = fixture();
  const badges = f.scene
    .getObjectByName("Storm temple avenue")
    .children.filter(
      (o) => o.isMesh && !o.isInstancedMesh && o.position.z === -62.68,
    );
  assert(badges.some((o) => o.position.x === 10));
});

test("nearby lightning displaces petals once and impulse decays to baseline", () => {
  const a = fixture(),
    b = fixture();
  a.api.setActive(true);
  b.api.setActive(true);
  const points = (f) =>
    f.scene
      .getObjectByName("Storm temple avenue")
      .children.find((o) => o.isPoints).geometry.attributes.position.array;
  a.api.update({ time: 0 }, 0.016);
  b.api.update({ time: 0 }, 0.016);
  const original = Array.from(points(a));
  const event = { type: "chain", tx: original[0], tz: original[2] },
    effects = [event];
  a.api.update({ time: 0, effects }, 0.016);
  assert(points(a)[1] > original[1]);
  const displaced = Array.from(points(a));
  a.api.update({ time: 0, effects }, 0);
  assert.deepEqual(Array.from(points(a)), displaced);
  for (let i = 0; i < 100; i++) a.api.update({ time: 0, effects }, 0.1);
  points(a).forEach((value, i) =>
    assert(Math.abs(value - points(b)[i]) < 1e-5),
  );
});

test("malformed and extreme impact payloads keep particles finite", () => {
  const f = fixture();
  f.api.setActive(true);
  f.api.update(
    {
      time: 1,
      effects: [
        null,
        { type: "slam", x: NaN, z: 0 },
        { type: "slam", x: 0, z: -30, radius: Infinity },
      ],
    },
    Infinity,
  );
  f.scene.traverse((o) => {
    if (o.isPoints)
      assert(
        Array.from(o.geometry.attributes.position.array).every(Number.isFinite),
      );
  });
});

test("sakura trunks leave the First Gate, avenue and raised traversal surfaces clear", () => {
  const { scene, api } = fixture(() => 20);
  api.setActive(true);
  const trees = scene.getObjectByName("Storm sakura groves").children.filter(tree => tree.userData.variety);
  for (const tree of trees) {
    const { x, z } = tree.position;
    assert.equal(tree.position.y, 19.94);
    for (const [dx, dz] of [[0, 0], [-.5, 0], [.5, 0], [0, -.5], [0, .5]]) {
      assert.equal(api.height(x + dx, z + dz, 20), 20, `keep ${tree.name} clear of traversal at ${x}, ${z}`);
    }
    assert(Math.hypot(x - 1, z + 14) > 5, "leave the First Gate spawn and follow camera clear");
  }
});
