import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SHRINES } from "../src/storm-campaign.js";

assert(process.env.BASE_URL, "Set BASE_URL to the running production preview");
const url = new URL(process.env.BASE_URL);
url.searchParams.set("quality", "ultra-4k");
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(os.tmpdir(), `valley-graphics-${Date.now()}`));
await mkdir(evidence, { recursive: true });
const relative = path.relative(await realpath(fileURLToPath(new URL("..", import.meta.url))), await realpath(evidence));
assert(relative.startsWith(`..${path.sep}`), "EVIDENCE_DIR must be outside the repository");

const hardware = process.env.BROWSER_GPU === "1";
const args = hardware
  ? ["--use-gl=angle", "--use-angle=gl"]
  : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const report = { url: url.href, hardware, status: "running", samples: [], errors: [] };
let browser;

async function capture(page, name, expectedViewport, expectedBuffer, quality = "ultra-4k") {
  const before = await page.evaluate(() => window.valley.state.frames);
  await page.waitForFunction(frame => window.valley.state.frames > frame, before);
  const sample = await page.evaluate(() => {
    const { renderer, camera, player, state } = window.valley;
    const gl = renderer.getContext();
    const canvas = renderer.domElement;
    const bounds = canvas.getBoundingClientRect();
    const feet = player.position.clone().project(camera);
    const head = player.position.clone().add({ x: 0, y: 1.8, z: 0 }).project(camera);
    return {
      frame: state.frames,
      viewport: [innerWidth, innerHeight],
      canvasCss: [bounds.width, bounds.height],
      dpr: devicePixelRatio,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      quality: state.quality,
      label: document.querySelector("#quality").textContent,
      graphics: state.graphics,
      canvas: [canvas.width, canvas.height],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      draws: window.__valleyGraphicsDraws(),
      aspect: camera.aspect,
      camera: camera.position.toArray(),
      player: player.position.toArray(),
      feet: feet.toArray(),
      head: head.toArray(),
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
    };
  });
  report.samples.push({ name, ...sample });
  const post = quality !== "balanced";
  assert.equal(sample.quality, quality);
  assert.equal(sample.label, `Graphics: ${quality === "ultra-4k" ? "Ultra 4K" : quality}`);
  assert.deepEqual(sample.viewport, expectedViewport);
  assert.deepEqual(sample.canvasCss, expectedViewport);
  assert.deepEqual(sample.canvas, expectedBuffer);
  assert.deepEqual(sample.drawingBuffer, expectedBuffer);
  assert.equal(sample.dpr, 1);
  assert(sample.reducedMotion);
  assert(!sample.contextLost);
  assert.equal(sample.glError, 0, name);
  assert.equal(sample.aspect, expectedViewport[0] / expectedViewport[1]);
  assert.deepEqual(sample.graphics, {
    width: expectedBuffer[0], height: expectedBuffer[1],
    postWidth: post ? expectedBuffer[0] : 0, postHeight: post ? expectedBuffer[1] : 0,
    antiAlias: post ? "fxaa" : "native",
  });

  const fullViewport = [0, 0, ...expectedBuffer];
  const scene = sample.draws.find(draw => draw.scene);
  assert(scene, `${name} did not draw the game scene`);
  assert.deepEqual(scene.size, expectedBuffer);
  assert.deepEqual(scene.viewport, fullViewport);
  if (post) {
    assert(scene.target, `${name} did not draw into a postprocessing target`);
    const fullTargets = new Set(sample.draws
      .filter(draw => draw.target && draw.size[0] === expectedBuffer[0] && draw.size[1] === expectedBuffer[1])
      .map(draw => draw.target));
    assert(fullTargets.size >= 2, `${name} needs two full-resolution post targets`);
    const output = sample.draws.at(-1);
    assert.equal(output.target, null);
    assert.deepEqual(output.viewport, fullViewport);
  } else {
    assert.equal(scene.target, null);
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${name} (${expectedBuffer.join("×")})`);
  return sample;
}

try {
  browser = await chromium.launch({ args: ["--no-sandbox", ...args] });
  report.chromium = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "reduce",
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "getGamepads", { value: () => [] });
  });
  page.setDefaultTimeout(90_000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || /WebGL.*INVALID|GL_INVALID|shader error|framebuffer.*incomplete/i.test(message.text()))
      report.errors.push(message.text());
  });
  const response = await page.goto(url.href);
  assert(response?.ok(), "Production preview did not load");
  report.bundle = await page.locator('script[type="module"][src]').first().getAttribute("src");
  assert.match(report.bundle, /\/assets\/[^/]+-[\w-]+\.js$/, "Expected a bundled production entry point");
  await page.waitForFunction(() => window.valley?.state.frames > 0);

  report.webgl = await page.evaluate(() => {
    const { renderer, camera } = window.valley;
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const render = renderer.render;
    const targets = new WeakMap();
    let draws = [];
    let nextTarget = 1;
    renderer.render = function (object, view) {
      const scene = view === camera && object.isScene === true;
      if (scene) draws = [];
      if (scene || object.isMesh) {
        const target = renderer.getRenderTarget();
        if (target && !targets.has(target)) targets.set(target, nextTarget++);
        draws.push({
          scene,
          target: target ? targets.get(target) : null,
          size: target ? [target.width, target.height] : [gl.drawingBufferWidth, gl.drawingBufferHeight],
          viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
        });
      }
      return render.call(this, object, view);
    };
    renderer.domElement.addEventListener("webglcontextlost", () => console.error("WebGL context lost"));
    window.__valleyGraphicsDraws = () => draws;
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
    };
  });
  if (hardware) {
    assert(report.webgl.renderer && !/swiftshader|llvmpipe|softpipe|software/i.test(report.webgl.renderer),
      `Hardware WebGL requested, received ${report.webgl.renderer}`);
  }

  const uhd = [3840, 2160];
  await capture(page, "Ultra startup at 1920×1080 CSS", [1920, 1080], uhd);
  await page.setViewportSize({ width: uhd[0], height: uhd[1] });
  const before = await capture(page, "Ultra at native 16:9 with DPR 1", uhd, uhd);
  await page.mouse.move(1920, 1080);
  await page.mouse.down();
  await page.mouse.move(2020, 1030);
  await page.mouse.up();
  const after = await capture(page, "Ultra after drag orbit", uhd, uhd);
  assert(Math.hypot(...after.camera.map((value, i) => value - before.camera[i])) > 0.5, "Drag must move the camera");
  assert(Math.hypot(after.player[0] - before.player[0], after.player[2] - before.player[2]) < 0.03,
    "Dragging the view must leave the player in place");
  for (const point of [after.feet, after.head]) {
    assert(point.every(value => Math.abs(value) < 1), `Traveler is outside the view: ${point}`);
  }

  const screenshot = "ultra-4k-gameplay.png";
  const png = await page.screenshot({ path: path.join(evidence, screenshot), scale: "css" });
  const dimensions = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.deepEqual(dimensions, uhd);
  const centralColors = await page.evaluate(async data => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), value => value.charCodeAt(0))]));
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, image.width / 4, image.height / 4, image.width / 2, image.height / 2, 0, 0, 32, 32);
    const rgba = ctx.getImageData(0, 0, 32, 32).data;
    const colors = new Set();
    for (let i = 0; i < rgba.length; i += 4) colors.add(rgba[i] * 65536 + rgba[i + 1] * 256 + rgba[i + 2]);
    return colors.size;
  }, png.toString("base64"));
  report.screenshot = { file: screenshot, dimensions, centralColors };
  assert(centralColors > 32, "Screenshot lacks variation in the central gameplay area");

  await page.locator("#storm-enter").click();
  const moveTo = point => page.evaluate(({ x, z }) => {
    const { player, world } = window.valley;
    player.position.set(x, world.height(x, z), z);
  }, point);
  for (const shrine of SHRINES.slice(1)) {
    await moveTo(shrine);
    await page.keyboard.press("KeyE");
    await page.locator("#storm-menu").waitFor({ state: "visible" });
    await page.locator("#storm-close").click();
  }
  await moveTo({ x: 10, z: -62 });
  await page.waitForFunction(() => window.valley.state.storm.boss?.mode === "telegraph");
  await capture(page, "Ultra Storm renders the guardian telegraph", uhd, uhd);
  await page.waitForFunction(() =>
    window.valley.state.storm.boss?.mode === "counter" &&
    window.valley.player.parent.getObjectByName("StormBurst_0")?.visible);
  await capture(page, "Ultra Storm renders the guardian burst", uhd, uhd);

  await page.setViewportSize({ width: 600, height: 960 });
  await capture(page, "Ultra uses an aspect-preserving portrait fallback", [600, 960], [1350, 2160]);
  await page.locator("#quality").click();
  await capture(page, "Balanced after exiting Ultra", [600, 960], [600, 960], "balanced");
  await page.locator("#quality").click();
  await capture(page, "Cinematic renders after Balanced", [600, 960], [600, 960], "cinematic");
  await page.close();

  const fallback = await browser.newPage({ viewport: { width: 640, height: 360 } });
  fallback.on("pageerror", error => report.errors.push(error.message));
  await fallback.addInitScript(() => {
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      return name === "EXT_color_buffer_float" ? null : getExtension.call(this, name);
    };
  });
  const fallbackURL = new URL(url);
  fallbackURL.searchParams.set("quality", "cinematic");
  await fallback.goto(fallbackURL.href);
  await fallback.waitForFunction(() => window.valley?.state.frames >= 3);
  const withoutHdr = await fallback.evaluate(() => {
    const { graphics, quality } = window.valley.state;
    return { ...graphics, quality, glError: window.valley.renderer.getContext().getError() };
  });
  assert.deepEqual(withoutHdr, {
    width: 640, height: 360, postWidth: 0, postHeight: 0,
    antiAlias: "native", quality: "cinematic", glError: 0,
  });
  report.withoutHdr = withoutHdr;
  console.log("PASS missing half-float render support uses a directly tone-mapped scene");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack;
  throw error;
} finally {
  await browser?.close();
  await writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Graphics evidence: ${evidence}`);
}
