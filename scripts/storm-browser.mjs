import { chromium } from "playwright";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { SHRINES, SCROLLS, WEAPONS, STONES } from "../src/storm-campaign.js";

// Route setup may teleport the real player. Progression/combat are exercised only
// through game UI and real keyboard / standard Xbox inputs, never core hooks.
const baseURL = process.env.BASE_URL || "http://localhost:5191";
const repository = await realpath(
  fileURLToPath(new URL("..", import.meta.url)),
);
const evidence = path.resolve(
  process.env.EVIDENCE_DIR ||
    path.join(os.tmpdir(), `storm-browser-${Date.now()}`),
);
await mkdir(evidence, { recursive: true });
const relative = path.relative(repository, await realpath(evidence));
assert(
  relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative),
  "EVIDENCE_DIR must be outside repository",
);
const caseStart = Number(process.env.CASE_START || 1),
  caseEnd = Number(process.env.CASE_END || 8);
assert(
  Number.isInteger(caseStart) &&
    Number.isInteger(caseEnd) &&
    caseStart >= 1 &&
    caseEnd <= 8 &&
    caseStart <= caseEnd,
  "CASE_START/CASE_END must select1..8",
);
async function manifest() {
  const files = [
    "index.html",
    "package.json",
    "package-lock.json",
    "vite.config.js",
    "scripts/storm-browser.mjs",
  ];
  async function walk(dir) {
    for (const e of await readdir(path.join(repository, dir), {
      withFileTypes: true,
    })) {
      const f = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(f);
      else if (e.isFile()) files.push(f);
    }
  }
  await walk("src");
  const hashes = {};
  for (const f of files.sort())
    hashes[f] = createHash("sha256")
      .update(await readFile(path.join(repository, f)))
      .digest("hex");
  return hashes;
}
const sourceHashes = await manifest();
const gpuRequested = process.env.BROWSER_GPU === "1";
const browserArgs = gpuRequested
  ? ["--no-sandbox", "--use-gl=angle", "--use-angle=gl"]
  : ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ headless: true, args: browserArgs });
const results = [];
let index = 0,
  sourceValidation = { checked: false };
const snapshot = (p) => p.evaluate(() => window.valley.state.storm);
async function report(status) {
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(
      {
        baseURL,
        evidence,
        caseStart,
        caseEnd,
        totalCases: 8,
        requestedBackend: gpuRequested ? "angle-gl" : "swiftshader",
        browserArgs,
        sourceHashes,
        sourceValidation,
        status,
        generatedAt: new Date().toISOString(),
        passed: results.filter((r) => r.pass).length,
        failed: results.filter((r) => !r.pass).length,
        results,
      },
      null,
      2,
    ),
  );
}
async function advance(page, milliseconds) {
  await page.bringToFront();
  assert(
    await page.evaluate(
      (milliseconds) =>
        new Promise((resolve) => {
          let elapsed = 0,
            previous;
          const timer = setTimeout(() => resolve(false), 90000);
          const tick = (now) => {
            if (previous !== undefined)
              elapsed += Math.max(0, Math.min(now - previous, 50));
            previous = now;
            if (elapsed >= milliseconds) {
              clearTimeout(timer);
              resolve(true);
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      milliseconds,
    ),
    "animation stopped for90seconds",
  );
}
async function press(p, key) {
  await p.keyboard.down(key);
  try {
    await advance(p, 30);
  } finally {
    await p.keyboard.up(key);
  }
  await advance(p, 20);
}
async function route(p, point, facing = 0) {
  await p.evaluate(
    ({ point, facing }) => {
      const v = window.valley;
      v.player.position.set(point.x, v.world.height(point.x, point.z), point.z);
      v.player.rotation.y = facing;
    },
    { point, facing },
  );
  await advance(p, 100);
}
async function closeMenu(p) {
  if (await p.locator("#storm-close").isVisible())
    await p.locator("#storm-close").click();
}
async function enter(p) {
  await p.locator("#storm-enter").click();
  await p.waitForFunction(() => window.valley.state.storm?.active === true);
  await advance(p, 50);
}
async function shrine(p, index = 0, xbox = false) {
  await closeMenu(p);
  await route(p, SHRINES[index]);
  if (xbox) {
    await pad(p, [2]);
    await advance(p, 60);
    await pad(p, []);
  } else await press(p, "KeyE");
  await p.locator("[data-weapon]").first().waitFor({ state: "visible" });
}
async function scroll(p, item = SCROLLS[0]) {
  await closeMenu(p);
  await route(p, item);
  await press(p, "KeyE");
  await p.waitForFunction(
    (id) => window.valley.state.storm.scrolls.includes(id),
    item.id,
  );
}
async function pad(p, buttons) {
  await p.evaluate((buttons) => {
    window.__stormPadConnected = true;
    window.__stormPad.buttons = Array.from({ length: 17 }, (_, i) => ({
      pressed: buttons.includes(i),
      touched: buttons.includes(i),
      value: buttons.includes(i) ? 1 : 0,
    }));
  }, buttons);
}
async function earnEight(p) {
  for (const item of SCROLLS) await scroll(p, item);
  await closeMenu(p);
  const stone = STONES[0];
  await route(p, { x: stone.x, z: stone.z - 1.3 }, 0);
  await press(p, "KeyJ");
  await p.waitForFunction(
    (id) => window.valley.state.storm.broken.includes(id),
    stone.id,
  );
  assert.equal(
    (await snapshot(p)).shards,
    8,
    "three scrolls plus one stone must earn8shards",
  );
}
async function upgradeAll(p) {
  await shrine(p);
  const ids = Object.keys(WEAPONS);
  assert.equal(ids.length, 4);
  for (const id of ids) {
    await p.locator(`[data-weapon="${id}"]`).click();
    await p.waitForFunction(
      (id) => window.valley.state.storm.weapon === id,
      id,
    );
    await p.locator(`[data-upgrade="${id}"]`).click();
    await p.waitForFunction(
      (id) => window.valley.state.storm.levels[id] === 1,
      id,
    );
  }
  const s = await snapshot(p);
  assert(ids.every((id) => s.levels[id] === 1));
  assert.equal(s.shards, 0);
}
async function bossRoute(p) {
  for (let i = 0; i < SHRINES.length; i++) {
    await shrine(p, i);
    await closeMenu(p);
  }
  await route(p, { x: 10, z: -69 }, 0);
}
async function test(name, run) {
  const caseIndex = ++index;
  if (caseIndex < caseStart || caseIndex > caseEnd) return;
  const context = await browser.newContext({
    viewport: { width: 800, height: 500 },
  });
  const page = await context.newPage(),
    errors = [],
    consoleErrors = [],
    started = Date.now();
  let failure, details, caseTimer;
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await context.addInitScript(() => {
    window.__stormPadConnected = false;
    window.__stormPad = {
      id: "Xbox Controller STANDARD GAMEPAD",
      index: 0,
      mapping: "standard",
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
      timestamp: 0,
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => (window.__stormPadConnected ? [window.__stormPad] : []),
    });
  });
  try {
    await page.goto(baseURL, { timeout: 90000 });
    await page.waitForFunction(() => window.valley?.state?.storm);
    details = await Promise.race([
      run(page),
      new Promise((_, reject) => {
        caseTimer = setTimeout(
          () => reject(Error("Case exceeded180second execution budget")),
          180000,
        );
      }),
    ]);
    assert.deepEqual(errors, [], "uncaught browser errors");
    assert.deepEqual(consoleErrors, [], "console errors");
  } catch (error) {
    failure = error.stack || String(error);
  } finally {
    clearTimeout(caseTimer);
  }
  const screenshot = `${String(caseIndex).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  try {
    await page.screenshot({
      path: path.join(evidence, screenshot),
      timeout: 90000,
    });
  } catch (error) {
    failure ||= `Screenshot failed: ${error.message}`;
  }
  let storm;
  try {
    storm = await snapshot(page);
  } catch {}
  results.push({
    index: caseIndex,
    name,
    pass: !failure,
    durationMs: Date.now() - started,
    screenshot,
    errors,
    consoleErrors,
    details,
    storm,
    ...(failure ? { failure } : {}),
  });
  await report("running");
  console.log(
    `${failure ? "FAIL" : "PASS"} ${caseIndex} ${name}${failure ? `\n${failure}` : ""}`,
  );
  await context.close();
}

try {
  await report("running");
  await test("genuine campaign entry teleports to First Gate", async (p) => {
    assert.equal((await snapshot(p)).active, false);
    await enter(p);
    const s = await snapshot(p),
      pos = await p.evaluate(() => window.valley.state.position);
    assert(s.active);
    assert.equal(s.shrine, 0);
    assert(s.health > 0 && s.spirit > 0);
    assert(Math.hypot(pos[0] - SHRINES[0].x, pos[2] - SHRINES[0].z) < 0.5);
    await p.keyboard.down("KeyW");
    try {
      await advance(p, 350);
    } finally {
      await p.keyboard.up("KeyW");
    }
    const walked = await p.evaluate(() => window.valley.state.position);
    assert(
      walked[2] < pos[2] - 0.3,
      "real path traversal did not move forward",
    );
  });
  await test("scroll interaction grants shards once and records its lore", async (p) => {
    await enter(p);
    const before = (await snapshot(p)).shards;
    await scroll(p);
    let s = await snapshot(p);
    assert.equal(s.shards, before + 2);
    assert(s.scrolls.includes(SCROLLS[0].id));
    assert((await p.locator("body").innerText()).includes(SCROLLS[0].title));
    await closeMenu(p);
    await press(p, "KeyE");
    s = await snapshot(p);
    assert.equal(s.shards, before + 2);
    assert.equal(s.scrolls.filter((id) => id === SCROLLS[0].id).length, 1);
  });
  await test("eight earned shards upgrade and equip all four weapons", async (p) => {
    await enter(p);
    await earnEight(p);
    await upgradeAll(p);
    assert.equal((await snapshot(p)).scrolls.length, SCROLLS.length);
  });
  await test("all four upgrades scrolls and shards survive reload", async (p) => {
    await enter(p);
    await earnEight(p);
    await upgradeAll(p);
    await closeMenu(p);
    const before = await snapshot(p);
    await p.locator("#save").click();
    await p.reload();
    await p.waitForFunction(() => window.valley?.state?.storm?.active);
    await advance(p, 100);
    const after = await snapshot(p);
    assert.equal(after.weapon, before.weapon);
    assert.deepEqual(after.levels, before.levels);
    assert.deepEqual(after.scrolls, before.scrolls);
    assert.deepEqual(after.broken, before.broken);
    assert.equal(after.shards, 0);
    assert.equal(after.shrine, before.shrine);
  });
  await test("parry trial is won by three timed guard inputs", async (p) => {
    await enter(p);
    await shrine(p);
    await p.locator('[data-trial="parry"]').click();
    await closeMenu(p);
    await p.waitForFunction(
      () => window.valley.state.storm.trial?.id === "parry",
    );
    for (let count = 0; count < 3; count++) {
      await p.waitForFunction(() => {
        const t = window.valley.state.storm.trial;
        return t?.status === "active" && t.wave > 0 && t.wave <= 0.18;
      });
      await p.keyboard.down("KeyQ");
      try {
        await p.waitForFunction(
          (count) => (window.valley.state.storm.trial?.parries ?? 0) > count,
          count,
        );
      } finally {
        await p.keyboard.up("KeyQ");
      }
      await advance(p, 40);
    }
    const s = await snapshot(p);
    assert.equal(s.trial.status, "victory");
    assert(s.trials.includes("parry"));
    assert(s.health > 0);
    assert(s.shards >= 5);
  });
  await test("Xbox X opens shrine and real RB attack breaks a shard stone", async (p) => {
    await enter(p);
    await shrine(p, 0, true);
    await closeMenu(p);
    const stone = STONES[0],
      before = await snapshot(p);
    await route(p, { x: stone.x, z: stone.z - 1.3 }, 0);
    await pad(p, [5]);
    await advance(p, 180);
    await pad(p, []);
    const after = await snapshot(p);
    assert(after.broken.includes(stone.id));
    assert.equal(after.shards, before.shards + 2);
  });
  await test("ordinary play defeats guardian through all three phases", async (p) => {
    await enter(p);
    await scroll(p);
    await shrine(p);
    await p.locator('[data-weapon="kusarigama"]').click();
    await p.locator('[data-upgrade="kusarigama"]').click();
    await closeMenu(p);
    await bossRoute(p);
    const phases = new Set(),
      trace = [];
    let ascended = false,
      slammed = false;
    const observe = async () => {
      const s = await snapshot(p);
      phases.add(s.boss.phase);
      trace.push({
        time: s.time,
        phase: s.boss.phase,
        mode: s.boss.mode,
        bossHealth: s.boss.health,
        health: s.health,
        spirit: s.spirit,
      });
      assert(
        s.health > 0,
        "guardian defeated the player during the victory route",
      );
      return s;
    };
    for (let cycle = 0; cycle < 12; cycle++) {
      let s = await observe();
      if (s.boss.mode === "victory") break;
      await p.waitForFunction(() => {
        const s = window.valley.state.storm;
        return (
          s.health <= 0 ||
          s.boss.mode === "victory" ||
          (s.boss.mode === "telegraph" &&
            s.boss.timer <= 0.65 &&
            s.boss.timer > 0)
        );
      });
      s = await observe();
      if (s.boss.mode === "victory") break;
      await press(p, "Space");
      if (!ascended && (await snapshot(p)).spirit >= 22) {
        await press(p, "KeyV");
        ascended = true;
      }
      await p.waitForFunction(() => {
        const s = window.valley.state.storm;
        return (
          s.boss.mode === "counter" ||
          s.boss.mode === "victory" ||
          s.health <= 0
        );
      });
      s = await observe();
      if (s.boss.mode === "victory") break;
      for (let cast = 0; cast < 3; cast++) {
        s = await observe();
        if (s.boss.mode !== "counter") break;
        if (s.spirit >= 20) await press(p, "KeyR");
        s = await observe();
        if (
          !slammed &&
          cast === 1 &&
          s.spirit >= 16 &&
          s.boss.mode === "counter"
        ) {
          const airborne = await p.evaluate(() => {
            const v = window.valley;
            return (
              v.player.position.y -
                v.world.height(v.player.position.x, v.player.position.z) >
              0.5
            );
          });
          if (airborne) {
            await press(p, "KeyK");
            slammed = true;
            await observe();
          }
        }
        const until = (await snapshot(p)).time + 0.58;
        await p.waitForFunction((until) => {
          const s = window.valley.state.storm;
          return s.time >= until || s.boss.mode !== "counter" || s.health <= 0;
        }, until);
      }
    }
    await p.waitForFunction(
      () => window.valley.state.storm.boss.mode === "victory",
      null,
      { timeout: 15000 },
    );
    const s = await observe();
    assert.equal(s.boss.health, 0);
    assert(phases.has(2) && phases.has(3), "phase2and3 were not both observed");
    assert(
      ascended && slammed,
      "victory route did not exercise ascension and aerial heavy",
    );
    assert((await p.locator("body").innerText()).includes("Victory"));
    return { phases: [...phases], ascended, slammed, trace };
  });
  await test("boss defeat is playable and Space returns to attuned shrine", async (p) => {
    await enter(p);
    await bossRoute(p);
    await p.waitForFunction(
      () => window.valley.state.storm.boss.mode === "counter",
    );
    // Enter the boss arena via normal locomotion, then deliberately take its pulses.
    await p.keyboard.down("KeyW");
    try {
      await advance(p, 300);
    } finally {
      await p.keyboard.up("KeyW");
    }
    await p.waitForFunction(() => window.valley.state.storm.health <= 0);
    const dead = await snapshot(p);
    assert.equal(dead.boss.mode, "defeat");
    assert.equal(dead.shrine, 2);
    await press(p, "Space");
    await p.waitForFunction(() => window.valley.state.storm.health === 100);
    const s = await snapshot(p),
      pos = await p.evaluate(() => window.valley.state.position);
    assert.equal(s.shrine, 2);
    assert(Math.hypot(pos[0] - SHRINES[2].x, pos[2] - SHRINES[2].z) < 0.7);
  });
} finally {
  const after = await manifest(),
    changed = [
      ...new Set([...Object.keys(sourceHashes), ...Object.keys(after)]),
    ].filter((f) => sourceHashes[f] !== after[f]);
  sourceValidation = {
    checked: true,
    unchanged: changed.length === 0,
    changed,
  };
  await report("complete");
  await browser.close();
}
console.log(`Evidence: ${evidence}`);
if (results.some((r) => !r.pass) || sourceValidation.unchanged === false)
  process.exitCode = 1;
