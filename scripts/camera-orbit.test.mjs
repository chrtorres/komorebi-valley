import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PITCH, orbitLookAngle, orbitPitch, orbitPosition } from "../src/camera-orbit.js";

const pivot = { x: 0, y: 1.3, z: 0 };
const fov = 54 * Math.PI / 180;

test("vertical orbit preserves default framing and has substantial travel", () => {
  const initial = orbitPosition(pivot, 0, DEFAULT_PITCH, 6.6);
  assert(Math.abs(initial.z - 6.6) < 1e-9);
  assert(Math.abs(initial.y - 3.14) < 1e-9);
  const high = orbitPosition(pivot, 0, orbitPitch(100), 6.6);
  const low = orbitPosition(pivot, 0, orbitPitch(-100), 6.6);
  assert(high.y > 7 && low.y < 0);
  assert(high.z > 2 && Math.abs(low.z - .38) < 1e-9);
  assert.equal(orbitPitch(undefined), DEFAULT_PITCH);
});

test("ground-limited orbit looks up while leaving the feet in frame", () => {
  const pitch = orbitPitch(-.78);
  const eye = { ...orbitPosition(pivot, 0, pitch, 6.6), y: .45 };
  const aimAngle = orbitLookAngle(pivot, eye, 0, pitch, fov);
  const feetAngle = Math.atan2(-eye.y, eye.z);
  assert(aimAngle > .24);
  assert(aimAngle - feetAngle < fov / 2);
  assert.equal(orbitLookAngle(pivot, eye, 0, .25, fov), Math.atan2(pivot.y-eye.y, eye.z));
  assert.equal(orbitLookAngle(pivot, pivot, 0, pitch, fov), 0);
});

test("full upward input aims at the zenith", () => {
  const pitch = orbitPitch(-100);
  const eye = { ...orbitPosition(pivot, 1.3, pitch, 6.6), y: .45 };
  assert.equal(orbitLookAngle(pivot, eye, 0, pitch, fov), Math.PI / 2);
});
