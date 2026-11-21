import test from "node:test";
import assert from "node:assert/strict";
import {
  PARKOUR, findKick, findMantle, findWallRun, mantlePose, resolveBody, roofHeight, stillOnWall, surfaceHeight,
} from "../src/parkour.js";

const post = { kind: "cyl", cx: 0, cz: 0, r: .5, y0: 0, top: 1.5 };
const wall = { kind: "box", cx: 0, cz: 0, hx: 3, hz: .2, y0: 0, top: 5, runnable: true };
const course = (solids, surfaces = []) => ({ solids, surfaces });

test("roof profile: eaves, upswept corners, slopes and ridge", () => {
  assert.equal(roofHeight(6, 0), -Infinity, "outside the footprint");
  const midEave = roofHeight(0, 4.79), corner = roofHeight(5.79, 4.79);
  assert.ok(midEave > 3.9 && midEave < 4.1, `mid eave ${midEave}`);
  assert.ok(corner > midEave + .6, "corners sweep upward");
  assert.ok(roofHeight(0, 1.5) > roofHeight(0, 2.4), "upper roof rises toward the ridge");
  assert.equal(roofHeight(0, 0), 7.1, "ridge beam top");
});

test("surfaces count only when reachable by stepping", () => {
  const c = course([post], [{ kind: "roof", hall: { x: 20, y: 0, z: 0 } }]);
  assert.equal(surfaceHeight(c, 0, 0, 1.5), 1.5, "standing on the post");
  assert.equal(surfaceHeight(c, 0, 0, 1.0), 1.5, "a .5 m ledge is stepped onto");
  assert.equal(surfaceHeight(c, 0, 0, .2), -Infinity, "too high to step");
  assert.ok(surfaceHeight(c, 20, 1, 6) > 5, "roof underfoot");
  assert.equal(surfaceHeight(c, 20, 1, 1), -Infinity, "inside under the roof, it is not a floor");
});

test("solids push the body out and slide along faces", () => {
  const c = course([wall]);
  const r = resolveBody(c, .5, .3, 0);
  assert.ok(r.z >= .2 + PARKOUR.radius - 1e-3 && Math.abs(r.x - .5) < 1e-9, "pushed straight out, tangential motion kept");
  assert.equal(resolveBody(c, .5, .3, 5).z, .3, "standing above the top: no block");
});

test("mantle reaches ledges up to 1.9 m and lands on top", () => {
  const c = course([post]);
  const m = findMantle(c, 1.1, 0, -1, 0, .1);
  assert.ok(m && m.y === 1.5 && Math.hypot(m.x, m.z) <= .5, JSON.stringify(m));
  assert.equal(findMantle(c, 1.1, 0, -1, 0, -1), null, "2.5 m is out of reach");
  assert.equal(findMantle(c, 1.1, 0, 1, 0, .1), null, "facing away");
});

test("wall-climb kick only for faces too tall to mantle and run into head-on", () => {
  const tall = { ...post, top: 3 };
  const c = course([tall]);
  assert.ok(findKick(c, .9, 0, -1, 0, 0));
  assert.equal(findKick(c, .9, 0, 0, 1, 0), null, "glancing");
  assert.equal(findKick(course([post]), .9, 0, -1, 0, 0), null, "mantle range instead");
});

test("wall-run needs speed, a tall runnable face and a parallel line", () => {
  const c = course([wall]);
  const run = findWallRun(c, 0, .7, -6.5, -.8, 1.5);
  assert.ok(run && run.nz === 1 && run.tx < 0, JSON.stringify(run));
  assert.equal(findWallRun(c, 0, .7, -3, 0, 1.5), null, "too slow");
  assert.equal(findWallRun(c, 0, .7, 0, -6, 1.5), null, "head-on is not a run");
  assert.equal(findWallRun(c, 0, .7, -6.5, 0, 4.8), null, "above the runnable band");
  assert.ok(stillOnWall(run, -2.5, .6, 1.8));
  assert.equal(stillOnWall(run, -3.8, .6, 1.8), false, "past the wall end");
});

test("mantle pose rises before rolling over the lip and ends on target", () => {
  const from = { x: 0, y: 0, z: 0 }, to = { x: 1, y: 1.5, z: 0 };
  const early = mantlePose(from, to, .3), end = mantlePose(from, to, 1);
  assert.ok(early.y > .6 && early.x < .05, "hands pull up first");
  assert.ok(Math.abs(end.x - 1) < 1e-9 && end.y > 1.5);
});
