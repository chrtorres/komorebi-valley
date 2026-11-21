import test from "node:test";
import assert from "node:assert/strict";
import { BODY, LOCOMOTION, landingRetention, stepLocomotion } from "../src/locomotion-physics.js";

const run = (v, input, seconds, dt = 1 / 120) => {
  for (let t = 0; t < seconds; t += dt) stepLocomotion(v, { dt, ...input });
  return Math.hypot(v.x, v.z);
};

test("ground acceleration ramps toward, and never past, the target speed", () => {
  const v = { x: 0, z: 0 };
  stepLocomotion(v, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true, dt: 1 / 60 });
  assert.ok(Math.hypot(v.x, v.z) <= BODY.a0 / 60 + 1e-9);
  assert.ok(Math.abs(run(v, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true }, 4) - 7) < 1e-6);
});

test("releasing input slows to rest at a comfortable deceleration", () => {
  const v = { x: 7, z: 0 };
  let distance = 0;
  for (let i = 0; i < 240; i++) {
    stepLocomotion(v, { dirX: 0, dirZ: 0, maxSpeed: 7, grounded: true, dt: 1 / 120 });
    distance += v.x / 120;
  }
  assert.equal(v.x, 0);
  // Braking distance plus the force-rise lag before full braking: v²/2a + v·τ.
  assert.ok(Math.abs(distance - (49 / (2 * BODY.stop) + 7 * LOCOMOTION.forceRise)) < .15, `slide ${distance}`);
});

test("reversing skids harder than ordinary braking", () => {
  const skid = { x: 5, z: 0 }, brake = { x: 5, z: 0 };
  stepLocomotion(skid, { dirX: -1, dirZ: 0, maxSpeed: 5, grounded: true, dt: .05 });
  stepLocomotion(brake, { dirX: 0, dirZ: 0, maxSpeed: 5, grounded: true, dt: .05 });
  assert.ok(skid.x < brake.x);
});

test("airborne bodies keep momentum and cannot steer", () => {
  const v = { x: 0, z: -8 };
  stepLocomotion(v, { dirX: 0, dirZ: 0, maxSpeed: 7, grounded: false, dt: .1 });
  assert.ok(v.z < -7.8, "no braking in the air");
  stepLocomotion(v, { dirX: 0, dirZ: -1, maxSpeed: 3.6, grounded: false, dt: .1 });
  assert.ok(v.z < -7.7, "slower input does not bleed leap momentum");
  stepLocomotion(v, { dirX: 1, dirZ: 0, maxSpeed: 7, grounded: false, dt: .1 });
  assert.equal(v.x, 0);
});

test("slopes slow climbing and slightly assist descent", () => {
  const ramp = (x, z) => -z * .4; // rises toward -z
  const up = run({ x: 0, z: 0 }, { dirX: 0, dirZ: -1, maxSpeed: 7, grounded: true, height: ramp, x: 0, z: 0 }, 2);
  const down = run({ x: 0, z: 0 }, { dirX: 0, dirZ: 1, maxSpeed: 7, grounded: true, height: ramp, x: 0, z: 0 }, 2);
  assert.ok(up < 7 * .7 && down > 7 && down <= 7 * (1 + LOCOMOTION.maxAssist) + 1e-6);
});

test("landing retention keeps soft landings and absorbs hard ones", () => {
  assert.equal(landingRetention(-3), 1);
  assert.ok(landingRetention(-16) < .8 && landingRetention(-40) >= .35);
});

test("takeoff push-off gives a broad jump from rest and keeps running momentum", async () => {
  const { pushOff } = await import("../src/locomotion-physics.js");
  const rest = pushOff({ x: 0, z: 0 }, 0, -1);
  assert.ok(Math.abs(rest.z + BODY.push) < 1e-9);
  const fast = pushOff({ x: 0, z: -9 }, 0, -1);
  assert.equal(fast.z, -9);
  const hop = pushOff({ x: 0, z: 0 }, 1, 0, BODY.walk);
  assert.ok(Math.abs(hop.x - BODY.walk) < 1e-9);
  assert.deepEqual(pushOff({ x: 2, z: 0 }, 0, 0), { x: 2, z: 0 });
});

test("fighting stance reverses footwork within a single frame", () => {
  const v = { x: 1.8, z: 0 };
  stepLocomotion(v, { dirX: -1, dirZ: 0, maxSpeed: 1.8, grounded: true, dt: 1 / 60, stance: true });
  assert.ok(v.x < 0);
});

test("running turns curve the velocity, slowing to cut instead of sliding along a chord", () => {
  const v = { x: 0, z: -7 };
  let minSpeed = 7, t = 0;
  while (!(v.x > 0 && Math.abs(v.z) < .05) && t < 3) {
    stepLocomotion(v, { dirX: 1, dirZ: 0, maxSpeed: 7, grounded: true, dt: 1 / 120 });
    minSpeed = Math.min(minSpeed, Math.hypot(v.x, v.z));
    t += 1 / 120;
  }
  // Braking and turning share one friction circle (μg) on dry stone: about 1.75 s.
  assert.ok(t < 1.9, `a 90 degree cut from 7 m/s completes in ${t.toFixed(2)} s`);
  assert.ok(minSpeed < 7 * .7 && minSpeed > 7 * LOCOMOTION.cutFloor - .05, `cut speed ${minSpeed.toFixed(2)}`);
  // A gentle bend keeps nearly all speed.
  const bend = { x: 0, z: -7 };
  for (let i = 0; i < 60; i++) stepLocomotion(bend, { dirX: Math.sin(.3), dirZ: -Math.cos(.3), maxSpeed: 7, grounded: true, dt: 1 / 120 });
  assert.ok(Math.hypot(bend.x, bend.z) > 6.5);
  // Lateral acceleration never exceeds grip: the turn takes at least v·Δθ / grip seconds.
  const v2 = { x: 0, z: -7 };
  for (let i = 0; i < 12; i++) stepLocomotion(v2, { dirX: 1, dirZ: 0, maxSpeed: 7, grounded: true, dt: 1 / 120 });
  const turned = Math.atan2(v2.x, -v2.z);
  assert.ok(turned <= LOCOMOTION.lateralGrip / 6.0 * .1 + 1e-6, `turned ${turned} rad in 0.1 s`);
});

test("near-reversals still plant and skid", () => {
  const v = { x: 0, z: -7 };
  stepLocomotion(v, { dirX: 0, dirZ: 1, maxSpeed: 7, grounded: true, dt: 1 / 60 });
  assert.ok(Math.abs(v.x) < 1e-9 && v.z > -7 && v.z < -6, "reversal brakes along the line");
});
