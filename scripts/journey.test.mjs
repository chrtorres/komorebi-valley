import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readJourney,
  writeJourney,
  deadzone,
  connectedGamepad,
  frameDelta,
} from "../src/journey.js";
test("frame time handles startup timestamps and long pauses", () => {
  assert.equal(frameDelta(100, 110), 0);
  assert.equal(frameDelta(120, 100), 0.02);
  assert.equal(frameDelta(10000, 100), 0.05);
  assert.equal(frameDelta(NaN, 100), 0);
});
const fallback = { position: [0, 0, 16], lit: [], yaw: 0 };
const storage = (data) => ({ getItem: () => JSON.stringify(data) });
test("save roundtrip preserves position and lanterns", () => {
  let raw;
  const s = { setItem: (k, v) => (raw = v), getItem: () => raw };
  assert.equal(
    writeJourney(s, { position: [1, 2, 3], lit: [2], yaw: 1 }),
    true,
  );
  assert.deepEqual(readJourney(s, fallback), {
    position: [1, 2, 3],
    lit: [2],
    yaw: 1,
  });
});
test("malformed storage falls back safely", () =>
  assert.equal(readJourney({ getItem: () => "{bad" }, fallback), fallback));
test("unknown version rejected", () =>
  assert.equal(readJourney(storage({ version: 2 }), fallback), fallback));
test("unbounded and invalid positions rejected", () => {
  for (const p of [
    [71, 0, 0],
    [0, 101, 0],
    [null, 0, 0],
    [0, 0],
    [0, 0, -90],
  ])
    assert.equal(
      readJourney(storage({ version: 1, position: p }), fallback),
      fallback,
    );
});
test("lantern identities validated and deduplicated", () =>
  assert.deepEqual(
    readJourney(
      storage({ version: 1, position: [0, 0, 0], lit: [1, 1, -1, 7, "2", 3] }),
      fallback,
    ).lit,
    [1, 3],
  ));
test("storage denial returns failure", () =>
  assert.equal(
    writeJourney(
      {
        setItem: () => {
          throw Error("denied");
        },
      },
      fallback,
    ),
    false,
  ));
test("gamepad deadzone suppresses drift and limits speed", () => {
  assert.equal(deadzone(0.15), 0);
  assert.equal(deadzone(-0.15), 0);
  assert.equal(deadzone(1), 1);
  assert.equal(deadzone(-1), -1);
  assert.equal(deadzone(NaN), 0);
  assert.equal(deadzone(9), 1);
});
test("gamepad permission denial preserves keyboard fallback", () => {
  assert.equal(
    connectedGamepad({
      getGamepads: () => {
        throw Error("denied");
      },
    }),
    undefined,
  );
  assert.equal(connectedGamepad({}), undefined);
  assert.equal(
    connectedGamepad({
      getGamepads: () => [{ mapping: "standard", connected: false }],
    }),
    undefined,
  );
});
