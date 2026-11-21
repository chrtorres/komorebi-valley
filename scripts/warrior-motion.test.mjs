import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Group, Vector3 } from "three";
import { connectWarrior, solveLeg, strideFoot } from "../src/warrior-motion.js";
import { VAULT_SECONDS } from "../src/vault.js";

const sides = ["Left", "Right"];
const dt = 1 / 240;

function motionRig(frameTime = dt) {
  const body = new Group();
  const scene = new Group();
  body.add(scene);
  const addJoint = (parent, name, x, y, z = 0) => {
    const joint = new Group();
    joint.name = name;
    joint.position.set(x, y, z);
    parent.add(joint);
    return joint;
  };
  const root = addJoint(scene, "ValleyWarrior", 0, 0, 0);
  root.scale.setScalar(1.09);
  const pelvis = addJoint(root, "WarriorPelvis", 0, .91);
  const chest = addJoint(pelvis, "WarriorChest", 0, .145);
  for (let i = 0; i < 8; i++) addJoint(pelvis, `Kusazuri${i}`, 0, .06);
  for (const [i, side] of sides.entries()) {
    const sign = i === 0 ? -1 : 1;
    const leg = addJoint(pelvis, side + "Leg", sign * .1, 0);
    const shin = addJoint(leg, side + "Shin", 0, -.42);
    addJoint(shin, side + "Foot", 0, -.42);
    const arm = addJoint(chest, side + "Arm", sign * .21, .255);
    arm.rotation.z = sign * .105;
    const forearm = addJoint(arm, side + "Forearm", 0, -.286);
    addJoint(forearm, side + "Grip", 0, -.281, .012);
  }
  const animate = connectWarrior(scene);
  const joint = name => scene.getObjectByName(name);
  return {
    joint, body, scene,
    frame({ speed = 0, ...props } = {}) {
      const distance = speed * frameTime;
      const heading = props.heading ?? 0;
      const forward = props.forward ?? 1, sideways = props.sideways ?? 0;
      body.position.x += distance * (forward * Math.sin(heading) + sideways * Math.cos(heading));
      body.position.z += distance * (forward * Math.cos(heading) - sideways * Math.sin(heading));
      body.rotation.y = heading;
      animate({ dt: frameTime, distance, grounded: true, forward: 1, vertical: 0, ...props });
    },
  };
}

test("stance cancels body travel and swing clears the ground", () => {
  for (const [cycle, stance, lift] of [[1.16, .6, .13], [1.68, .48, .28]]) {
    const a = strideFoot(.1, cycle, stance, lift);
    const b = strideFoot(.2, cycle, stance, lift);
    assert(Math.abs(b.forward - a.forward + cycle * .1) < 1e-9);
    assert.equal(a.rise, 0);
    assert(Math.abs(strideFoot((stance + 1) / 2, cycle, stance, lift).rise - lift) < 1e-9);
    assert(Math.abs(strideFoot(0, cycle, stance, lift).forward -
      strideFoot(1 - 1e-8, cycle, stance, lift).forward) < 1e-6);
  }
});

test("leg solver reaches plausible ankle targets with forward knee flexion", () => {
  for (const forward of [-.38, 0, .38]) {
    for (const [thigh, shin] of [[.42, .42], [.39, .45]]) {
      const drop = .71;
      const { hip, knee } = solveLeg(forward, drop, thigh, shin);
      assert(knee >= 0 && knee < Math.PI);
      assert(Math.abs(forward + thigh * Math.sin(hip) + shin * Math.sin(hip + knee)) < 1e-8);
      assert(Math.abs(drop - thigh * Math.cos(hip) - shin * Math.cos(hip + knee)) < 1e-8);
    }
  }
});

test("walking transfers between planted feet and sprinting adds flight", () => {
  for (const speed of [3.6, 7]) {
    const { joint, frame } = motionRig();
    const feet = sides.map(side => joint(side + "Foot"));
    const chest = joint("WarriorChest");
    const elbow = joint("LeftForearm");
    let previousContacts = [null, null];
    let steps = 0, flights = 0, doubleSupport = 0, planted = 0, opposed = 0;
    for (let i = 0; i < 360; i++) {
      frame({ speed });
      if (i < 120) continue;
      const contacts = feet.map(foot => {
        const heel = foot.localToWorld(new Vector3(0, -.07, -.07));
        const toe = foot.localToWorld(new Vector3(0, -.07, .15));
        const low = heel.y <= toe.y + 1e-8 ? heel : toe;
        assert(low.y >= -1e-6, "boot clears the local floor plane");
        return low.y < 1e-6 ? { point: low, edge: low === heel ? "heel" : "toe" } : null;
      });
      if (contacts.every(contact => contact === null)) flights++;
      if (contacts.every(Boolean)) doubleSupport++;
      for (const [side, contact] of contacts.entries()) {
        const previous = previousContacts[side];
        if (!previous && contact) steps++;
        if (contact && previous?.edge === contact.edge) {
          assert(Math.abs(contact.point.z - previous.point.z) < 1e-5, "support edge stays in place");
          planted++;
        }
      }
      previousContacts = contacts;
      const lead = feet[0].position.clone();
      const left = feet[0].getWorldPosition(lead).z;
      const right = feet[1].getWorldPosition(new Vector3()).z;
      if (Math.abs(left - right) > .25 && chest.rotation.y * (left - right) < 0) opposed++;
    }
    assert(steps >= 3 && steps <= 5, "cadence at the game's movement speed");
    assert(planted > 100 && opposed > 70);
    if (speed === 3.6) {
      assert.equal(flights, 0);
      assert(doubleSupport > 20);
      assert(chest.rotation.x < .1 && elbow.rotation.x > -.6);
    } else {
      assert(flights > 70);
      assert.equal(doubleSupport, 0);
      assert(chest.rotation.x > .24 && elbow.rotation.x < -.9);
    }
  }
});

test("vault reaches before the deepest tuck and releases into a split landing", () => {
  const { frame, joint } = motionRig();
  const position = name => joint(name).getWorldPosition(new Vector3());
  const frames = [];
  for (let i = 0; i <= 150; i++) {
    const progress = i / 150;
    frame({ grounded: progress === 1, vault: progress, landed: progress === 1 });
    frames.push({
      grip: position("LeftGrip"),
      feet: position("RightFoot").sub(position("LeftFoot")),
      pitch: joint("WarriorChest").rotation.x,
      knee: joint("LeftShin").rotation.x,
    });
  }
  assert(frames[34].grip.z > frames[0].grip.z + .35, "reaches ahead of the body");
  assert(frames[54].grip.y < frames[34].grip.y - .2, "presses down during clearance");
  assert(frames[66].knee > frames[34].knee + .3, "knees gather after the reach begins");
  assert(frames[114].feet.z > .30, "lead leg extends ahead of the trailing leg");
  assert(frames[150].pitch < .1 && frames[150].feet.length() < .23);
  assert(frames.every(({ pitch }) => pitch < 1.35), "vault lean stays bounded across frames");
});

for (const fps of [20, 60]) {
  test(`a neutral input frame preserves the next sprint step at ${fps} Hz`, () => {
    for (let phaseSample = 0; phaseSample < Math.ceil(fps / 2); phaseSample++) {
      const continuous = motionRig(1 / fps);
      const interrupted = motionRig(1 / fps);
      for (let i = 0; i < fps + phaseSample; i++) {
        continuous.frame({ speed: 7 });
        interrupted.frame({ speed: 7 });
      }
      interrupted.frame();
      continuous.frame({ speed: 7 });
      interrupted.frame({ speed: 7 });
      for (const side of sides) {
        const ankle = name => name.joint(side + "Foot").getWorldPosition(new Vector3());
        assert(ankle(continuous).distanceTo(ankle(interrupted)) < 1e-6,
          `${side} sprint step reset after neutral input at sample ${phaseSample}`);
      }
    }
  });

  test(`vault interruption fades the posed offset as air light starts at ${fps} Hz`, () => {
    for (const cancelTime of [.15, .25, .45]) {
      const { frame, joint } = motionRig(1 / fps);
      const chest = joint("WarriorChest");
      const pelvis = joint("WarriorPelvis");
      const grips = sides.map(side => joint(side + "Grip"));
      const position = object => object.getWorldPosition(new Vector3());
      for (let i = 0; i < Math.round(.6 * fps); i++) frame({ speed: 3.6 });
      for (let i = 1; i <= Math.round(cancelTime * fps); i++) {
        frame({ grounded: false, vault: i / fps / VAULT_SECONDS });
      }
      const before = { pitch: chest.rotation.x, yaw: chest.rotation.y, hips: pelvis.position.y,
        grips: grips.map(position) };
      const attack = { grounded: false, vertical: -.9, pose: { action: "airLight", phase: "startup" } };
      frame(attack);
      assert(chest.rotation.y < before.yaw - .035, "strike twist responds on the first frame");
      assert(Math.abs(chest.rotation.x - before.pitch) < (fps === 20 ? .22 : .07), "chest pitch blends out");
      assert(Math.abs(pelvis.position.y - before.hips) < (fps === 20 ? .09 : .04), "hips release gradually");
      for (const [i, grip] of grips.entries()) {
        assert(position(grip).distanceTo(before.grips[i]) < (fps === 20 ? .26 : .12), "grip avoids a first-frame jump");
      }
      for (let i = 0; i < Math.round(.45 * fps); i++) frame(attack);
      assert(chest.rotation.x < .045 && pelvis.position.y > .89, "interrupted vault clears completely");
    }
  });

  test(`stance and toe-off stay anchored across walk, sprint and stop at ${fps} Hz`, () => {
    for (const [from, to] of [[3.6, 7], [7, 3.6], [3.6, 0], [7, 0]]) {
      const { joint, frame } = motionRig(1 / fps);
      const feet = sides.map(side => joint(side + "Foot"));
      const scale = joint("ValleyWarrior").scale.x;
      const advance = speed => {
        frame({ speed });
        return feet.map(foot => {
          const heel = foot.localToWorld(new Vector3(0, -.07, -.07));
          const toe = foot.localToWorld(new Vector3(0, -.07, .15));
          assert(Math.min(heel.y, toe.y) >= -1e-6, `the rolling sole clears the floor: ${heel.y}, ${toe.y} at ${speed}, knee ${joint("LeftShin").rotation.x}`);
          // Compare the same sole origin when support rolls from heel to toe.
          return heel.y <= toe.y + 1e-8 ? { y: heel.y, anchor: heel.z + .07 * scale }
            : { y: toe.y, anchor: toe.z - .15 * scale };
        });
      };
      let pairs = 0;
      for (let sample = 0; sample < 20; sample++) {
        let previous;
        for (let i = 0; i < Math.round(fps * (1 + sample / 40)); i++) previous = advance(from);
        for (let i = 0; i < Math.round(fps * (to ? .24 : .45)); i++) {
          const current = advance(to);
          for (const [side, contact] of current.entries()) {
            const prior = previous[side];
            if (contact.y < .003 && prior.y < .003) {
              const drift = Math.abs(contact.anchor - prior.anchor);
              assert(drift < (to ? .04 : .008), `${from} to ${to} m/s moved a near-ground sole by ${drift} m`);
              pairs++;
            }
          }
          previous = current;
        }
        if (!to) {
          const restZ = joint("ValleyWarrior").getWorldPosition(new Vector3()).z;
          for (const contact of previous) {
            assert(Math.abs(contact.y) < 1e-6 && Math.abs(contact.anchor - restZ) < 1e-6,
              "both soles settle underneath the body");
          }
        }
      }
      assert(pairs >= 25, `sampled consecutive near-ground frames during ${from} to ${to} m/s transitions`);
    }
  });
}

for (const fps of [20, 60]) {
  test(`locked strafes reverse, plant a boot, and settle underneath the body at ${fps} Hz`, () => {
    const { joint, frame, body } = motionRig(1 / fps);
    const ankles = sides.map(side => joint(side + "Foot"));
    const soles = () => ankles.map(foot => foot.localToWorld(new Vector3(0, -.07, 0)));
    let previous, stationary = 0, lifts = 0, lateralReach = 0;
    for (const sideways of [1, -1, 0]) {
      for (let i = 0; i < fps; i++) {
        frame({ speed: sideways ? 3.6 : 0, forward: 0, sideways, committedFacing: true });
        const points = soles();
        if (points.every(point => point.y < .003)) {
          assert(points[1].x - points[0].x > .055, "grounded boots keep their left-right order");
        }
        for (const [index, point] of points.entries()) {
          assert(point.y >= -1e-6, "flat side-step sole must clear the floor");
          if (point.y > .07) lifts++;
          if (Math.abs(point.x - body.position.x) > .26) lateralReach++;
          if (sideways && point.y < .001 && previous?.[index].y < .001 &&
              Math.abs(point.x - previous[index].x) < .005) stationary++;
        }
        previous = points;
      }
    }
    assert(stationary >= fps, "support boots should stay in world space while the body passes");
    assert(lifts >= fps / 4 && lateralReach >= fps / 2, "the boots must visibly step sideways");
    assert(soles().every(point => point.y < .001 && Math.abs(point.x - body.position.x) < .12));
  });

  test(`free turns ease the visible heading and committed actions align on the first frame at ${fps} Hz`, () => {
    let planted = 0;
    for (let offset = 0; offset <= Math.ceil(fps / 2); offset += fps === 60 ? 3 : 1) {
      const { frame, scene, joint } = motionRig(1 / fps);
      const contacts = () => sides.map(side => {
        const foot = joint(side + "Foot");
        const heel = foot.localToWorld(new Vector3(0, -.07, -.07));
        const toe = foot.localToWorld(new Vector3(0, -.07, .15));
        return heel.y <= toe.y + 1e-8 ? { point: heel, edge: "heel" } : { point: toe, edge: "toe" };
      });
      for (let i = 0; i < fps + offset; i++) frame({ speed: 3.6 });
      let previous = contacts();
      const turnFrame = () => {
        frame({ speed: 3.6, heading: Math.PI / 2 });
        const current = contacts();
        for (const [index, { point, edge }] of current.entries()) {
          const prior = previous[index];
          if (point.y < .003 && prior.point.y < .003 && prior.edge === edge) {
            assert(point.distanceTo(prior.point) < .020, "the planted heel or toe stays anchored during a turn");
            planted++;
          }
        }
        previous = current;
      };
      turnFrame();
      assert(scene.rotation.y < -.5 && scene.rotation.y > -Math.PI / 2);
      const lag = Math.abs(scene.rotation.y);
      for (let i = 0; i < fps / 4; i++) turnFrame();
      assert(Math.abs(scene.rotation.y) < lag / 10);
      frame({ speed: 0, heading: -Math.PI / 2, committedFacing: true, pose: { action: "light1", phase: "startup" } });
      assert.equal(scene.rotation.y, 0);
      frame({ speed: 0, heading: 0, reset: true });
      assert.equal(scene.rotation.y, 0);
    }
    assert(planted >= fps, "sampled stable floor contacts across gait phases");
  });
}

test("a committed half-turn holds the boots on the first frame while facing aligns", () => {
  const { frame, scene, joint } = motionRig(1 / 60);
  const toes = () => sides.map(side => joint(side + "Foot").localToWorld(new Vector3(0, -.07, .15)));
  frame();
  const before = toes();
  frame({ heading: Math.PI, committedFacing: true, pose: { action: "guard", guarding: true } });
  assert.equal(scene.rotation.y, 0, "the guard uses gameplay facing immediately");
  const current = toes();
  assert(current.every((toe, i) => toe.distanceTo(before[i]) < .002), "toe contacts survive the guard pivot");
});

test("export contains the complete rig and bounded runtime geometry", () => {
  const asset = readFileSync(new URL("../src/assets/warrior.glb", import.meta.url));
  assert.equal(asset.toString("ascii", 0, 4), "glTF");
  assert.equal(asset.readUInt32LE(8), asset.length);
  assert(asset.length < 6_500_000, "character payload stays below 6.5 MB");
  const design = JSON.parse(asset.toString("utf8", 20, 20 + asset.readUInt32LE(12)));
  const nodes = Object.fromEntries(design.nodes.map((node, i) => [node.name, i]));
  for (const side of ["Left", "Right"]) {
    for (const [parent, child] of [["Leg", "Shin"], ["Shin", "Foot"], ["Arm", "Forearm"], ["Forearm", "Grip"]])
      assert(design.nodes[nodes[side + parent]].children.includes(nodes[side + child]));
  }
  for (let i = 0; i < 8; i++)
    assert(design.nodes[nodes.WarriorPelvis].children.includes(nodes["Kusazuri" + i]));
  const triangles = design.meshes.flatMap(mesh => mesh.primitives)
    .reduce((sum, part) => sum + design.accessors[part.indices].count / 3, 0);
  assert(triangles > 5000 && triangles < 90_000, "character geometry stays below 90K triangles");
  assert(design.meshes.flatMap(mesh => mesh.primitives).length <= 120, "character draw groups stay bounded");
});

test("character export embeds the skin, eyelids, kasa, face wrap and head wrap", () => {
  const asset = readFileSync(new URL("../src/assets/warrior.glb", import.meta.url));
  const design = JSON.parse(asset.toString("utf8", 20, 20 + asset.readUInt32LE(12)));
  const head = design.nodes.find(node => node.name === "WarriorHead");
  const attachments = Object.fromEntries(head.children.map(index => {
    const node = design.nodes[index];
    return [node.name, node];
  }));
  for (const name of ["WarriorFace", "WarriorEyes", "WarriorBrows", "WarriorHelmet", "WarriorMask", "WarriorStormHood"])
    assert(attachments[name], `missing ${name} under the animated head`);
  const face = design.meshes[attachments.WarriorFace.mesh];
  assert.deepEqual(face.extras.targetNames, ["Blink"]);
  assert(face.primitives.every(part => part.targets[0].POSITION !== undefined));
  assert(design.images.every(image => image.bufferView !== undefined && !image.uri));
  for (const name of ["Weathered skin", "iron", "black robe", "crimson", "straw", "wrap"]) {
    const material = design.materials.find(item => item.name === name);
    assert(material.normalTexture);
    assert(material.pbrMetallicRoughness.baseColorTexture);
  }
});
