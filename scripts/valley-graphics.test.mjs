import assert from "node:assert/strict";
import test from "node:test";
import { graphicsScale } from "../src/valley-render.js";

test("Balanced and Cinematic preserve their DPR limits with safe high-resolution caps", () => {
  assert.equal(graphicsScale(960, 600, 1, "balanced", 8192), 1);
  assert.equal(graphicsScale(960, 600, 3, "balanced", 8192), 1.5);
  assert.equal(graphicsScale(960, 600, 3, "cinematic", 8192), 2);
  assert.equal(graphicsScale(3840, 2160, 2, "balanced", 8192), 2 / 3);
  assert.equal(graphicsScale(3840, 2160, 2, "cinematic", 8192), 1);
});

test("Ultra uses the available UHD pixel budget and respects both aspect and hardware limits", () => {
  assert.equal(graphicsScale(3840, 2160, 1, "ultra-4k", 8192), 1);
  assert.equal(graphicsScale(1920, 1080, 1, "ultra-4k", 8192), 2);
  assert.equal(graphicsScale(600, 960, 3, "ultra-4k", 8192), 2.25);
  assert.equal(graphicsScale(5120, 1440, 1, "ultra-4k", 8192), 0.75);
  assert.equal(graphicsScale(3840, 2160, 1, "ultra-4k", 2048), 2048 / 3840);
  assert.equal(graphicsScale(1080, 1920, 1, "ultra-4k", 1024), 1024 / 1920);
});
