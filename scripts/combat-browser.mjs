import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Real engine input tests; core methods are used only to reset progression.
const baseURL = process.env.BASE_URL || 'http://localhost:5191';
const repository = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(os.tmpdir(), `combat-browser-${Date.now()}`));
await mkdir(evidence, { recursive: true });
const relative = path.relative(repository, await realpath(evidence));
assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'EVIDENCE_DIR must be outside repository');
const caseStart = Number(process.env.CASE_START || 1), caseEnd = Number(process.env.CASE_END || 11);
assert(Number.isInteger(caseStart) && Number.isInteger(caseEnd) && caseStart >= 1 && caseEnd <= 11 && caseStart <= caseEnd, 'CASE_START/CASE_END must select 1..11');
const sourceHashes = {};
for (const file of ['src/valley-next.js', 'src/combat-runtime.js', 'src/valley-world.js', 'src/valley-atmosphere.js', 'src/combat-core.js', 'src/combat-input.js', 'src/combat-view.js', 'scripts/combat-browser.mjs']) {
  try { sourceHashes[file] = createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; sourceHashes[file] = null; }
}
const graphics = process.env.BROWSER_GPU === '1' ? ['--use-gl=angle', '--use-angle=gl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', ...graphics] });
const results = []; let index = 0;
let sourceValidation = { checked: false };
async function report(status) {
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ baseURL, evidence, caseStart, caseEnd, totalCases: 11, sourceHashes, sourceValidation, status, generatedAt: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results }, null, 2));
}
async function advance(page, milliseconds) {
  assert(await page.evaluate(milliseconds => new Promise(resolve => {
    let elapsed = 0, last;
    const timer = setTimeout(() => resolve(false), 90000);
    const tick = now => {
      if (last !== undefined) elapsed += Math.min(now - last, 50);
      last = now;
      if (elapsed >= milliseconds) { clearTimeout(timer); resolve(true); }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), milliseconds), 'animation stopped for 90 seconds');
}
async function boot(page) {
  page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
  await page.goto(baseURL, { timeout: 90000 });
  await page.waitForFunction(() => window.valley?.combat && window.valley.state?.combat?.player && Array.isArray(window.valley.state.combat.enemies));
  await advance(page, 100);
}
const snapshot = page => page.evaluate(() => window.valley.state.combat);
async function reset(page) {
  assert(await page.evaluate(() => {
    const v = window.valley, enemies = v.state.combat.enemies;
    // Progression fixture isolates the first duel; enemy transforms stay core-owned.
    return v.combat.restore({ version: 1, health: 100, stamina: 100, defeatedIds: enemies.slice(1).map(e => e.id) });
  }));
  await advance(page, 50);
}
async function engage(page, { resetState = true, behind = false, id, settle = true } = {}) {
  if (resetState) await reset(page);
  const target = await page.evaluate(({ behind, id }) => {
    const v = window.valley, e = v.state.combat.enemies.find(e => id ? e.id === id : e.health > 0);
    if (!e) throw Error('No enemy to engage');
    const z = e.z + (behind ? 1.4 : -1.4);
    v.player.position.set(e.x, v.world.height(e.x, z), z); v.player.rotation.y = 0;
    return e.id;
  }, { behind, id });
  if (settle) await advance(page, 50);
  return target;
}
async function press(page, key) {
  await page.keyboard.down(key);
  try { await advance(page, 35); } finally { await page.keyboard.up(key); }
  await advance(page, 20);
}
async function bufferWindow(page, action) {
  await page.waitForFunction(action => {
    const p = window.valley.state.combat.player;
    return p.action === action && p.phase === 'recovery' && p.timer >= .27 && p.timer <= .40;
  }, action);
}
async function buttons(page, pressed) {
  await page.evaluate(pressed => {
    window.__combatPadConnected = true;
    window.__combatPad.buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  }, pressed);
}
async function test(name, run) {
  const caseIndex = ++index;
  if (caseIndex < caseStart || caseIndex > caseEnd) return;
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage(), errors = [], started = Date.now(); let failure;
  page.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(() => {
    window.__combatPadConnected = false;
    window.__combatPad = { id: 'Xbox Controller STANDARD GAMEPAD', index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__combatPadConnected ? [window.__combatPad] : [] });
  });
  try { await boot(page); await run(page); assert.deepEqual(errors, [], 'uncaught browser errors'); }
  catch (error) { failure = error.stack || String(error); }
  const screenshot = `${String(caseIndex).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  try { await page.screenshot({ path: path.join(evidence, screenshot), timeout: 90000 }); }
  catch (error) { failure ||= `Screenshot failed: ${error.message}`; }
  results.push({ index: caseIndex, name, pass: !failure, durationMs: Date.now() - started, screenshot, errors, ...(failure ? { failure } : {}) });
  await report('running'); console.log(`${failure ? 'FAIL' : 'PASS'} ${caseIndex} ${name}${failure ? `\n${failure}` : ''}`);
  await context.close();
}

try {
  await report('running');
  await test('combat API and detached snapshot available', async p => {
    assert(await p.evaluate(() => ['update', 'serialize', 'restore', 'respawn'].every(k => typeof window.valley.combat[k] === 'function')));
    const s = await snapshot(p); assert(s.enemies.length > 0); assert(Number.isFinite(s.player.stamina));
    assert(await p.evaluate(() => {
      const s = window.valley.state.combat, before = s.player.health; s.player.health = -123;
      return window.valley.combat.serialize().health === before;
    }), 'snapshot mutation reached live core');
    await advance(p, 50);
  });
  await test('keyboard J damages enemy in front once', async p => {
    const id = await engage(p), before = (await snapshot(p)).enemies.find(e => e.id === id).health;
    await press(p, 'KeyJ'); await advance(p, 300);
    const s = await snapshot(p); assert.equal(s.enemies.find(e => e.id === id).health, before - 13);
    assert(s.player.stamina < 100);
  });
  await test('keyboard J rejects enemy behind facing arc', async p => {
    const id = await engage(p, { behind: true }), before = (await snapshot(p)).enemies.find(e => e.id === id).health;
    await press(p, 'KeyJ'); await advance(p, 350);
    assert.equal((await snapshot(p)).enemies.find(e => e.id === id).health, before);
  });
  await test('Xbox RB held is one attack and release rearms', async p => {
    const id = await engage(p), before = (await snapshot(p)).enemies.find(e => e.id === id).health;
    await buttons(p, [5]); await advance(p, 650);
    assert.equal((await snapshot(p)).enemies.find(e => e.id === id).health, before - 13);
    await buttons(p, []); await advance(p, 50); await engage(p, { resetState: false, id });
    await buttons(p, [5]); await advance(p, 250); await buttons(p, []);
    assert.equal((await snapshot(p)).enemies.find(e => e.id === id).health, before - 26);
  });
  await test('keyboard LLH combo launches target and gravity lands it', async p => {
    const id = await engage(p);
    await press(p, 'KeyJ'); await bufferWindow(p, 'light1');
    await engage(p, { resetState: false, id, settle: false }); await press(p, 'KeyJ');
    await p.waitForFunction(() => window.valley.state.combat.player.action === 'light2');
    await bufferWindow(p, 'light2'); await engage(p, { resetState: false, id, settle: false }); await press(p, 'KeyK');
    await p.waitForFunction(() => window.valley.state.combat.player.action === 'launcher');
    await advance(p, 230);
    const e = (await snapshot(p)).enemies.find(e => e.id === id), floor = await p.evaluate(e => window.valley.world.height(e.x, e.z), e);
    assert(e.y > floor + .1 && e.vy > 0, 'launcher failed to lift target');
    await advance(p, 1600);
    const landed = (await snapshot(p)).enemies.find(e => e.id === id), ground = await p.evaluate(e => window.valley.world.height(e.x, e.z), landed);
    assert(Math.abs(landed.y - ground) < .1);
  });
  await test('Xbox B dodges with displacement and temporary iFrames', async p => {
    await reset(p); const before = await p.evaluate(() => window.valley.player.position.toArray());
    await buttons(p, [1]); await advance(p, 80);
    const s = await snapshot(p), after = await p.evaluate(() => window.valley.player.position.toArray());
    assert.equal(s.player.action, 'dodge'); assert.equal(s.player.invulnerable, true); assert(s.player.stamina <= 78.1);
    assert(Math.hypot(after[0] - before[0], after[2] - before[2]) > .2);
    await buttons(p, []); await advance(p, 400); assert.equal((await snapshot(p)).player.invulnerable, false);
  });
  await test('Xbox LT held guard reduces incoming damage', async p => {
    await engage(p); await buttons(p, [6]); await advance(p, 750); await buttons(p, []);
    const s = await snapshot(p); assert.equal(s.player.health, 96); assert(s.player.stamina < 100);
  });
  await test('F and Xbox right stick click lock toggle once per press', async p => {
    await engage(p); await press(p, 'KeyF'); await advance(p, 100);
    assert((await snapshot(p)).targetId); await press(p, 'KeyF'); await advance(p, 50); assert.equal((await snapshot(p)).targetId, null);
    await buttons(p, [11]); await advance(p, 250); assert((await snapshot(p)).targetId);
    await buttons(p, []); await advance(p, 50); await buttons(p, [11]); await advance(p, 50); assert.equal((await snapshot(p)).targetId, null);
    await buttons(p, []);
  });
  await test('combat health progression persists save and reload', async p => {
    await p.evaluate(() => { const v = window.valley; v.player.position.set(60, v.world.height(60, 60), 60); });
    assert(await p.evaluate(() => window.valley.combat.restore({ version: 1, health: 73, stamina: 41, defeatedIds: [] })));
    await advance(p, 50); await p.evaluate(() => window.valley.save());
    await p.reload(); await p.waitForFunction(() => window.valley?.state?.combat); await advance(p, 100);
    const s = await snapshot(p); assert.equal(s.player.health, 73); assert(s.player.stamina >= 41 && s.player.stamina < 65);
  });
  await test('real attacks defeat enemy and defeat persists reload', async p => {
    const id = await engage(p);
    for (let i = 0; i < 9; i++) {
      if ((await snapshot(p)).defeatedIds.includes(id)) break;
      await engage(p, { resetState: false, id }); await press(p, 'KeyJ'); await advance(p, 600);
    }
    assert((await snapshot(p)).defeatedIds.includes(id), 'enemy was not defeated by real keyboard attacks');
    await p.evaluate(() => window.valley.save()); await p.reload(); await p.waitForFunction(() => window.valley?.state?.combat); await advance(p, 100);
    const s = await snapshot(p); assert(s.defeatedIds.includes(id)); assert.equal(s.enemies.find(e => e.id === id).health, 0);
  });
  await test('death and Space respawn preserve restored lanterns', async p => {
    await p.evaluate(() => { const v = window.valley, l = v.lanterns[0]; v.player.position.set(l.x, v.world.height(l.x, l.z), l.z); });
    await p.keyboard.press('KeyE'); await advance(p, 50); assert((await p.evaluate(() => window.valley.state.lit)).includes(0));
    const ids = await p.evaluate(() => window.valley.state.combat.enemies.slice(1).map(e => e.id));
    assert(await p.evaluate(ids => window.valley.combat.restore({ version: 1, health: 1, stamina: 100, defeatedIds: ids }), ids));
    await advance(p, 50); await engage(p, { resetState: false });
    await p.waitForFunction(() => window.valley.state.combat.player.health === 0);
    assert(await p.locator('#respawn').isVisible()); await press(p, 'Space');
    await p.waitForFunction(() => window.valley.state.combat.player.health === 100);
    const s = await snapshot(p); assert(ids.every(id => s.defeatedIds.includes(id)));
    assert((await p.evaluate(() => window.valley.state.lit)).includes(0));
    assert(await p.evaluate(() => { const v = window.valley, spawn = v.world.spawn; return Math.hypot(v.player.position.x - spawn[0], v.player.position.z - spawn[2]) < .2; }));
  });
} finally {
  const changed = [];
  for (const [file, before] of Object.entries(sourceHashes)) {
    let after = null;
    try { after = createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (after !== before) changed.push(file);
  }
  sourceValidation = { checked: true, unchanged: changed.length === 0, changed };
  await report('complete'); await browser.close();
}
console.log(`Evidence: ${evidence}`);
if (results.some(r => !r.pass) || sourceValidation.unchanged === false) process.exitCode = 1;
