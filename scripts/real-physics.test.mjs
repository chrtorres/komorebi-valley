// Real-world baseline: the body's numbers must match measured human movement, and the
// free-run course must be traversable with them (and only with them).
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  BODY, LOCOMOTION, dragFactor, jumpReach, landingRetention, pushOff, stepLocomotion,
} from "../src/locomotion-physics.js";
import { PARKOUR, findMantle, findWallRun, resolveBody, surfaceHeight, topAt } from "../src/parkour.js";
import { createFreeRunCourse, COURSE, HALLS } from "../src/free-run-course.js";
import { terrainHeight } from "../src/valley-world.js";

const DT = 1 / 240;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test("jumps match measured takeoff: 0.37 m standing, 0.55 m leap, footage flight 0.667 s", () => {
  assert.ok(near(BODY.jump ** 2 / (2 * BODY.g), .37, .01));
  assert.ok(near(BODY.leap ** 2 / (2 * BODY.g), .555, .01));
  // Reference footage: takeoff frame 10-11, landing frame 31 at 29.97 fps.
  assert.ok(near(2 * BODY.leap / BODY.g, 20 / 29.97, .015), "leap flight time matches the trickster");
});

test("sprint from rest follows the force-velocity curve: 30 m in 4.3-5.3 s, capped at sprint", () => {
  const v = { x: 0, z: 0 };
  let t = 0, d = 0, at1 = 0, peak = 0;
  while (d < 30) {
    stepLocomotion(v, { dirX: 0, dirZ: 1, maxSpeed: BODY.sprint, grounded: true, dt: DT });
    t += DT; d += v.z * DT; peak = Math.max(peak, v.z);
    if (!at1 && t >= 1) at1 = v.z;
  }
  assert.ok(t > 4.3 && t < 5.3, `30 m in ${t.toFixed(2)} s`);
  assert.ok(at1 > 4.5 && at1 < 6.2, `speed after 1 s ${at1.toFixed(2)} m/s`);
  assert.ok(peak <= BODY.sprint * 1.01, `peak ${peak}`); // force-rise lag overshoots < 1%
});

test("stopping and reversing are friction-limited", () => {
  const stop = { x: 0, z: BODY.sprint };
  let d = 0;
  while (stop.z > 0) { stepLocomotion(stop, { dirX: 0, dirZ: 0, maxSpeed: BODY.sprint, grounded: true, dt: DT }); d += stop.z * DT; }
  const expected = BODY.sprint ** 2 / (2 * BODY.stop) + BODY.sprint * LOCOMOTION.forceRise;
  assert.ok(near(d, expected, .15), `stopping distance ${d.toFixed(2)} m, expected ${expected.toFixed(2)}`);
  const rev = { x: 0, z: BODY.sprint };
  stepLocomotion(rev, { dirX: 0, dirZ: -1, maxSpeed: BODY.sprint, grounded: true, dt: .1 });
  assert.ok(BODY.sprint - rev.z <= BODY.mu * BODY.g * .1 + 1e-9, "reversal decelerates at most μg");
});

test("curving runs never exceed μg of lateral acceleration", () => {
  const v = { x: 0, z: BODY.sprint };
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    const before = { ...v };
    stepLocomotion(v, { dirX: 1, dirZ: 0, maxSpeed: BODY.sprint, grounded: true, dt: DT });
    const ax = (v.x - before.x) / DT, az = (v.z - before.z) / DT, speed = Math.hypot(before.x, before.z);
    // Component of acceleration perpendicular to the velocity.
    worst = Math.max(worst, Math.abs(ax * before.z - az * before.x) / speed);
  }
  assert.ok(worst <= BODY.mu * BODY.g * 1.01, `lateral ${worst.toFixed(2)} m/s²`);
});

test("in the air the centre of mass is ballistic: no steering, only drag", () => {
  const v = { x: 0, z: BODY.sprint };
  stepLocomotion(v, { dirX: 1, dirZ: 0, maxSpeed: BODY.sprint, grounded: false, dt: .1 });
  assert.equal(v.x, 0, "input cannot steer the body in flight");
  const decel = (BODY.sprint - v.z) / .1;
  assert.ok(decel > .15 && decel < .35, `drag at sprint ${decel.toFixed(3)} m/s²`);
  // Terminal velocity of a falling person: about 45-55 m/s.
  let vy = 0;
  for (let i = 0; i < 60 / DT; i++) { vy -= BODY.g * DT; vy *= dragFactor(Math.abs(vy), DT); }
  assert.ok(vy < -44 && vy > -56, `terminal ${vy.toFixed(1)} m/s`);
});

test("take-off and landing: broad jump push, running jumps keep speed, 2 m drop is hard", () => {
  const stand = pushOff({ x: 0, z: 0 }, 0, 1);
  assert.ok(near(stand.z, BODY.push, 1e-9));
  assert.ok(near(jumpReach(BODY.push, BODY.jump) + .7, 2.1, .3), "standing broad jump ≈ 2.1 m incl. leg reach");
  const run = pushOff({ x: 0, z: 7 }, 0, 1);
  assert.equal(run.z, 7, "legs cannot add speed to a sprint");
  assert.ok(near(jumpReach(BODY.sprint, BODY.leap), 5.05, .05), "running leap ≈ 5 m");
  assert.ok(near(LOCOMOTION.hardLanding, Math.sqrt(2 * BODY.g * 2), 1e-9));
  assert.equal(landingRetention(-Math.sqrt(2 * BODY.g * .5)), 1, "a 0.5 m drop keeps all speed");
  assert.ok(landingRetention(-Math.sqrt(2 * BODY.g * 3)) < .9, "a 3 m drop absorbs speed");
});

test("turn transitions are smooth: bounded jerk, friction circle and pivot-limited facing", async () => {
  const { steerFacing } = await import("../src/locomotion-physics.js");
  const dt = 1 / 60, dir = (a, m = 1) => ({ x: Math.sin(a) * m, z: Math.cos(a) * m });
  const scenarios = {
    "run 90° cut": [BODY.run, (t) => dir(t < 1 ? 0 : Math.PI / 2)],
    "sprint 90° cut": [BODY.sprint, (t) => dir(t < 2.5 ? 0 : Math.PI / 2)],
    "run 135° turn": [BODY.run, (t) => dir(t < 1 ? 0 : 2.36)],
    "run 180° reverse": [BODY.run, (t) => dir(t < 1 ? 0 : Math.PI)],
    "walk 90° cut": [BODY.run, (t) => dir(t < 1 ? 0 : Math.PI / 2, .45)],
    "sprint slalom": [BODY.sprint, (t) => dir(t < 2.5 ? 0 : Math.sin((t - 2.5) * 4.4) * 1.05)],
    "stick sweep": [BODY.run, (t) => dir(t < 1 ? 0 : (t - 1) * 2.5)],
  };
  for (const [name, [max, stick]] of Object.entries(scenarios)) {
    const v = { x: 0, z: 0 };
    let facing = 0, prevA = null, jerk = 0, force = 0, snap = 0;
    for (let t = 0; t < 5; t += dt) {
      const d = stick(t), before = { ...v };
      stepLocomotion(v, { dirX: d.x, dirZ: d.z, maxSpeed: max, grounded: true, dt });
      const a = { x: (v.x - before.x) / dt, z: (v.z - before.z) / dt };
      force = Math.max(force, Math.hypot(a.x, a.z));
      if (prevA) jerk = Math.max(jerk, Math.hypot(a.x - prevA.x, a.z - prevA.z) / dt);
      prevA = a;
      // The game's facing rule: travel direction once moving, else the stick, at a pivot rate.
      const want = Math.hypot(v.x, v.z) > .8 ? Math.atan2(v.x, v.z) : Math.atan2(d.x, d.z);
      const next = steerFacing(facing, want, dt);
      snap = Math.max(snap, Math.abs(Math.atan2(Math.sin(next - facing), Math.cos(next - facing))));
      facing = next;
    }
    // Leg force rises over ~80 ms: jerk stays near μg/τ (≈ 75 m/s³), never a one-frame switch.
    assert.ok(jerk < 150, `${name}: jerk ${jerk.toFixed(0)} m/s³`);
    assert.ok(force <= BODY.mu * BODY.g + 1e-6, `${name}: ${force.toFixed(2)} m/s² exceeds grip`);
    assert.ok(snap <= LOCOMOTION.pivotRate * dt + 1e-9, `${name}: facing jumped ${snap.toFixed(3)} rad`);
  }
});

// ------------------------------------------------------------------ course feasibility
const scene = new T.Scene();
const freeRun = createFreeRunCourse(T, scene, { height: terrainHeight, lanterns: [] });
const { course } = freeRun;

/**
 * Headless flight with the game's airborne rules: ballistic body, real gravity and drag,
 * scenery collision, and a pull-up when a ledge comes within reach. Returns the landing.
 */
function fly(x, z, feet, vx, vz, vy, dir) {
  const v = { x: vx, z: vz };
  for (let t = 0; t < 3; t += DT) {
    stepLocomotion(v, { dirX: dir.x, dirZ: dir.z, maxSpeed: BODY.sprint, grounded: false, dt: DT });
    const b = resolveBody(course, x + v.x * DT, z + v.z * DT, feet);
    x = b.x; z = b.z;
    vy -= BODY.g * DT; vy *= dragFactor(Math.abs(vy), DT); feet += vy * DT;
    const ledge = vy < 4.5 && findMantle(course, x, z, dir.x, dir.z, feet);
    if (ledge) return { ...ledge, how: "pull-up" };
    const ground = Math.max(terrainHeight(x, z), surfaceHeight(course, x, z, feet));
    if (feet <= ground) return { x, z, y: ground, how: "landed" };
  }
  return null;
}
const unit = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z); return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
const onTop = (p, s) => Math.hypot(p.x - s.cx, p.z - s.cz) <= s.r && Math.abs(p.y - s.top) < .05;

test("course posts are reachable post to post with a short run-up and a pull-up", () => {
  const posts = freeRun.posts;
  assert.equal(posts.length, COURSE.posts.length);
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i], b = posts[i + 1], dir = unit({ x: a.cx, z: a.cz }, { x: b.cx, z: b.cz });
    // Two strides from the far side of the top: about 1.3 m of run-up.
    const v = { x: 0, z: 0 };
    let x = a.cx - dir.x * .65, z = a.cz - dir.z * .65;
    while (Math.hypot(x - a.cx, z - a.cz) < .65 || (x - a.cx) * dir.x + (z - a.cz) * dir.z < .6) {
      stepLocomotion(v, { dirX: dir.x, dirZ: dir.z, maxSpeed: BODY.sprint, grounded: true, dt: DT });
      x += v.x * DT; z += v.z * DT;
    }
    pushOff(v, dir.x, dir.z);
    const land = fly(x, z, a.top, v.x, v.z, BODY.leap, dir);
    assert.ok(land && onTop(land, b), `post ${i + 1} → ${i + 2}: ${JSON.stringify(land)}`);
  }
});

test("a standing jump cannot clear a post gap without the pull-up, so the course needs climbing", () => {
  const [a, b] = freeRun.posts, gap = Math.hypot(b.cx - a.cx, b.cz - a.cz) - a.r - b.r;
  assert.ok(jumpReach(BODY.push, BODY.jump, b.top - a.top) < gap, "pure standing jump falls short");
  assert.ok(gap < jumpReach(4, BODY.leap, b.top - a.top) + .85, "run-up plus catch reaches");
});

test("from the path a sprint leap and pull-up lands on the first post", () => {
  const p = freeRun.posts[0], dir = { x: -1, z: 0 };
  const x = p.cx + p.r + .45, z = p.cz, feet = terrainHeight(x, z);
  assert.ok(p.top - feet > PARKOUR.step, "too high to step onto");
  const land = fly(x, z, feet, BODY.sprint * dir.x, 0, BODY.leap, dir);
  assert.ok(land && onTop(land, p), JSON.stringify(land));
});

test("the shrine roof is reachable from the last post by a jump and a pull-up", () => {
  const p = freeRun.posts.at(-1), dir = { x: 0, z: 1 };
  const x = p.cx, z = p.cz + p.r - .1;
  const land = fly(x, z, p.top, 0, BODY.push, BODY.jump, dir);
  assert.ok(land && land.how === "pull-up", JSON.stringify(land));
  assert.ok(freeRun.onRoof(land.x, land.y, land.z), "standing on the roof");
});

test("the cloister corridor allows a sprinting wall-run and a kick north onto the eave", () => {
  const w = freeRun.wall, z = w.cz + w.hz + PARKOUR.radius + .25, x = w.cx + w.hx - .8;
  const feet = terrainHeight(x, z) + .35; // airborne beside the wall
  const run = findWallRun(course, x, z, -BODY.sprint, .4, feet);
  assert.ok(run, "sprinting alongside the wall engages a wall-run");
  assert.equal(findWallRun(course, x, z, -3, .2, feet), null, "too slow to hold the wall");
  // Caught at takeoff (feet at ground level, leap rise kept), a 0.3 s wall-run arc, then
  // a wall-jump north (away from the face) toward the eave — as the game plays it.
  const ground = terrainHeight(x, z);
  let vy = Math.max(BODY.leap, PARKOUR.runLift), y = ground;
  for (let t = 0; t < .3; t += DT) { vy -= PARKOUR.runGravity * DT; y += vy * DT; }
  const land = fly(x - BODY.sprint * .3, z, y, run.tx * BODY.sprint * .8 + run.nx * PARKOUR.jumpAway,
    run.tz * BODY.sprint * .8 + run.nz * PARKOUR.jumpAway, PARKOUR.jumpUp, { x: 0, z: 1 });
  assert.ok(land && freeRun.onRoof(land.x, land.y, land.z), JSON.stringify(land));
});

test("roof and wall tops stay out of reach without climbing", () => {
  const hall = HALLS[COURSE.beaconHall];
  assert.ok(topAt(course, hall[0], hall[1]) - terrainHeight(hall[0], hall[1]) > BODY.reach + BODY.leap ** 2 / (2 * BODY.g),
    "the ridge cannot be reached from the ground in one jump");
  assert.ok(freeRun.wall.top - terrainHeight(freeRun.wall.cx, freeRun.wall.cz) > PARKOUR.kickMax,
    "the cloister wall is a wall to run, not to climb");
});
