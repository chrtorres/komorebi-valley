import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:5191/";
const saveKey = "komorebi.journey.v1";
const timeout = 45_000;
const repository = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const evidence = process.env.EVIDENCE_DIR
  ? resolve(process.env.EVIDENCE_DIR)
  : await mkdtemp(join(tmpdir(), "valley-vault-"));
function assertOutsideRepository(directory) {
  const path = relative(repository, directory);
  assert(path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path),
    "EVIDENCE_DIR must be outside the repository");
}
assertOutsideRepository(evidence);
await mkdir(evidence, { recursive: true });
assertOutsideRepository(await realpath(evidence));

const gpu = process.env.BROWSER_GPU === "1";
const browser = await chromium.launch({
  args: gpu
    ? ["--no-sandbox", "--use-gl=angle", "--use-angle=gl"]
    : ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];

function installFixtures({ saveKey, seedJourney, freezeForActiveSave, frameRate, timeout }) {
  const button = (pressed) => ({ pressed, touched: pressed, value: Number(pressed) });
  const pad = {
    id: "Xbox Controller (STANDARD GAMEPAD)", index: 0, mapping: "standard",
    connected: false, axes: [0, 0, 0, 0], timestamp: 0,
    buttons: Array.from({ length: 17 }, () => button(false)),
  };
  Object.defineProperty(navigator, "getGamepads", { value: () => pad.connected ? [pad] : [] });

  let frozen = false, repeatTimestamp = false;
  if (freezeForActiveSave || frameRate) {
    const requestFrame = window.requestAnimationFrame.bind(window);
    let previousTimestamp, simulationTime;
    window.requestAnimationFrame = callback => requestFrame(now => {
      if (frozen) return;
      if (frameRate && now !== previousTimestamp) {
        simulationTime = simulationTime === undefined ? now
          : simulationTime + (repeatTimestamp ? 0 : 1000 / frameRate);
        repeatTimestamp = false;
        previousTimestamp = now;
      }
      callback(simulationTime ?? now);
    });
  }

  if (seedJourney && !sessionStorage.getItem("vault-regression-seeded")) {
    localStorage.setItem(saveKey, JSON.stringify({ version: 1, position: [5, 0, 16], lit: [0], yaw: 0 }));
    sessionStorage.setItem("vault-regression-seeded", "1");
  }

  function sample(barrier) {
    const { camera, player, state, world } = window.valley;
    const warrior = player.getObjectByName("ValleyWarrior");
    const feet = player.position.clone();
    const head = warrior.getObjectByName("WarriorHead").getWorldPosition(feet.clone());
    const top = feet.clone().set(barrier.x, barrier.top, barrier.z);
    return {
      frame: state.frames, vault: state.vault, yaw: state.yaw, action: state.combat.player.action,
      facing: player.rotation.y,
      position: feet.toArray(), ground: world.height(feet.x, feet.z),
      camera: camera.position.toArray(), cameraGround: world.height(camera.position.x, camera.position.z),
      feetInView: feet.project(camera).toArray(), headInView: head.project(camera).toArray(),
      wallInView: top.project(camera).toArray(), warriorVisible: player.visible && warrior.visible,
      pose: ["LeftShin", "RightShin", "WarriorChest"].map(name => warrior.getObjectByName(name).rotation.x),
      grip: player.worldToLocal(warrior.getObjectByName("LeftGrip").getWorldPosition(feet.clone())).toArray(),
    };
  }

  function capture() {
    const canvas = window.valley.renderer.domElement;
    const thumbnail = document.createElement("canvas");
    thumbnail.width = thumbnail.height = 16;
    const context = thumbnail.getContext("2d");
    context.drawImage(canvas, 0, 0, 16, 16);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    const red = pixels.filter((_, index) => index % 4 === 0);
    return { png: canvas.toDataURL("image/png"), contrast: Math.max(...red) - Math.min(...red) };
  }

  function collect(barrier, duration, saveAtApex = false) {
    return new Promise((resolve, reject) => {
      const samples = [];
      let elapsed = 0, lastTime, screenshot, lastFrame;
      const watchdog = setTimeout(() => reject(new Error("Timed out sampling Valley animation frames")), timeout);
      function tick(now) {
        try {
          const current = sample(barrier);
          if (current.frame !== lastFrame) {
            // Match the game's 50 ms simulation clamp under software rendering.
            if (lastTime !== undefined) elapsed += Math.min(now - lastTime, 50);
            lastTime = now;
            lastFrame = current.frame;
            samples.push({ ...current, elapsed });
            if (saveAtApex && current.vault?.id === barrier.id && current.vault.progress >= .46) {
              // Keep this exact frame active through navigation so pagehide cannot save a later landing.
              frozen = true;
              document.querySelector("#save").click();
              const saved = JSON.parse(localStorage.getItem(saveKey));
              clearTimeout(watchdog);
              resolve({ samples, savedDuringVault: saved });
              return;
            }
            if (duration === undefined && !screenshot && current.vault?.progress >= .30 &&
                current.vault.progress <= .72 && Math.abs(current.position[2] - barrier.z) <= barrier.halfDepth &&
                current.position[1] >= barrier.top) {
              // Read the WebGL canvas in this RAF before the browser discards the drawing buffer.
              screenshot = { frame: current.frame, ...capture() };
            }
          }
          const done = duration === undefined
            ? (current.vault === null && samples.some(frame => frame.vault)) || elapsed >= 1500
            : elapsed >= duration;
          if (done) {
            clearTimeout(watchdog);
            resolve({ samples, screenshot });
          } else requestAnimationFrame(tick);
        } catch (error) {
          clearTimeout(watchdog);
          reject(error);
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function setPad(forward, pressed, strafe = 0) {
    pad.connected = true;
    pad.axes[0] = strafe;
    pad.axes[1] = forward ? -1 : 0;
    pad.buttons = pad.buttons.map((_, index) => button(pressed.includes(index)));
  }

  window.vaultRegression = {
    collect, sample, setPad,
    interruptVault(barrier) {
      setPad(true, [0]);
      return new Promise((resolve, reject) => {
        let before;
        let request;
        const watchdog = setTimeout(() => {
          cancelAnimationFrame(request);
          reject(new Error("Timed out interrupting an active vault"));
        }, timeout);
        function tick() {
          const current = sample(barrier);
          if (before && current.frame > before.frame) {
            clearTimeout(watchdog);
            resolve({ before, after: current });
            return;
          }
          if (!before && current.vault?.progress >= .34 && current.vault.progress <= .45) {
            before = current;
            setPad(true, [5]);
          }
          request = requestAnimationFrame(tick);
        }
        request = requestAnimationFrame(tick);
      });
    },
    queueAttackThenJump(strafe) {
      repeatTimestamp = true;
      setPad(true, [5], strafe);
      return new Promise(resolve => requestAnimationFrame(() => {
        const { state, combat } = window.valley;
        const staged = { idle: state.combat.player.action === "idle", pending: combat.hasPendingAction };
        setPad(true, [0, 5], strafe);
        resolve(staged);
      }));
    },
    reconnectWhileHidden() {
      let hidden = true;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      pad.connected = false;
      return new Promise(resolve => requestAnimationFrame(() => {
        setPad(true, [0]);
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
        delete document.hidden;
        resolve();
      }));
    },
    disconnectPad() {
      pad.connected = false;
    },
  };
}

async function ready(page) {
  await page.waitForFunction(() => window.valley?.state.frames >= 3 &&
    window.valley.player.getObjectByName("ValleyWarrior"));
}

async function approach(page, barrier) {
  await page.evaluate(({ x, z }) => {
    const { player, world } = window.valley;
    player.position.set(x, world.height(x, z + .7), z + .7);
  }, barrier);
}

const read = (page, barrier) => page.evaluate(barrier => window.vaultRegression.sample(barrier), barrier);
const observe = (page, barrier, duration) => page.evaluate(
  ({ barrier, duration }) => window.vaultRegression.collect(barrier, duration), { barrier, duration });
const setPad = (page, forward, pressed = [], strafe = 0) => page.evaluate(
  ({ forward, pressed, strafe }) => window.vaultRegression.setPad(forward, pressed, strafe),
  { forward, pressed, strafe });

const readSave = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);

async function connectPad(page) {
  await setPad(page, false);
  await page.waitForFunction(() => document.querySelector("#controller")?.textContent.includes("Xbox connected"));
}

function assertPosition(position, expected, message) {
  assert(Array.isArray(position) && position.length === 3 &&
    Math.hypot(...position.map((value, index) => value - expected[index])) < .04, message);
}

function check(result, name, verify) {
  try {
    verify();
    result.checks.push({ name, pass: true });
    console.log(`PASS ${result.input} ${name}`);
  } catch (error) {
    result.checks.push({ name, pass: false, error: error.message });
    throw error;
  }
}

function assertBlocked(samples, barrier) {
  assert(samples.every(frame => frame.vault === null), "The barrier started a vault without a new jump input");
  assert(samples.every(({ position, ground }) => position[2] >= barrier.z + barrier.halfDepth - .04 &&
    Math.abs(position[0] - barrier.x) < .05 && Math.abs(position[1] - ground) < .05),
  "Forward input crossed the wall, drifted sideways, or left the ground");
  assert(Math.abs(samples.at(-1).position[2] - samples.find(frame => frame.elapsed >= 200).position[2]) < .04,
    "Forward input kept moving through the barrier");
}

async function traverse(page, result, barrier, idle, jump) {
  await page.evaluate(barrier => {
    window.vaultRegression.trace = window.vaultRegression.collect(barrier);
  }, barrier);
  await jump();
  const { samples, screenshot } = await page.evaluate(() => window.vaultRegression.trace);
  result.vault = samples;
  if (screenshot) {
    const { png, ...image } = screenshot;
    const filename = `${result.input}-vault.png`;
    await writeFile(join(evidence, filename), Buffer.from(png.split(",")[1], "base64"));
    result.screenshot = { filename, ...image };
  }

  const active = samples.filter(frame => frame.vault);
  const start = active[0];
  const landed = samples.at(-1);
  check(result, "contextual vault selects the wall and progresses to landing", () => {
    assert(active.length >= 3, "No sustained contextual vault was observed");
    assert(active.every(({ vault }, index) => vault.id === barrier.id &&
      vault.progress > 0 && vault.progress < 1 &&
      (index === 0 || vault.progress > active[index - 1].vault.progress)), "Invalid vault ID or progress");
    assert.equal(landed.vault, null);
    const duration = landed.elapsed - start.elapsed;
    assert(duration >= 500 && duration <= 820, `Expected roughly 650 ms of simulation, measured ${duration} ms`);
  });
  check(result, "path clears the wall and lands grounded beyond it", () => {
    const overWall = active.filter(({ position }) => Math.abs(position[2] - barrier.z) <= barrier.halfDepth);
    assert(overWall.length > 0 && overWall.every(({ position }) => position[1] >= barrier.top - .015),
      "The player's path did not clear the top of the wall");
    assert(active.every(({ position }, index) => Math.abs(position[0] - barrier.x) < .06 &&
      (index === 0 || position[2] <= active[index - 1].position[2] + .015)), "The path drifted or reversed");
    assert(landed.position[2] < barrier.z - barrier.halfDepth - .15, "Landing is still on the wall");
    assert(Math.abs(landed.position[1] - landed.ground) < .03, "Landing is above or below terrain");
  });
  check(result, "third-person camera follows and frames the warrior and wall in the captured pose", () => {
    const framed = ([x, y, z]) => Math.abs(x) < .98 && Math.abs(y) < .98 && Math.abs(z) < 1;
    assert([...active, landed].every(frame => frame.warriorVisible && framed(frame.feetInView) &&
      framed(frame.headInView) && frame.camera[1] > frame.cameraGround + .10 &&
      frame.camera[2] > frame.position[2] + 1), "The view clipped into terrain or lost the warrior");
    assert(start.camera[2] - landed.camera[2] > .4, "The camera did not follow forward travel");
    const captured = active.find(frame => frame.frame === screenshot?.frame);
    assert(captured && screenshot.contrast > 20 && framed(captured.wallInView), "Missing or blank in-frame PNG");
    assert(captured.pose.some((angle, index) => Math.abs(angle - idle.pose[index]) > .18),
      "The captured warrior pose did not articulate away from idle");
  });
}

async function run(input, barrierIndex, exercise, fixtures = {}) {
  const result = { input, checks: [], errors: [] };
  results.push(result);
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on("pageerror", error => result.errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") result.errors.push(message.text());
    });
    await page.addInitScript(installFixtures, { saveKey, timeout, ...fixtures });
    await page.goto(baseURL);
    await ready(page);
    const layout = await page.evaluate(() => {
      const { world, state } = window.valley;
      return { vault: state.vault, yaw: state.yaw, barriers: world.vaultBarriers?.map(barrier => ({
        ...barrier, ground: world.height(barrier.x, barrier.z),
      })) };
    });
    check(result, "fresh page exposes two distinct low barriers and an inactive vault", () => {
      assert.equal(layout.vault, null);
      assert.equal(layout.yaw, 0);
      assert(Array.isArray(layout.barriers) && layout.barriers.length === 2, "Expected two vault barriers");
      assert.equal(new Set(layout.barriers.map(barrier => barrier.id)).size, 2);
      assert(layout.barriers.every(({ id, x, z, halfWidth, halfDepth, top, ground }) =>
        typeof id === "string" && id.length > 0 && [x, z, halfWidth, halfDepth, top, ground].every(Number.isFinite) &&
        halfWidth > 0 && halfDepth > 0 && top > ground && top - ground < 1.5), "Invalid low barrier geometry");
    });
    const barrier = layout.barriers[barrierIndex];
    result.barrier = barrier;
    await approach(page, barrier);
    const idle = await read(page, barrier);
    await exercise(page, result, barrier, idle, layout.barriers[1 - barrierIndex]);
    check(result, "browser reports no errors", () => assert.deepEqual(result.errors, []));
  } catch (error) {
    result.failure = error.stack;
    console.error(`FAIL ${input} ${error.message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

try {
  await run("keyboard", 0, async (page, result, barrier, idle) => {
    await page.keyboard.down("KeyW");
    result.walk = (await observe(page, barrier, 450)).samples;
    check(result, "walking alone comes to a stop at the wall", () => {
      assertBlocked(result.walk, barrier);
      assert(idle.position[2] - result.walk.at(-1).position[2] > .04, "Forward input did not reach the wall");
    });
    await traverse(page, result, barrier, idle, async () => {
      await page.keyboard.down("Space");
      await page.waitForFunction(() => window.valley.state.vault !== null, undefined, { timeout: 10_000 });
      await page.keyboard.up("KeyW");
    });
    await page.keyboard.down("Space"); // Send the repeat event without releasing the held key.
    const held = (await observe(page, barrier, 220)).samples;
    check(result, "held Space stays grounded after landing", () => {
      assert(held.every(frame => frame.vault === null && Math.abs(frame.position[1] - frame.ground) < .04));
    });
    await page.keyboard.up("Space");
    const landed = await read(page, barrier);
    await page.locator("#save").click();
    const saved = await readSave(page);
    const saveNotice = await page.locator("#saved").textContent();
    await page.reload();
    await ready(page);
    const restored = await read(page, barrier);
    const lit = await page.evaluate(() => window.valley.state.lit);
    result.save = { landed: landed.position, saved, restored: restored.position, lit, saveNotice };
    check(result, "Save journey and reload preserve the landing and prior lantern progress", () => {
      assert.equal(saveNotice, "Journey saved");
      assert.equal(saved?.version, 1);
      for (const position of [landed.position, saved.position, restored.position]) {
        assertPosition(position, result.vault.at(-1).position, "Save or reload displaced the landing");
      }
      assert.equal(restored.vault, null);
      assert.equal(restored.yaw, 0);
      assert.deepEqual(saved.lit, [0]);
      assert.deepEqual(lit, [0]);
    });
  }, { seedJourney: true });

  await run("simulated-gamepad", 1, async (page, result, barrier, idle, otherBarrier) => {
    await connectPad(page);
    await traverse(page, result, barrier, idle, () => setPad(page, true, [0]));
    await setPad(page, false, [0, 2]);
    await observe(page, barrier, 50);
    const notice = await page.locator("#notice").textContent();
    const marker = await page.evaluate(() => window.valley.world.watchMarker);
    result.marker = { marker, notice };
    check(result, "X reads the watch marker from the second landing", () => {
      assert(marker && Number.isFinite(marker.x) && Number.isFinite(marker.z), "Watch marker is missing");
      assert.match(notice, /The tracks turn toward the cedar court/);
    });

    await setPad(page, false, [0]);
    // Create another valid approach while the original A press is still held.
    await approach(page, otherBarrier);
    await setPad(page, true, [0]);
    result.heldA = (await observe(page, otherBarrier, 450)).samples;
    check(result, "held A cannot retrigger at another wall", () => assertBlocked(result.heldA, otherBarrier));
    await page.evaluate(() => window.vaultRegression.disconnectPad());
    await page.waitForFunction(() => document.querySelector("#controller").textContent.includes("Keyboard ready"));
    await setPad(page, true, [0]);
    result.reconnected = (await observe(page, otherBarrier, 300)).samples;
    check(result, "reconnecting with A held keeps the player at the wall", () =>
      assertBlocked(result.reconnected, otherBarrier));
    await setPad(page, true);
    await observe(page, otherBarrier, 100);
    await setPad(page, true, [0]);
    await page.waitForFunction(id => window.valley.state.vault?.id === id, otherBarrier.id);
    const activated = await read(page, otherBarrier);
    check(result, "releasing A then pressing again re-arms the vault", () =>
      assert.equal(activated.vault?.id, otherBarrier.id));
    await setPad(page, false);
  });

  await run("hidden-tab-reconnect", 0, async (page, result, barrier) => {
    await connectPad(page);
    await page.evaluate(() => window.vaultRegression.reconnectWhileHidden());
    result.reconnected = (await observe(page, barrier, 300)).samples;
    check(result, "a hidden-tab reconnect with A held does not launch a vault", () =>
      assertBlocked(result.reconnected, barrier));
    await setPad(page, true);
    await observe(page, barrier, 60);
    await setPad(page, true, [0]);
    await page.waitForFunction(id => window.valley.state.vault?.id === id, barrier.id);
    const activated = await read(page, barrier);
    check(result, "the first new A press after the hidden-tab reconnect vaults", () =>
      assert.equal(activated.vault?.id, barrier.id));
  });

  for (const queued of [false, true]) {
    await run(queued ? "queued-light-240hz" : "jump-and-light-240hz", 0, async (page, result, barrier) => {
      await connectPad(page);
      const stickX = .48;
      const expectedFacing = Math.atan2((stickX - .16) / .84, -1);
      if (queued) {
        // A zero-delta rendered frame queues RB without consuming a combat tick.
        const staged = await page.evaluate(strafe => window.vaultRegression.queueAttackThenJump(strafe), stickX);
        check(result, "RB is queued and combat is idle before the jump edge", () =>
          assert(staged.idle && staged.pending));
      } else {
        await setPad(page, true, [0, 5], stickX);
      }
      result.jump = (await observe(page, barrier, 280)).samples;
      await setPad(page, false);
      check(result, "jump and light take off at 240 Hz in the stick direction", () => {
        assert(result.jump.every(frame => frame.vault === null), "Combat input left a contextual vault active");
        const airborne = result.jump.find(frame => frame.action === "airLight" &&
          frame.position[1] - frame.ground > .30);
        assert(airborne, "The jump and light attack did not produce a meaningful airborne takeoff");
        assert(Math.abs(airborne.facing - expectedFacing) < .055,
          `The attack lost the approach angle: ${airborne.facing} instead of ${expectedFacing}`);
      });
    }, { frameRate: 240 });
  }

  await run("vault-interrupt-20hz", 0, async (page, result, barrier) => {
    await connectPad(page);
    const trace = await page.evaluate(barrier => window.vaultRegression.interruptVault(barrier), barrier);
    result.interrupt = trace;
    check(result, "RB starts an aerial light attack on the next simulation frame", () => {
      assert.equal(trace.before.action, "idle");
      assert.equal(trace.after.action, "airLight");
      assert.equal(trace.after.vault, null);
      assert.equal(trace.after.frame, trace.before.frame + 1);
    });
    check(result, "the vault pose eases into the aerial attack", () => {
      const { before, after } = trace;
      assert(before.pose[2] > .60, "RB was not sent during the reach");
      assert(Math.abs(after.pose[2] - before.pose[2]) < .62,
        "The chest dropped more than 35 degrees in one frame");
      assert(Math.hypot(...after.grip.map((v, i) => v - before.grip[i])) < .52,
        "The leading grip shifted more than half a meter in one frame");
    });
    await setPad(page, false);
  }, { frameRate: 20 });

  await run("wall-cap-save", 0, async (page, result, barrier) => {
    // Let gravity settle the warrior onto the cap before exercising the Save journey button.
    await page.evaluate(({ x, z, top }) => window.valley.player.position.set(x, top + .30, z), barrier);
    const cap = [barrier.x, barrier.top, barrier.z];
    const settled = (await observe(page, barrier, 350)).samples.at(-1);
    check(result, "the wall cap supports the player", () => {
      assertPosition(settled.position, cap, "Gravity did not settle the warrior onto the cap");
      assert.equal(settled.vault, null);
    });
    await page.locator("#save").click();
    const saved = await readSave(page);
    await page.reload();
    await ready(page);
    const restored = (await observe(page, barrier, 200)).samples.at(-1);
    result.capSave = { settled, saved, restored };
    check(result, "wall-cap save reloads on the same cap at the same height", () => {
      assertPosition(saved?.position, cap, "Save displaced the warrior from the cap");
      assertPosition(restored.position, cap, "Reload displaced the warrior from the cap");
      assert.equal(restored.vault, null);
    });
  });

  await run("active-vault-save", 0, async (page, result, barrier, launch) => {
    await connectPad(page);
    await page.evaluate(barrier => {
      window.vaultRegression.trace = window.vaultRegression.collect(barrier, undefined, true);
    }, barrier);
    await setPad(page, true, [0]);
    const { samples, savedDuringVault } = await page.evaluate(() => window.vaultRegression.trace);
    const active = samples.at(-1);
    result.activeSave = { launch, active, saved: savedDuringVault };
    check(result, "save during traversal records the grounded launch point", () => {
      assert.equal(active.vault?.id, barrier.id);
      assert(launch.position[2] - active.position[2] > .25 && active.position[1] > barrier.top,
        "Save was taken before the warrior crossed over the wall");
      assertPosition(savedDuringVault?.position, launch.position, "Active save did not record the launch point");
    });
    await page.reload();
    await ready(page);
    const restored = await read(page, barrier);
    result.activeSave.restored = restored;
    check(result, "reloading an active vault save returns to launch with the vault cleared", () => {
      assertPosition(restored.position, launch.position, "Reload did not return to the launch point");
      assert.equal(restored.vault, null);
    });
  }, { freezeForActiveSave: true });
} finally {
  try {
    await writeFile(join(evidence, "checks.json"), JSON.stringify({ baseURL, gpu, results }, null, 2));
    console.log(`Evidence ${evidence}`);
  } finally {
    await browser.close();
  }
}
