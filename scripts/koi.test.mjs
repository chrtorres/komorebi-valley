import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { POND_X, POND_Z, pondHeight } from "../src/koi/habitat.js";
import { floorAt, Pond, shore } from "../src/koi/physics.js";

test("the basin meets Valley terrain and contains the authored swimming envelope", () => {
  const pond = new Pond();
  const waterline = -1;
  assert.equal(pondHeight(POND_X + 9, POND_Z, 2, waterline), 2);
  for (let frame = 0; frame < 3600; frame++) {
    pond.select(["surface", "forage", "turn", "cruise"][Math.floor(frame / 900)]);
    pond.step();
    const { x, y, z } = pond.sample();
    const bed = pondHeight(POND_X + x * 1.55, POND_Z + z * 1.55, 0, waterline);
    assert(Math.abs(bed - (waterline + 1.55 * floorAt(x, z))) < 1e-9);
    assert(y < -.12 && waterline + y * 1.55 > bed);
    assert(shore(x, z) <= .861);
  }
  assert(pond.wakeCount > 70);
  assert(pond.liftCount > 0);
});

test("a nearby disturbance creates a bounded wake and startle response", () => {
  const pond = new Pond();
  pond.disturb(pond.x + .4, pond.z);
  for (let frame = 0; frame < 24; frame++) pond.step();
  assert.equal(pond.startleCount, 1);
  assert(pond.field.metrics().waveHeight > .003);
  assert(pond.field.metrics().waveHeight < .12);
  assert(pond.turn + pond.recoil > .7);
});

test("the shipped GLB retains the skin, embedded maps, and swimming clips", async () => {
  const bytes = await readFile(new URL("../src/assets/kohaku.glb", import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert(bytes.length < 7_000_000);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert(gltf.nodes.some(({ name }) => name === "SwimRoot"));
  assert(gltf.skins[0].joints.length > 90);
  assert.equal(gltf.images.length, 3);
  assert(gltf.images.every(({ mimeType, bufferView }) =>
    mimeType === "image/webp" && Number.isInteger(bufferView)));
  for (const name of ["Cruise", "Left turns", "Right turns"])
    assert(gltf.animations.some((clip) => clip.name === name && clip.channels.length > 90));
  const metadata = JSON.parse(await readFile(new URL("../src/assets/kohaku-metadata.json", import.meta.url)));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.runtimeSha256);
});
