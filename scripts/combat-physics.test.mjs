import { test } from "node:test";
import assert from "node:assert/strict";
import { separateCapsules } from "../src/combat-physics.js";
const enemy = (x, z, y = 0) => ({ x, z, y, health: 100 });
test("two-body pinch satisfies both constraints", () => {
  const bodies = [enemy(0, 0), enemy(1, 0)],
    p = separateCapsules({ x: 0.5, y: 0, z: 0 }, bodies);
  for (const e of bodies)
    assert(Math.hypot(p.x - e.x, p.z - e.z) >= 0.7 - 1e-7);
  assert(Math.hypot(p.x - 0.5, p.z) < 0.5);
});
test("exact-center collision produces finite separation", () => {
  const p = separateCapsules({ x: 0, y: 0, z: 0 }, [enemy(0, 0)]);
  assert.equal(Math.hypot(p.x, p.z), 0.7);
});
test("vertical clearance and defeated bodies do not obstruct", () => {
  const p = { x: 1, y: 3, z: 2 };
  assert.deepEqual(separateCapsules(p, [enemy(1, 2)]), { x: 1, z: 2 });
  assert.deepEqual(
    separateCapsules({ ...p, y: 0 }, [{ ...enemy(1, 2), health: 0 }]),
    { x: 1, z: 2 },
  );
});
test("boundary resolution remains in bounds and outside body", () => {
  const e = enemy(69.8, 0),
    p = separateCapsules({ x: 70, y: 0, z: 0 }, [e]);
  assert(p.x <= 70 && p.x >= -70 && Math.abs(p.z) <= 70);
  assert(Math.hypot(p.x - e.x, p.z - e.z) >= 0.7 - 1e-7);
});
test("three-body overlap resolves all live constraints", () => {
  const bodies = [enemy(0, 0), enemy(0.6, 0), enemy(0.3, 0.4)],
    p = separateCapsules({ x: 0.3, y: 0, z: 0.1 }, bodies);
  for (const e of bodies)
    assert(Math.hypot(p.x - e.x, p.z - e.z) >= 0.7 - 1e-7);
});
