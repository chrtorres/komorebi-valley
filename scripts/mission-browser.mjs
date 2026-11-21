// Full playthrough of the Ridge Signal mission through the real controller path.
// A synthetic standard gamepad is driven by an in-page autopilot that reads game state
// each frame and sets sticks/buttons as a player would. After the opening placement at
// the watch marker the body is never moved directly: every metre is walked, leapt,
// wall-run, climbed and fought through input.
// BASE_URL (default http://127.0.0.1:5193), EVIDENCE_DIR (outside the repository), BROWSER_GPU=1.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL || "http://127.0.0.1:5193";
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(os.tmpdir(), `mission-${Date.now()}`));
await mkdir(evidence, { recursive: true });
const repo = await realpath(fileURLToPath(new URL("..", import.meta.url)));
assert(path.relative(repo, await realpath(evidence)).startsWith(".."), "EVIDENCE_DIR must be outside the repository");
const args = process.env.BROWSER_GPU === "1" ? ["--use-gl=angle", "--use-angle=gl"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const report = { base, checks: [], errors: [], timeline: [] };
const check = (name, ok, detail = "") => {
  report.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--no-sandbox", ...args] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text()); });
await page.addInitScript(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  window.testPad = { connected: false, mapping: "standard", index: 0, buttons, axes: [0, 0, 0, 0] };
  Object.defineProperty(navigator, "getGamepads", { value: () => window.testPad.connected ? [window.testPad] : [] });
});
await page.goto(`${base}/?title=0`);
await page.waitForFunction(() => window.valley?.state.frames > 30 && window.valley.player.getObjectByName("ValleyWarrior"), null, { timeout: 90000 });

// ---------------------------------------------------------------- in-page autopilot
await page.evaluate(() => {
  const pad = window.testPad;
  const set = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  const tap = (i) => { set(i, true); setTimeout(() => set(i, false), 90); };
  const S = () => window.valley.state;
  function steer(wx, wz, sprint) {
    // Invert the game's camera-relative mapping so the stick pushes toward (wx, wz).
    const len = Math.hypot(wx, wz) || 1, c = Math.cos(S().yaw), s = Math.sin(S().yaw);
    const dx = wx / len, dz = wz / len;
    pad.axes[0] = c * dx - s * dz;
    pad.axes[1] = s * dx + c * dz;
    set(7, !!sprint);
  }
  function release() { pad.axes[0] = pad.axes[1] = 0; set(7, false); }
  window.pilot = {
    tap, release,
    /** Move toward `target` until `done(state)`; optional jump(state, distance) fires one jump. */
    go(target, { sprint = false, jump = null, jump2 = null, done, timeout = 15000, aim = null } = {}) {
      return new Promise((resolve, reject) => {
        const t0 = performance.now();
        let jumped = false, jumped2 = false;
        const tick = () => {
          const st = S(), [x, , z] = st.position;
          const d = Math.hypot(target.x - x, target.z - z);
          if (done(st, d)) { release(); return resolve({ ms: performance.now() - t0, position: st.position }); }
          if (performance.now() - t0 > timeout) { release(); return reject(new Error(`autopilot timeout toward ${JSON.stringify(target)} at ${JSON.stringify(st.position)} stage ${st.mission.stage}`)); }
          const a = aim ? aim(st) : target;
          if (st.grounded && d < .3 && !jump) release();
          else steer(a.x - x, a.z - z, sprint && !(st.grounded && d < 1.2 && st.position[1] > window.valley.world.height(x, z) + .8));
          if (jump && !jumped && st.grounded && jump(st, d)) { jumped = true; tap(0); }
          else if (jump2 && jumped && !jumped2 && !st.grounded && jump2(st, d)) { jumped2 = true; tap(0); }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
  };
});
const go = (target, opts) => page.evaluate(([t, o]) => {
  const fn = (src) => src && new Function("st", "d", src);
  return window.pilot.go(t, { ...o, jump: fn(o.jump), jump2: fn(o.jump2), done: fn(o.done), aim: o.aim && new Function("st", o.aim) });
}, [target, opts]);
const state = () => page.evaluate(() => window.valley.state);
const shot = (name) => page.screenshot({ path: path.join(evidence, `${name}.png`) });
const mark = async (label) => report.timeline.push({ label, t: Date.now(), state: await state() });

try {
  // Course geometry is read from the game, not duplicated here.
  const course = await page.evaluate(() => {
    const posts = [...window.valley.player.parent.getObjectByName("Free-run course").children]; // presence check
    return { posts: posts.length };
  });
  check("free-run course is in the scene", course.posts >= 6, `${course.posts} meshes`);
  await page.evaluate(() => { window.testPad.connected = true; });

  // Opening placement: stand at the watch marker (the only direct move in this run).
  await page.evaluate(() => {
    const { player, world } = window.valley, m = world.watchMarker;
    player.position.set(m.x, world.height(m.x, m.z + 1.2), m.z + 1.2);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.pilot.tap(2));
  await page.waitForFunction(() => window.valley.state.mission.stage === 1);
  const notice = await page.locator("#notice").textContent();
  check("X at the watch marker begins the mission and keeps the marker lore", /cedar court/.test(notice) && /ridge beacon/.test(notice));
  await page.waitForTimeout(1200);
  await shot("01-mission-card");
  await mark("start");

  // 1 · Reach the cloister: run the lantern path to the first post.
  await go({ x: 5.6, z: -42.9 }, { sprint: true, done: "return st.mission.stage >= 2", timeout: 30000 });
  check("objective 1 reached on foot", (await state()).mission.stage === 2);
  await go({ x: 5.6, z: -42.9 }, { done: "return d < .35", timeout: 6000 });
  await shot("02-cloister");

  // 2 · Free-run the posts: sprint leaps with automatic pull-ups.
  const posts = [[3.2, -42.9], [-3.1, -42.8], [-9.4, -42.7]];
  for (const [i, [x, z]] of posts.entries()) {
    const startD = i === 0 ? null : Math.hypot(x - posts[i - 1][0], z - posts[i - 1][1]);
    await go({ x, z }, {
      // A plain hop onto the low first post; sprint leaps span the 4.4 m gaps after it.
      sprint: i > 0,
      jump: i === 0 ? "return d < 2.1" : `return d < ${(startD - .2).toFixed(2)}`,
      // On top: grounded well above the terrain within the post's footprint.
      done: "return st.grounded && Math.hypot(st.position[0] - " + x + ", st.position[2] - " + z + ") < .8 && st.position[1] > " + `window.valley.world.height(${x}, ${z}) + .8`,
      timeout: 6000,
    });
    await page.evaluate(() => window.pilot.release());
    await page.waitForTimeout(250);
  }
  const onLast = await state();
  check("leapt and mantled all three stone posts", onLast.mission.stage === 3, `stage ${onLast.mission.stage}`);
  await shot("03-last-post");

  // 3 · Wall-run the cloister wall onto the shrine roof.
  const runSeen = page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    const poll = () => window.valley.state.parkour.wallRun ? resolve(true) : performance.now() - t0 > 6000 ? resolve(false) : requestAnimationFrame(poll);
    poll();
  }));
  await go({ x: -15, z: -42.95 }, {
    sprint: true,
    jump: "return Math.hypot(st.position[0] + 9.4, st.position[2] + 42.7) > .2",
    jump2: "return st.parkour.wallRun && st.position[0] < -13.0",
    // Angle in to hug the wall, then run its length.
    aim: "return st.parkour.wallRun || st.position[0] < -11.4 ? { x: -18, z: -42.85 } : { x: -11.6, z: -43.05 }",
    done: "return st.mission.stage >= 4",
    timeout: 8000,
  });
  check("wall-run engaged along the cloister wall", await runSeen);
  check("reached the shrine roof (objective 3)", (await state()).mission.stage === 4);
  await page.waitForTimeout(300);
  await shot("04-roof");

  // 4 · Climb to the ridge and light the beacon.
  const beacon = await page.evaluate(() => {
    const b = window.valley.player.parent.getObjectByName("Free-run course");
    return { x: -14.1, z: -37 };
  });
  await go(beacon, { done: "return st.grounded && d < 1.1", timeout: 12000 });
  const ridge = await state();
  check("walked up the authored roof to the ridge", ridge.position[1] > (await page.evaluate(() => window.valley.world.height(-15, -37))) + 6.0, `y ${ridge.position[1].toFixed(2)}`);
  await page.evaluate(() => window.pilot.tap(2));
  await page.waitForFunction(() => window.valley.state.mission.stage === 5);
  await page.waitForTimeout(1600);
  await shot("05-beacon-lit");
  check("beacon lit; the Hollow General wakes", (await state()).combat.enemies.some((e) => e.id === "hollow-general" && e.health > 0));

  // 5 · Defeat the Hollow General: descend, lock on, strike, guard on windups.
  const fight = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    let lastSwing = 0, locked = false, deaths = 0, wasAlive = true, guardHeld = 0;
    const tick = () => {
      const st = window.valley.state, g = st.combat.enemies.find((e) => e.id === "hollow-general");
      if (st.mission.stage === 6) { window.pilot.release(); return resolve({ ok: true, ms: performance.now() - t0, deaths }); }
      if (performance.now() - t0 > 150000) { window.pilot.release(); return resolve({ ok: false, deaths, g }); }
      const alive = st.combat.player.health > 0;
      if (!alive) {
        if (wasAlive) deaths++;
        window.pilot.release();
        if (!document.querySelector("#respawn").hidden) window.pilot.tap(0);
        locked = false;
      } else if (g) {
        const [x, , z] = st.position, d = Math.hypot(g.x - x, g.z - z);
        if (d > 1.7) {
          const len = d || 1, c = Math.cos(st.yaw), s = Math.sin(st.yaw), dx = (g.x - x) / len, dz = (g.z - z) / len;
          window.testPad.axes[0] = c * dx - s * dz; window.testPad.axes[1] = s * dx + c * dz;
          window.testPad.buttons[7] = { pressed: d > 5, value: d > 5 ? 1 : 0 };
        } else { window.pilot.release(); }
        if (d < 7 && !locked && st.grounded) { window.pilot.tap(11); locked = true; }
        // Read the amber ring like a player: guard on its last beat to parry, then punish.
        const parryBeat = g.phase === "telegraph" && g.timer <= .11 && d < 3;
        if (parryBeat && !guardHeld) { window.testPad.buttons[6] = { pressed: true, value: 1 }; guardHeld = performance.now(); }
        if (guardHeld && performance.now() - guardHeld > 220) { window.testPad.buttons[6] = { pressed: false, value: 0 }; guardHeld = 0; }
        const opening = /recover|hitstun/.test(g.phase);
        if (opening && d < 2.3 && !guardHeld && performance.now() - lastSwing > 230) { window.pilot.tap(5); lastSwing = performance.now(); }
      }
      wasAlive = alive;
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.waitForTimeout(1200);
  await shot("06-mission-complete");
  check("defeated the Hollow General through combat input", fight.ok, JSON.stringify({ ms: Math.round(fight.ms), deaths: fight.deaths }));
  const done = await state();
  check("mission completes with a debrief card", done.mission.stage === 6 && done.mission.completed &&
    await page.locator("#mission-card.show").count() === 1, `time ${done.mission.time?.toFixed(1)}s, runs ${done.mission.stats.wallRuns}, ledges ${done.mission.stats.mantles}`);

  // Persistence: completion survives a reload on the same origin.
  await page.reload();
  await page.waitForFunction(() => window.valley?.state.frames > 10);
  const after = await state();
  check("completion and best time persist across reload", after.mission.stage === 6 && after.mission.completed && after.mission.best > 0);
} catch (error) {
  check("mission playthrough", false, error.message);
  await shot("failure").catch(() => {});
} finally {
  check("no page errors", report.errors.length === 0, report.errors.slice(0, 3).join(" | "));
  report.passed = report.checks.filter((c) => c.ok).length;
  report.failed = report.checks.filter((c) => !c.ok).length;
  await writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`${report.passed} passed, ${report.failed} failed · ${evidence}`);
  process.exit(report.failed ? 1 : 0);
}
