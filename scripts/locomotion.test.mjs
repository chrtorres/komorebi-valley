import test from "node:test";
import assert from "node:assert/strict";
import { LOCOMOTION, landingRetention, stepLocomotion } from "../src/locomotion-physics.js";

const run = (v, input, seconds, dt = 1 / 120) => {
  for (let t = 0; t < seconds; t += dt) stepLocomotion(v, { dt, ...input });
  return Math.hypot(v.x, v.z);
};

test("ground acceleration ramps toward, and never past, the target speed", () => {
  const v = { x: 0, z: 0 };
  stepLocomotion(v, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true, dt: 1 / 60 });
  assert.ok(Math.hypot(v.x, v.z) <= LOCOMOTION.groundAccel / 60 + 1e-9);
  assert.ok(Math.abs(run(v, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true }, 2) - 7) < 1e-6);
});

test("releasing input brakes to rest within a short, finite slide", () => {
  const v = { x: 7, z: 0 };
  let distance = 0;
  for (let i = 0; i < 240; i++) {
    stepLocomotion(v, { dirX: 0, dirZ: 0, maxSpeed: 7, grounded: true, dt: 1 / 120 });
    distance += v.x / 120;
  }
  assert.equal(v.x, 0);
  assert.ok(distance > .5 && distance < 1.2, `slide ${distance}`);
});

test("reversing skids harder than ordinary braking", () => {
  const skid = { x: 5, z: 0 }, brake = { x: 5, z: 0 };
  stepLocomotion(skid, { dirX: -1, dirZ: 0, maxSpeed: 5, grounded: true, dt: .05 });
  stepLocomotion(brake, { dirX: 0, dirZ: 0, maxSpeed: 5, grounded: true, dt: .05 });
  assert.ok(skid.x < brake.x);
});

test("airborne bodies keep momentum and steer only gently", () => {
  const v = { x: 0, z: -8 };
  stepLocomotion(v, { dirX: 0, dirZ: 0, maxSpeed: 7, grounded: false, dt: .1 });
  assert.ok(v.z < -7.8, "no braking in the air");
  stepLocomotion(v, { dirX: 0, dirZ: -1, maxSpeed: 3.6, grounded: false, dt: .1 });
  assert.ok(v.z < -7.7, "slower input does not bleed leap momentum");
  stepLocomotion(v, { dirX: 1, dirZ: 0, maxSpeed: 7, grounded: false, dt: .1 });
  assert.ok(v.x > 0 && v.x <= LOCOMOTION.airAccel * .1 + 1e-9);
});

test("slopes slow climbing and slightly assist descent", () => {
  const ramp = (x, z) => -z * .4; // rises toward -z
  const up = run({ x: 0, z: 0 }, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true, height: ramp, x: 0, z: 0 }, 2);
  const down = run({ x: 0, z: 0 }, { dirX: 0, dirZ: 1, maxSpeed: 7, grounded: true, height: ramp, x: 0, z: 0 }, 2);
  assert.ok(up < 7 * .7 && down > 7 && down <= 7 * (1 + LOCOMOTION.maxAssist) + 1e-6);
});

test("landing retention keeps soft landings and absorbs hard ones", () => {
  assert.equal(landingRetention(-4), 1);
  assert.ok(landingRetention(-16) < .8 && landingRetention(-40) >= .35);
});

test("takeoff push-off bounds sprint leaps forward and keeps faster momentum", async () => {
  const { pushOff } = await import("../src/locomotion-physics.js");
  const rest = pushOff({ x: 0, z: 0 }, 0, -1, { leap: true });
  assert.ok(Math.abs(rest.z + 6.2) < 1e-9);
  const fast = pushOff({ x: 0, z: -9 }, 0, -1, { leap: true });
  assert.equal(fast.z, -9);
  const hop = pushOff({ x: 0, z: 0 }, 1, 0, { speed: 3.6 });
  assert.ok(Math.abs(hop.x - 1.5) < 1e-9);
  assert.deepEqual(pushOff({ x: 2, z: 0 }, 0, 0), { x: 2, z: 0 });
});

test("fighting stance reverses footwork within a single frame", () => {
  const v = { x: 1.8, z: 0 };
  stepLocomotion(v, { dirX: -1, dirZ: 0, maxSpeed: 1.8, grounded: true, dt: 1 / 60, stance: true });
  assert.ok(v.x < 0);
});
