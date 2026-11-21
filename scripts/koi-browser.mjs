import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:5191";
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(os.tmpdir(), "valley-koi-evidence"));
await mkdir(evidence, { recursive: true });
const relative = path.relative(await realpath(fileURLToPath(new URL("..", import.meta.url))), await realpath(evidence));
assert(relative.startsWith(`..${path.sep}`), "EVIDENCE_DIR must be outside the repository");
const { runtimeSha256 } = JSON.parse(await readFile(new URL("../src/assets/kohaku-metadata.json", import.meta.url)));
const gpu = process.env.BROWSER_GPU === "1"
  ? ["--use-gl=angle", "--use-angle=gl"]
  : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ args: ["--no-sandbox", ...gpu] });
const cases = [];
const graphics = [];
async function check(name, run) {
  try {
    await run();
    cases.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    cases.push({ name, pass: false, error: error.stack });
    throw error;
  }
}

async function open({ distant = false, missing = false, reduced = false } = {}) {
  const page = await browser.newPage({
    viewport: { width: 1120, height: 720 },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  page.setDefaultTimeout(45_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /WebGL: INVALID|GL_INVALID|Shader Error/i.test(message.text()))
      errors.push(message.text());
  });
  if (missing)
    await page.route(/\/kohaku(?:-[^/]+)?\.glb$/, (route) => route.fulfill({ status: 200, body: "invalid glTF" }),
      { times: 1 });
  if (!distant) await page.addInitScript(() => {
    if (sessionStorage.getItem("koi-seeded")) return;
    localStorage.setItem("komorebi.journey.v1", JSON.stringify({
      version: 1, position: [-8.2, -.5, -9.6], yaw: Math.PI / 2, lit: [0],
    }));
    sessionStorage.setItem("koi-seeded", "true");
  });
  const asset = page.waitForResponse((response) => /\/kohaku(?:-[^/]+)?\.glb$/.test(response.url())).catch(() => null);
  await page.goto(baseURL);
  await page.waitForFunction(() => window.valley?.state.frames >= 3);
  return { page, asset, errors };
}
const view = (page) => page.evaluate(() => {
  const { world, state } = window.valley;
  const koi = world.pond.object.getObjectByName("Kōhaku koi");
  const tail = koi?.getObjectByName("Axial_30");
  return { pond: world.pond.state, tail: tail?.quaternion.toArray(), position: state.position, frames: state.frames };
});
async function waitStatus(page, status) {
  await page.waitForFunction((status) => window.valley.world.pond.state.status === status, status);
}
async function clean(page, errors) {
  const data = await page.evaluate(() => ({
    error: window.valley.renderer.getContext().getError(),
    calls: window.valley.renderer.info.render.calls,
    triangles: window.valley.renderer.info.render.triangles,
  }));
  assert.equal(data.error, 0);
  assert.deepEqual(errors, []);
  graphics.push(data);
}

try {
  const { page, asset, errors } = await open();
  await check("Valley streams the exact compressed, textured skinned asset", async () => {
    const response = await asset;
    assert(response?.ok());
    assert.equal(createHash("sha256").update(await response.body()).digest("hex"), runtimeSha256);
    await waitStatus(page, "ready");
    const counts = await page.evaluate(() => {
      const pond = window.valley.world.pond.object;
      const fish = pond.getObjectByName("Kōhaku koi");
      let skins = 0, mapped = false;
      fish.traverse((node) => {
        if (node.isSkinnedMesh) skins++;
        if (node.material?.map) mapped = true;
      });
      const roots = pond.children.map((child) => child.name);
      return { skins, mapped, roots };
    });
    assert.equal(counts.skins, 14);
    assert(counts.mapped);
    assert(counts.roots.includes("Reflective pond surface"));
    assert(counts.roots.includes("Sedges and submerged ribbon plants"));
  });

  await check("swimming visibly articulates the tail and generates a surface wake", async () => {
    const before = await view(page);
    await page.waitForFunction((t) => window.valley.world.pond.state.time > t + .8, before.pond.time);
    const after = await view(page);
    assert(Math.hypot(after.pond.x - before.pond.x, after.pond.z - before.pond.z) > .13);
    assert.notDeepEqual(after.tail, before.tail);
    assert(after.pond.wakeCount > before.pond.wakeCount && after.pond.waveHeight > 0);
    await page.screenshot({ path: path.join(evidence, "third-person-shore.png") });
  });

  await check("the rendered water reveals the Kōhaku pigment and wet habitat", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // A close framing complements the unmodified third-person screenshot.
    await page.evaluate(() => {
      const { world, camera } = window.valley;
      const fish = world.pond.object.getObjectByName("Kōhaku koi");
      const center = fish.getWorldPosition(camera.position.clone());
      const saved = camera.lookAt.bind(camera);
      camera.lookAt = () => {
        camera.position.copy(center).add({ x: 1.35, y: 1.30, z: 1.2 });
        saved(center);
      };
      window.restoreReviewCamera = () => { camera.lookAt = saved; };
    });
    const screenshot = await page.screenshot({ path: path.join(evidence, "kohaku-detail.png") });
    const pixels = await page.evaluate(async (base64) => {
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([binary], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const colors = ctx.getImageData(420, 245, 280, 230).data;
      let pigment = 0;
      for (let i = 0; i < colors.length; i += 4)
        if (colors[i] > colors[i + 1] * 1.35 && colors[i] > colors[i + 2] * 1.42) pigment++;
      return pigment;
    }, screenshot.toString("base64"));
    assert(pixels > 100, `only ${pixels} red pigment pixels were visible`);
    await page.evaluate(() => window.restoreReviewCamera());
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  await check("walking into the shallows sends ripples and leaves saves reloadable", async () => {
    const before = await view(page);
    await page.keyboard.down("KeyW");
    try {
      await page.waitForFunction((x) => window.valley.state.position[0] < x - 2.0, before.position[0]);
    } finally {
      await page.keyboard.up("KeyW");
    }
    const after = await view(page);
    assert(after.pond.shoreRipples > before.pond.shoreRipples);
    assert(after.position[0] < before.position[0] - 2);
    await page.locator("#save").click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("komorebi.journey.v1")));
    await page.reload();
    await waitStatus(page, "ready");
    const loaded = await view(page);
    assert(Math.abs(loaded.position[0] - stored.position[0]) < .08);
    assert.deepEqual(stored.lit, [0]);
    assert.deepEqual(await page.evaluate(() => window.valley.state.lit), [0]);
  });

  await check("Celestial Storm changes the water lighting and keeps the basin clear", async () => {
    const waterLight = () => page.evaluate(() => window.valley.world.pond.object
      .getObjectByName("Reflective pond surface").material.uniforms.stormLight.value);
    assert.equal(await waterLight(), 0);
    await page.locator("#storm-enter").click();
    await page.waitForFunction(() => window.valley.state.storm.active);
    await page.evaluate(() => {
      const { world, player } = window.valley;
      player.position.set(-8.2, world.height(-8.2, -8.6), -8.6);
    });
    const { frames } = await view(page);
    await page.waitForFunction((frames) => window.valley.state.frames > frames + 15, frames);
    assert.equal((await view(page)).pond.status, "ready");
    assert.equal(await waterLight(), 1);
    const rootsClear = await page.evaluate(() => {
      const habitat = window.valley.world.pond.object;
      const grove = habitat.parent.getObjectByName("Storm sakura groves");
      const trees = grove?.children.filter(tree => tree.userData.variety) ?? [];
      return trees.length > 0 && trees.every(({ position }) =>
        Math.hypot((position.x - habitat.position.x) / (4.35 * habitat.scale.x),
          (position.z - habitat.position.z) / (3.43 * habitat.scale.z)) >= 1.18);
    });
    assert(rootsClear);
    await page.screenshot({ path: path.join(evidence, "storm-shore.png") });
    await clean(page, errors);
  });
  await page.close();

  await check("a failed asset leaves a playable pond and retries on return", async () => {
    const { page, errors } = await open({ missing: true });
    await waitStatus(page, "unavailable");
    const before = await view(page);
    await page.waitForFunction((t) => window.valley.world.pond.state.time > t + .4, before.pond.time);
    assert.equal((await view(page)).tail, undefined);
    const visit = (x, z) => page.evaluate(([x, z]) => {
      const { world, player } = window.valley;
      player.position.set(x, world.height(x, z), z);
    }, [x, z]);
    const { frames } = await view(page);
    await visit(35, 10);
    await page.waitForFunction((frames) => window.valley.state.frames > frames + 4, frames);
    await visit(-8.2, -9.6);
    await waitStatus(page, "ready");
    assert(Array.isArray((await view(page)).tail));
    await clean(page, errors);
    await page.close();
  });

  await check("remote pond idle and reduced-motion behavior avoid unnecessary simulation", async () => {
    const { page, errors } = await open({ distant: true, reduced: true });
    assert.equal((await view(page)).pond.status, "idle");
    await page.evaluate(() => {
      const { world, player } = window.valley;
      player.position.set(-8.2, world.height(-8.2, -8.6), -8.6);
    });
    await waitStatus(page, "ready");
    const before = await view(page);
    await page.waitForFunction((frames) => window.valley.state.frames > frames + 12, before.frames);
    assert.deepEqual((await view(page)).pond, before.pond);
    await clean(page, errors);
    await page.close();
  });
} finally {
  await browser.close();
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ baseURL, runtimeSha256, cases, graphics }, null, 2));
}
