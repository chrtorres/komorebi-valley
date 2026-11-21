import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { bodyProfile, createRoninScarf, pushOutOfBody } from "../src/ronin-scarf.js";

// A stand-in for the v006 rig: the same node names, pivots and runtime scale.
function rig() {
  const scene = new T.Scene();
  const player = new T.Group();
  scene.add(player);
  const visual = new T.Group();
  player.add(visual);
  const model = new T.Group();
  model.scale.setScalar(1.8 / 1.652);
  visual.add(model);
  const pelvis = new T.Group();
  pelvis.name = "WarriorPelvis";
  pelvis.position.y = .91;
  model.add(pelvis);
  const chest = new T.Group();
  chest.name = "WarriorChest";
  chest.position.y = .145;
  pelvis.add(chest);
  const anchor = new T.Group();
  anchor.name = "RoninScarfAnchor";
  anchor.position.set(.02, .335, -.085);
  chest.add(anchor);
  return { scene, player, visual, pelvis, chest };
}

// Deepest penetration (model metres) of any tail particle into the bare silhouette.
function deepest(scene, frames) {
  let worst = 0;
  const local = new T.Vector3();
  for (const mesh of scene.getObjectByName("RoninScarfTails").children) {
    const a = mesh.geometry.attributes.position;
    // Centre column of each row: the simulated particle itself.
    for (let r = 1; r < a.count / 3; r++) {
      for (const [node, pivot] of frames) {
        local.fromBufferAttribute(a, r * 3 + 1).applyMatrix4(node.matrixWorld.clone().invert());
        const y = local.y + pivot;
        if (pivot > 1 && y < 1) continue;
        const e = bodyProfile(y);
        if (e) {
          const bare = { back: e.back - .03, side: e.side - .03, front: e.front - .03 };
          const depth = local.z < 0 ? bare.back : bare.front;
          const f = (local.x / bare.side) ** 2 + (local.z / depth) ** 2;
          if (f < 1) worst = Math.max(worst, (1 - Math.sqrt(f)) * Math.min(bare.side, depth));
        }
        break;
      }
    }
  }
  return worst;
}

test("the body profile follows the measured cape, robe and collar", () => {
  assert.ok(bodyProfile(1.2).back > .25, "cape back with clearance");
  assert.ok(bodyProfile(1.44).back < .15, "narrow collar");
  assert.equal(bodyProfile(1.7), null);
  const p = { x: 0, y: 1.2, z: -.1 };
  assert.ok(pushOutOfBody(p));
  assert.ok(Math.abs(p.z + bodyProfile(1.2).back) < 1e-9, "pushed straight back onto the cape");
  // A particle that tunnels from behind to the chest exits behind, not through the front.
  const q = { x: 0, y: 1.2, z: .05 };
  pushOutOfBody(q, .02, -.4);
  assert.ok(q.z < -.2);
});

test("scarf tails stay outside the body while running, leaning, banking and turning", () => {
  const { scene, player, visual, pelvis, chest } = rig();
  const scarf = createRoninScarf(T, scene, player);
  const frames = [[chest, 1.055], [pelvis, .91]];
  const dt = 1 / 60;
  let heading = 0, worst = 0;
  for (let i = 0; i < 360; i++) {
    const t = i * dt;
    // Standing, then a sprint with forward lean, then a hard curving turn with bank.
    const speed = t < 1 ? 0 : 7;
    const yawRate = t > 3 ? 2.5 * Math.sin(t * 1.3) : 0;
    heading += yawRate * dt;
    player.rotation.y = heading;
    player.position.x += Math.sin(heading) * speed * dt;
    player.position.z += Math.cos(heading) * speed * dt;
    chest.rotation.x = speed ? .3 : 0;
    visual.rotation.z = T.MathUtils.clamp(-Math.atan(speed * yawRate / 9.81), -.26, .26);
    pelvis.position.y = .91 - (speed ? .04 * Math.abs(Math.sin(t * 9)) : 0);
    scarf.update(dt);
    if (t > .5) worst = Math.max(worst, deepest(scene, frames));
  }
  assert.ok(worst < .01, `a tail particle sank ${(worst * 100).toFixed(1)} cm into the body`);
  for (const tip of scarf.tips()) assert.ok(Number.isFinite(tip.x + tip.y + tip.z));
});
