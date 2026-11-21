import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createWorld } from "../src/valley-world.js";
import { orbitLookAngle, orbitPosition, placeOrbitCamera } from "../src/camera-orbit.js";
import { createStormScene } from "../src/storm-scene.js";
import { resolveCameraPosition, resolveTerrainCamera } from "../src/camera-collision.js";
import { readFile } from "node:fs/promises";
import { parseShrineKit } from "../src/shrine-kit.js";

// The architecture players see is the authored kit, so camera checks use its real geometry.
const kitBytes = await readFile(new URL("../src/assets/shrine-kit.glb", import.meta.url));
const kitParts = await parseShrineKit(kitBytes.buffer.slice(kitBytes.byteOffset, kitBytes.byteOffset + kitBytes.byteLength));
/** World-space vertices of every instance of a kit mesh. */
function instancedVertices(mesh) {
  const out = [], instance = new T.Matrix4(), p = mesh.geometry.attributes.position;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, instance);
    instance.premultiply(mesh.matrixWorld);
    for (let v = 0; v < p.count; v++) out.push(new T.Vector3().fromBufferAttribute(p, v).applyMatrix4(instance));
  }
  return out;
}

test("camera proxies cover transformed roof vertices and stop before the real skirt", () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {} }),
    }),
  };
  try {
    const scene = new T.Scene(),
      world = createWorld(T, scene);
    world.kit.attachParts(kitParts);
    scene.updateMatrixWorld(true);
    const hall = scene.children.filter((o) => o.isInstancedMesh && o.name === "Kit ShrineHall");
    const roofs = hall.filter((o) => o.material.name === "Roof");
    assert(roofs.length > 0);
    for (const roof of roofs) {
      for (const v of instancedVertices(roof)) {
        assert(
          world.cameraObstacles.some((b) =>
            ["x", "y", "z"].every(
              (k) => v[k] >= b.min[k] - 1e-6 && v[k] <= b.max[k] + 1e-6,
            ),
          ),
          "uncovered transformed roof vertex",
        );
      }
    }
    const y = world.height(-15, -37),
      target = { x: -15, y: y + 3.7, z: -30 },
      desired = { x: -15, y: y + 3.7, z: -37 };
    const clipped = resolveCameraPosition(
      target,
      desired,
      world.cameraObstacles,
    );
    const origin = new T.Vector3(target.x, target.y, target.z),
      direction = new T.Vector3(0, 0, -1);
    const hits = new T.Raycaster(origin, direction, 0, 7).intersectObjects(
      hall,
    );
    assert(hits.length > 0, "hall regression ray must hit actual geometry");
    assert(
      origin.distanceTo(new T.Vector3(clipped.x, clipped.y, clipped.z)) <
        hits[0].distance,
      "camera entered the real roof skirt",
    );
    // The authored roof rises to a 7.4 m ridge. A ray at ridge height must stop before the
    // upper roof; removing the roof's camera volume (fault injection) must let it through.
    // Offset from the cedar trunk proxy at x -14.5 so only roof volumes can intervene.
    const high = { x: -16.5, y: y + 6.4, z: -30 }, highDesired = { x: -16.5, y: y + 6.4, z: -40 };
    const highHits = new T.Raycaster(new T.Vector3(high.x, high.y, high.z), direction, 0, 10).intersectObjects(hall);
    assert(highHits.length > 0, "ridge-height ray must hit the authored upper roof");
    const guarded = resolveCameraPosition(high, highDesired, world.cameraObstacles);
    assert(Math.abs(guarded.z - high.z) < highHits[0].distance, "camera entered the upper roof");
    const withoutRoofVolume = world.cameraObstacles.filter((b) => !(b.max.y > y + 7 && b.min.x < -15 && b.max.x > -15));
    const broken = resolveCameraPosition(high, highDesired, withoutRoofVolume);
    assert(
      Math.abs(broken.z - high.z) > highHits[0].distance,
      "fault injection must reproduce upper-roof penetration",
    );
  } finally {
    globalThis.document = previous;
  }
});

test("west pond rim clears the orbit from a legacy saved position", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  try {
    const scene = new T.Scene();
    const world = createWorld(T, scene);
    scene.updateMatrixWorld(true);
    const x = -18.64, z = -9.32;
    const target = new T.Vector3(x, world.height(x, z) + 1.3, z);
    const yaw = 4.32;
    const desired = target.clone().add(new T.Vector3(Math.sin(yaw) * 6.6, 1.84, Math.cos(yaw) * 6.6));
    desired.y = Math.max(desired.y, world.height(desired.x, desired.z) + .8);
    const terrain = scene.children.find((o) => o.geometry?.type === "PlaneGeometry" && o.material.vertexColors);
    function hitsTerrain(camera) {
      const view = target.clone().sub(camera);
      return new T.Raycaster(camera, view.clone().normalize(), 0, view.length()).intersectObject(terrain).length > 0;
    }
    assert(hitsTerrain(desired), "fixture reproduces an obstructed camera");
    const cleared = new T.Vector3().copy(resolveTerrainCamera(target, desired, world.height));
    assert(!hitsTerrain(cleared), "corrected camera must see the traveler above the bank");
    assert(cleared.distanceTo(target) > 1.5);
  } finally {
    globalThis.document = previous;
  }
});


test("steep orbit clears visible torii beams in the pass and Celestial Storm", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  try {
    const scene = new T.Scene();
    const world = createWorld(T, scene);
    world.kit.attachParts(kitParts);
    scene.updateMatrixWorld(true);
    const { height, cameraObstacles } = world;
    const from = new T.Vector3(1.592, height(1.592, 2.141) + 1.3, 2.141);
    const desired = new T.Vector3().copy(orbitPosition(from, 0, .545, 6.6));
    const clear = new T.Vector3().copy(placeOrbitCamera(from, 0, .545, 6.6, height, cameraObstacles));
    const redPieces = scene.children.filter(node => node.isInstancedMesh && /^Kit Torii/.test(node.name));
    const route = desired.clone().sub(from);
    assert(new T.Raycaster(from, route.clone().normalize(), 0, route.length())
      .intersectObjects(redPieces).length > 0, "uncorrected orbit must hit the real gate beam");
    assert(new T.Raycaster(from, route.clone().normalize(), 0, clear.distanceTo(from))
      .intersectObjects(redPieces).length === 0, "corrected camera stays in front of the beam");
    const storm = createStormScene(T, scene, height);
    assert(storm.cameraObstacles.some(({ min, max }) =>
      min.z < -17 && max.z > -17 && max.x - min.x > 6 && max.y - min.y < 1.5));
  } finally {
    globalThis.document = previous;
  }
});

test("upward look keeps the traveler framed from ordinary pitch to overhead at the pond rim", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  try {
    const world = createWorld(T, new T.Scene());
    const { height, cameraObstacles } = world;
    const x = -20.5, z = -12.5, yaw = Math.PI / 4, pitch = -.83;
    const feet = new T.Vector3(x, height(x, z), z);
    const target = feet.clone();
    target.y += 1.3;
    const camera = new T.PerspectiveCamera(54, 1.6, .15, 700);
    let previousEye;
    for (let sample = 0; sample <= 310; sample++) {
      const p = pitch - sample * .002;
      const eye = placeOrbitCamera(target, yaw, p, 6.6, height, cameraObstacles);
      camera.position.copy(eye);
      const angle = orbitLookAngle(target, eye, feet.y, p, T.MathUtils.degToRad(camera.fov));
      if (angle === Math.PI / 2) camera.up.set(Math.sin(yaw), 0, Math.cos(yaw));
      camera.lookAt(eye.x - Math.sin(yaw)*Math.cos(angle), eye.y + Math.sin(angle), eye.z - Math.cos(yaw)*Math.cos(angle));
      camera.updateMatrixWorld(true);
      if (sample === 0) {
        assert(Math.hypot(x-eye.x, z-eye.z) > 1.8);
        assert(feet.clone().project(camera).y > -1, JSON.stringify(eye));
      }
      const head = feet.clone().add(new T.Vector3(0, 1.8, 0)).project(camera);
      assert(Math.abs(head.y) < 1, JSON.stringify({ p, eye, head }));
      if (previousEye) assert(previousEye.distanceTo(camera.position) < .55,
        JSON.stringify({ p, eye, previousEye }));
      previousEye = camera.position.clone();
    }
  } finally {
    globalThis.document = previous;
  }
});
