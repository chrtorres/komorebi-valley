import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.BASE_URL || 'http://localhost:5180';
const repository = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(os.tmpdir(), `valley-regression-${Date.now()}`));
await mkdir(evidence, { recursive: true });
const actualEvidence = await realpath(evidence);
const relativeEvidence = path.relative(repository, actualEvidence);
assert(relativeEvidence === '..' || relativeEvidence.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEvidence),
  'EVIDENCE_DIR must be outside the repository');
const graphics = process.env.BROWSER_GPU === '1' ? ['--use-gl=angle', '--use-angle=gl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', ...graphics] });
const results = [];
const caseStart = Number(process.env.CASE_START ?? 1);
const totalCases = 42;
const caseEnd = Number(process.env.CASE_END ?? totalCases);
assert(Number.isInteger(caseStart) && Number.isInteger(caseEnd) && caseStart >= 1 && caseEnd <= totalCases && caseStart <= caseEnd, `CASE_START/CASE_END must be integers in 1..${totalCases} with start <= end`);
let caseIndex = 0;
const SAVE = 'komorebi.journey.v1';
const position = page => page.evaluate(() => [...window.valley.state.position]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
// Advance clamped simulation time, rather than assuming SwiftShader sustains 60 fps.
// Both engines clamp each frame to 50 ms; wait across real animation frames.
async function advance(page, milliseconds) {
  await page.bringToFront();
  const completed = await page.evaluate(milliseconds => new Promise(resolve => {
    let elapsed = 0, previous;
    const watchdog = setTimeout(() => resolve(false), 90000);
    function tick(now) {
      if (previous !== undefined) elapsed += Math.min(now - previous, 50);
      previous = now;
      if (elapsed >= milliseconds) { clearTimeout(watchdog); resolve(true); } else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), milliseconds);
  assert(completed, 'animation frames stopped for 90 seconds');
}
const settle = page => advance(page, 150);
async function boot(page) {
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  await page.goto(baseURL, { timeout: 90000 });
  await page.waitForFunction(() => window.valley?.state && document.querySelector('canvas'));
  await settle(page);
}
async function hold(page, key, duration = 500) {
  await page.keyboard.down(key);
  try { await advance(page, duration); } finally { await page.keyboard.up(key); }
}
async function near(page, index = 0, offset = 0) {
  await page.evaluate(({ index, offset }) => {
    const l = window.valley.lanterns[index];
    const x = l.x + offset;
    window.valley.player.position.set(x, window.valley.world?.height(x, l.z) ?? 0, l.z);
  }, { index, offset });
  await settle(page);
}
async function pad(page, update) {
  await page.evaluate(update => {
    Object.assign(window.__pad, update);
    if (update.buttons) window.__pad.buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: update.buttons.includes(i), touched: update.buttons.includes(i), value: update.buttons.includes(i) ? 1 : 0 }));
  }, update);
}
async function test(name, run, setup = {}) {
  const index = ++caseIndex;
  if (index < caseStart || index > caseEnd) return;
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now();
  let failure;
  try {
    await context.addInitScript(({ save, storageFailure, disableAutosave }) => {
      if (disableAutosave) window.setInterval = () => 0;
      window.__pad = { id: 'Xbox 360 Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
      window.__connected = false;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__connected ? [window.__pad] : [] });
      if (save !== undefined && !sessionStorage.getItem('regression-seeded')) {
        localStorage.setItem('komorebi.journey.v1', save);
        sessionStorage.setItem('regression-seeded', '1');
      }
      if (storageFailure) {
        Storage.prototype.getItem = function () { throw new DOMException('Blocked', 'SecurityError'); };
        Storage.prototype.setItem = function () { throw new DOMException('Blocked', 'QuotaExceededError'); };
      }
    }, setup);
    await boot(page);
    await run(page);
    assert.deepEqual(errors, [], 'uncaught browser errors');
  } catch (error) { failure = error.stack || String(error); }
  const screenshot = `${String(index).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  try { await page.screenshot({ path: path.join(evidence, screenshot), timeout: 90000 }); }
  catch (error) { failure ||= `Screenshot failed: ${error.message}`; }
  results.push({ index, name, pass: !failure, durationMs: Date.now() - started, screenshot, errors, ...(failure ? { failure } : {}) });
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ baseURL, evidence, caseStart, caseEnd, totalCases, status: 'running', results }, null, 2));
  console.log(`${failure ? 'FAIL' : 'PASS'} ${name}${failure ? `\n${failure}` : ''}`);
  await context.close();
}

try {
  await test('public contract and WebGL canvas', async p => {
    assert(await p.evaluate(() => ['player', 'camera', 'lanterns', 'interact', 'save', 'state'].every(k => k in window.valley)));
    assert(await p.evaluate(() => { const c = document.querySelector('canvas'); return c.width > 0 && c.height > 0 && !!(c.getContext('webgl2') || c.getContext('webgl')); }));
  });
  await test('rendered scene has nonblank pixel variation', async p => {
    // Read screenshot pixels, not the WebGL back buffer (which can be discarded).
    const png = await p.screenshot({ clip: { x: 280, y: 180, width: 400, height: 240 } });
    const colors = await p.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const distinct = new Set();
      for (let i = 0; i < pixels.length; i += 64) distinct.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
      return distinct.size;
    }, png.toString('base64'));
    assert(colors > 12, `scene appears blank: ${colors} quantized colors`);
  });
  for (const [key, axis, sign] of [['KeyW', 2, -1], ['KeyS', 2, 1], ['KeyA', 0, -1], ['KeyD', 0, 1]]) {
    await test(`keyboard ${key} movement`, async p => {
      const before = await position(p); await hold(p, key);
      assert(((await position(p))[axis] - before[axis]) * sign > .3);
    });
  }
  await test('key release stops travel', async p => {
    await hold(p, 'KeyW'); await settle(p); const before = await position(p); await advance(p, 400);
    assert(distance(before, await position(p)) < .03);
  });
  await test('third person follows moving player', async p => {
    const offset = () => p.evaluate(() => window.valley.camera.position.clone().sub(window.valley.player.position).toArray());
    const before = await offset(); await hold(p, 'KeyW'); const after = await offset();
    assert(Math.hypot(...after) > 3); assert(Math.hypot(...after.map((v, i) => v - before[i])) < .3);
  });
  await test('keyboard jump rises', async p => {
    const before = await position(p); await hold(p, 'Space', 200); assert((await position(p))[1] > before[1] + .4);
  });
  await test('lantern out of range stays dark', async p => {
    await near(p, 0, 4); await p.evaluate(() => window.valley.interact()); assert.deepEqual(await p.evaluate(() => window.valley.state.lit), []);
  });
  await test('lantern in range restores with E', async p => {
    await near(p, 0, 2); await p.keyboard.press('KeyE'); assert((await p.evaluate(() => window.valley.state.lit)).includes(0));
  });
  await test('lantern interaction is idempotent', async p => {
    await near(p); await p.evaluate(() => { for (let i = 0; i < 8; i++) window.valley.interact(); });
    assert.deepEqual(await p.evaluate(() => window.valley.state.lit), [0]);
  });
  await test('all lanterns restore independently', async p => {
    const count = await p.evaluate(() => window.valley.lanterns.length);
    assert(count >= 7);
    for (let i = 0; i < count; i++) { await near(p, i); await p.evaluate(() => window.valley.interact()); }
    const lit = await p.evaluate(() => window.valley.state.lit); assert.equal(new Set(lit).size, count); assert.equal(lit.length, count);
  });
  await test('save position survives reload', async p => {
    await hold(p, 'KeyW'); await p.evaluate(() => window.valley.save()); const before = await position(p);
    await p.reload(); await p.waitForFunction(() => window.valley); await settle(p); assert(distance(before, await position(p)) < .1);
  });
  await test('restored lantern survives reload', async p => {
    await near(p); await p.evaluate(() => { window.valley.interact(); window.valley.save(); });
    await p.reload(); await p.waitForFunction(() => window.valley); assert.deepEqual(await p.evaluate(() => window.valley.state.lit), [0]);
  });
  for (const [label, save] of [ ['invalid JSON', '{broken'], ['wrong version', JSON.stringify({ version: 999, position: [30, 0, 30] })], ['invalid coordinates', JSON.stringify({ version: 1, position: ['bad', 0, 0] })], ['out of bounds', JSON.stringify({ version: 1, position: [999999, 0, 0] })] ]) {
    await test(`malformed save recovery ${label}`, async p => {
      const pos = await position(p); assert(pos.every(Number.isFinite)); assert(Math.abs(pos[0]) < 85 && Math.abs(pos[2]) < 85);
      const spawn = await p.evaluate(() => window.valley.world?.spawn);
      if (spawn) assert(distance(pos, spawn) < .2); await hold(p, 'KeyW'); assert(distance(pos, await position(p)) > .3);
      await p.evaluate(() => window.valley.save()); const saved = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), SAVE); assert.equal(saved.version, 1);
    }, { save });
  }
  await test('storage failure remains playable and reports failure', async p => {
    await p.evaluate(() => window.valley.save()); assert.equal(await p.evaluate(() => window.valley.state.saveError), true);
    const before = await position(p); await hold(p, 'KeyW'); assert(distance(before, await position(p)) > .3);
    await near(p); await p.evaluate(() => window.valley.interact()); assert((await p.evaluate(() => window.valley.state.lit)).includes(0));
  }, { storageFailure: true });
  await test('Xbox left stick movement', async p => {
    const before = await position(p); await p.evaluate(() => window.__connected = true); await pad(p, { axes: [0, -1, 0, 0] }); await advance(p, 500);
    assert(distance(before, await position(p)) > .3);
  });
  await test('Xbox right stick orbits camera without travel', async p => {
    await p.evaluate(() => window.__connected = true); const before = await position(p);
    const camera = await p.evaluate(() => window.valley.camera.position.toArray()); await pad(p, { axes: [0, 0, 1, .5] }); await advance(p, 500);
    assert(distance(before, await position(p)) < .03); assert(distance(camera, await p.evaluate(() => window.valley.camera.position.toArray())) > .5);
  });
  await test('Xbox A jumps', async p => {
    await p.evaluate(() => window.__connected = true); const before = await position(p); await pad(p, { buttons: [0] }); await advance(p, 200);
    assert((await position(p))[1] > before[1] + .4);
  });
  await test('Xbox X interacts and held press is idempotent', async p => {
    await near(p); await p.evaluate(() => window.__connected = true); await pad(p, { buttons: [2] }); await advance(p, 400);
    assert.deepEqual(await p.evaluate(() => window.valley.state.lit), [0]);
    await near(p, 1); await settle(p); assert.deepEqual(await p.evaluate(() => window.valley.state.lit), [0]);
    await pad(p, { buttons: [] }); await settle(p); await pad(p, { buttons: [2] }); await settle(p);
    assert.deepEqual(await p.evaluate(() => window.valley.state.lit), [0, 1]);
  });
  await test('Xbox disconnect stops movement and reconnect resumes', async p => {
    await p.evaluate(() => window.__connected = true); await pad(p, { axes: [1, 0, 0, 0] }); await advance(p, 300);
    await p.evaluate(() => window.__connected = false); await settle(p); const stopped = await position(p); await advance(p, 300);
    assert(distance(stopped, await position(p)) < .03); await p.evaluate(() => window.__connected = true); await advance(p, 400);
    assert(distance(stopped, await position(p)) > .3);
  });
  await test('Xbox movement and camera deadzone suppress drift', async p => {
    await p.evaluate(() => window.__connected = true); const before = await position(p); const camera = await p.evaluate(() => window.valley.camera.position.toArray());
    await pad(p, { axes: [.1, -.1, .1, -.1] }); await advance(p, 500);
    assert(distance(before, await position(p)) < .03); assert(distance(camera, await p.evaluate(() => window.valley.camera.position.toArray())) < .03);
    await pad(p, { axes: [.5, 0, 0, 0] }); await advance(p, 500); assert(distance(before, await position(p)) > .15);
  });
  await test('graphics toggle cycles through three tiers and restores Balanced', async p => {
    const states = await p.locator('#quality').evaluate(button => {
      const read = () => ({
        quality: window.valley.state.quality,
        label: button.textContent,
        graphics: window.valley.state.graphics,
      });
      // Run the control cycle between frames. The dedicated graphics suite renders in Ultra 4K.
      const states = [read()];
      for (let click = 0; click < 3; click++) {
        button.click();
        states.push(read());
      }
      return states;
    });
    assert.deepEqual(states.map(({ quality, label }) => [quality, label]), [
      ['balanced', 'Graphics: balanced'],
      ['cinematic', 'Graphics: cinematic'],
      ['ultra-4k', 'Graphics: Ultra 4K'],
      ['balanced', 'Graphics: balanced'],
    ]);
    assert.deepEqual(states[3].graphics, states[0].graphics);
    await settle(p);
  });
  const orbitRadius = p => p.evaluate(() => Math.hypot(window.valley.camera.position.x - window.valley.player.position.x, window.valley.camera.position.z - window.valley.player.position.z));
  await test('C contemplation widens camera and movement cancels', async p => {
    const before = await orbitRadius(p); await p.keyboard.press('KeyC'); await settle(p);
    assert((await orbitRadius(p)) > before + 2);
    await hold(p, 'KeyW', 150); assert(Math.abs((await orbitRadius(p)) - before) < .2);
    await p.keyboard.press('KeyC'); await settle(p); await p.keyboard.press('KeyC'); await settle(p);
    assert(Math.abs((await orbitRadius(p)) - before) < .2);
  });
  await test('Xbox Y contemplation is edge triggered and toggles off', async p => {
    const before = await orbitRadius(p); await p.evaluate(() => window.__connected = true);
    await pad(p, { buttons: [3] }); await advance(p, 350); assert((await orbitRadius(p)) > before + 2);
    await advance(p, 200); assert((await orbitRadius(p)) > before + 2);
    await pad(p, { buttons: [] }); await settle(p); await pad(p, { buttons: [3] }); await settle(p);
    assert(Math.abs((await orbitRadius(p)) - before) < .2);
  });
  await test('denied getGamepads leaves keyboard playable', async p => {
    await p.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { throw new DOMException('Gamepad denied', 'SecurityError'); } }));
    const before = await position(p); await hold(p, 'KeyW'); assert(distance(before, await position(p)) > .3);
  });
  await test('sequential stale tab saves preserve restored lanterns', async p => {
    const other = await p.context().newPage();
    const errors = []; other.on('pageerror', e => errors.push(e.message));
    try {
      await boot(other); assert.deepEqual(await other.evaluate(() => window.valley.state.lit), []);
      await p.bringToFront(); await near(p); await p.evaluate(() => window.valley.interact());
      // Keep this tab genuinely stale; autosave is disabled for this case only.
      assert.deepEqual(await other.evaluate(() => window.valley.state.lit), []);
      await other.bringToFront(); await near(other, 1); await other.evaluate(() => window.valley.interact());
      await p.evaluate(() => window.valley.save());
      const saved = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), SAVE);
      assert.deepEqual([...saved.lit].sort(), [0, 1]);
      await p.bringToFront(); await p.reload(); await p.waitForFunction(() => window.valley); await settle(p);
      assert.deepEqual((await p.evaluate(() => window.valley.state.lit)).sort(), [0, 1]);
      assert.deepEqual(errors, []);
    } finally { await other.close(); }
  }, { disableAutosave: true });
  await test('thermal held jump gains sustained terrain relative height', async p => {
    await p.evaluate(() => { const v = window.valley; v.player.position.set(10, v.world.height(10, -20), -20); });
    await settle(p); const ground = await p.evaluate(() => window.valley.world.height(10, -20));
    await hold(p, 'Space', 800); const lifted = (await position(p))[1];
    assert(lifted > ground + 4, `thermal rise was ${lifted - ground}`);
    await advance(p, 1200); assert((await position(p))[1] < lifted, 'releasing jump must restore descent');
  });
  await test('airborne jump press cannot restart ascent', async p => {
    await p.evaluate(() => { const v = window.valley, [x,,z] = v.state.position; v.player.position.y = v.world.height(x,z) + 6; });
    await advance(p, 200); const before = (await position(p))[1];
    await p.keyboard.press('Space'); await advance(p, 150);
    assert((await position(p))[1] < before - .1, 'airborne press restarted upward velocity');
  });
  await test('sound opt in and off label round trip', async p => {
    assert.match(await p.locator('#sound').innerText(), /off/i);
    await p.locator('#sound').click(); assert.match(await p.locator('#sound').innerText(), /on/i);
    await near(p); await p.keyboard.press('KeyE'); await settle(p);
    await p.locator('#sound').click(); assert.match(await p.locator('#sound').innerText(), /off/i);
  });
  await test('mouse drag orbits camera without moving player', async p => {
    const before = await position(p), camera = await p.evaluate(() => window.valley.camera.position.toArray());
    await p.mouse.move(480, 320); await p.mouse.down(); await p.mouse.move(620, 350, { steps: 8 }); await p.mouse.up(); await settle(p);
    assert(distance(before, await position(p)) < .03);
    assert(distance(camera, await p.evaluate(() => window.valley.camera.position.toArray())) > .5);
  });
  await test('keyboard Shift and Xbox RT increase travel speed', async p => {
    const start = await position(p); await hold(p, 'KeyW', 400); const walked = distance(start, await position(p));
    let before = await position(p); await p.keyboard.down('ShiftLeft'); await hold(p, 'KeyW', 400); await p.keyboard.up('ShiftLeft');
    assert(distance(before, await position(p)) > walked * 1.4);
    before = await position(p); await p.evaluate(() => window.__connected = true); await pad(p, { axes: [0, -1, 0, 0], buttons: [7] }); await advance(p, 400);
    assert(distance(before, await position(p)) > walked * 1.4); await pad(p, { axes: [0, 0, 0, 0], buttons: [] });
  });
  await test('held jump glides and releasing restores faster descent', async p => {
    await p.evaluate(() => { const v = window.valley, [x,,z] = v.state.position; v.player.position.y = v.world.height(x,z) + 15; });
    await advance(p, 200); const start = (await position(p))[1];
    await p.keyboard.down('Space'); await advance(p, 600); const glided = (await position(p))[1]; await p.keyboard.up('Space');
    const slowDrop = start - glided; assert(slowDrop > .1 && slowDrop < 2);
    await advance(p, 450); assert(glided - (await position(p))[1] > slowDrop, 'release did not restore faster gravity');
  });
  await test('saved camera yaw survives reload', async p => {
    await p.evaluate(() => window.__connected = true); await pad(p, { axes: [0, 0, 1, 0] }); await advance(p, 350);
    await pad(p, { axes: [0, 0, 0, 0] }); await settle(p); const yaw = await p.evaluate(() => window.valley.state.yaw);
    assert(Math.abs(yaw) > .2); await p.evaluate(() => window.valley.save());
    await p.reload(); await p.waitForFunction(() => window.valley); await settle(p);
    assert(Math.abs((await p.evaluate(() => window.valley.state.yaw)) - yaw) < .01);
  });
  await test('saved lantern indices are validated and deduplicated', async p => {
    assert.deepEqual((await p.evaluate(() => window.valley.state.lit)).sort(), [0, 6]);
    await p.evaluate(() => window.valley.save());
    assert.deepEqual((await p.evaluate(key => JSON.parse(localStorage.getItem(key)).lit, SAVE)).sort(), [0, 6]);
  }, { save: JSON.stringify({ version: 1, position: [0, 0, 0], lit: [0, 0, 6, -1, 7, '2', null, 1.5], yaw: 0 }) });
  await test('full size viewport renders scene and updates camera aspect', async p => {
    await p.setViewportSize({ width: 1400, height: 900 }); await settle(p);
    assert(await p.evaluate(() => { const v = window.valley, c = document.querySelector('canvas'); return Math.abs(v.camera.aspect - 1400 / 900) < .001 && c.width >= 1400 && c.height >= 900 && v.state.frames > 0; }));
  });
  const verticalView = page => page.evaluate(() => {
    const { camera, player } = window.valley;
    const view = camera.getWorldDirection(camera.position.clone());
    const feet = player.position.clone().project(camera);
    const head = player.position.clone();
    head.y += 1.8;
    head.project(camera);
    return { directionY: view.y, feetY: feet.y, headY: head.y };
  });
  await test('vertical mouse drag and arrow keys look both ways with player framed', async p => {
    const before = await position(p);
    await p.mouse.move(530, 350); await p.mouse.down();
    await p.mouse.move(530, 200, { steps: 10 }); await p.mouse.up(); await settle(p);
    const up = await verticalView(p);
    assert(up.directionY > .22 && up.feetY > -.98, JSON.stringify(up));
    await p.mouse.move(530, 206); await p.mouse.down();
    await p.mouse.move(530, 583, { steps: 12 }); await p.mouse.up(); await settle(p);
    const down = await verticalView(p);
    assert(down.directionY < -.72 && down.headY < .98, JSON.stringify(down));
    await hold(p, 'ArrowUp', 1520); await settle(p);
    const keyboard = await verticalView(p);
    assert(keyboard.directionY > .999999 && Math.abs(keyboard.headY) < .98, JSON.stringify(keyboard));
    assert(distance(before, await position(p)) < .03);
  });
  await test('Xbox right stick reaches straight overhead and pitch survives reload', async p => {
    const before = await position(p);
    await p.evaluate(() => window.__connected = true);
    await pad(p, { axes: [0, 0, 0, -1] }); await advance(p, 580);
    const up = await verticalView(p);
    assert(up.directionY > .22 && up.feetY > -.98, JSON.stringify(up));
    await advance(p, 460);
    const overhead = await verticalView(p);
    assert(overhead.directionY > .999999 && Math.abs(overhead.headY) < .98, JSON.stringify(overhead));
    await pad(p, { axes: [0, 0, 0, 1] }); await advance(p, 1550);
    await pad(p, { axes: [0, 0, 0, 0] }); await settle(p);
    const down = await verticalView(p);
    assert(down.directionY < -.72, JSON.stringify(down));
    assert(distance(before, await position(p)) < .03);
    await p.evaluate(() => window.valley.save());
    await p.reload(); await boot(p);
    assert(Math.abs((await verticalView(p)).directionY - down.directionY) < .02);
  });
} finally {
  const complete = caseIndex === totalCases && results.length === caseEnd - caseStart + 1;
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ baseURL, evidence, caseStart, caseEnd, totalCases, status: complete ? 'complete' : 'incomplete', generatedAt: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results }, null, 2));
  await browser.close();
}
assert.equal(caseIndex, totalCases, 'registered case count');
assert.equal(results.length, caseEnd - caseStart + 1, 'executed case count');
console.log(`Evidence: ${evidence}`);
if (results.some(r => !r.pass)) process.exitCode = 1;
