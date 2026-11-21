import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const evidence = resolve(process.env.EVIDENCE_DIR || "../creations/smoke-test/valley-sakura");
const url = process.env.BASE_URL || "http://127.0.0.1:5191/";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ args: process.env.BROWSER_GPU === "1"
  ? ["--use-gl=angle", "--use-angle=gl"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
page.setDefaultTimeout(90_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", entry => { if (entry.type() === "error") errors.push(entry.text()); });
const pass = name => console.log("PASS " + name);
try {
  const hashes = ["yoshino", "kanzan", "shidarezakura"].map(async variety => {
    const response = await page.waitForResponse(response => new RegExp(`sakura-${variety}-[^/]+\\.glb$`).test(response.url()));
    assert(response.ok());
    const source = await readFile(new URL(`../src/assets/sakura-${variety}.glb`, import.meta.url));
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha(await response.body()), sha(source));
  });
  await Promise.all([page.goto(url), ...hashes]);
  pass("The production preview serves all three exact Sakura v002 specimens");
  const move = (x, z) => page.evaluate(([x, z]) => {
    const { player, world } = valley;
    player.position.set(x, world.height(x, z), z);
  }, [x, z]);
  const inspect = name => page.evaluate(name => {
    const { player } = valley;
    const grove = player.parent.getObjectByName(name);
    return {
      visible: grove.visible,
      entries: grove.children.filter(node => node.userData.variety).map(node => ({
        ...node.userData, position: node.position.toArray(),
        near: node.children.slice(1).some(model => model.visible && model.getObjectByName("Trunk")),
      })),
    };
  }, name);
  const waitFor = name => page.waitForFunction(name => {
    const grove = valley.player.parent.getObjectByName(name);
    const varieties = new Set(grove.children.filter(tree => tree.userData.state === "ready").map(tree => tree.userData.variety));
    return varieties.size === 3 && grove.children.some(tree => tree.userData.detail === "full");
  }, name);
  const dawn = "Veiled Pass sakura groves", storm = "Storm sakura groves";
  await waitFor(dawn);
  const passGrove = await inspect(dawn);
  assert(passGrove.visible && passGrove.entries.some(tree => tree.group === "arrival" && tree.near));
  assert(passGrove.entries.filter(tree => tree.group === "pond shore").length === 3);
  pass("The pass renders an authored solitary tree and has a mixed pond grove");
  await page.screenshot({ path: resolve(evidence, "arrival.png") });
  await move(-8.1, -5.8);
  await page.waitForFunction(() => valley.player.parent.getObjectByName("Veiled Pass sakura groves").children
    .some(tree => tree.userData.group === "pond shore" && tree.userData.detail === "full"));
  const grove = await inspect(dawn);
  assert(grove.entries.filter(tree => tree.detail === "full").length <= 2);
  assert(grove.entries.some(tree => tree.detail === "fallback"));
  pass("The detailed-tree budget preserves lighter distant silhouettes");
  await page.mouse.move(870, 450);
  await page.mouse.down();
  await page.mouse.move(600, 442, { steps: 9 });
  await page.mouse.up();
  await page.screenshot({ path: resolve(evidence, "pond-grove.png") });
  await page.locator("#storm-enter").click();
  await waitFor(storm);
  assert.equal((await inspect(dawn)).visible, false);
  const stormGrove = await inspect(storm);
  assert(stormGrove.entries.some(tree => tree.group === "first gate" && tree.near));
  assert.equal(stormGrove.entries.filter(tree => tree.group === "shrine approach").length, 3);
  pass("Celestial Storm renders its own mixed grove without overlapping the pass plantings");
  await page.screenshot({ path: resolve(evidence, "storm-avenue.png") });
  assert.deepEqual(errors, []);
  pass("Sakura delivery and lighting produce no browser errors");
} finally {
  await browser.close();
}
