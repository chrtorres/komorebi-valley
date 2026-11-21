import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearVaultBarrier, findVault, movePastVaultBarriers, vaultBarrierFloor,
  vaultPose, vaultSavePosition, VAULT_SECONDS,
} from "../src/vault.js";

const wall = { id: "wall", x: 3, z: 12, halfWidth: 1.27, halfDepth: .28, top: .8 };
const barriers = [wall];
const height = () => 0;

test("a vault requires a grounded approach across the wall's face", () => {
  const position = { x: 3, y: 0, z: 12.58 };
  assert.equal(findVault(position, 0, -1, barriers, height).id, wall.id);
  assert.equal(findVault(position, 0, 1, barriers, height), null);
  assert.equal(findVault(position, -1, -.2, barriers, height), null);
  assert.equal(findVault({ ...position, x: 4.2 }, 0, -1, barriers, height), null);
  assert.equal(findVault(position, 0, -1, barriers, () => -1), null);
});

test("vault roots clear the solid wall for the entire crossing in both directions", () => {
  for (const direction of [-1, 1]) {
    for (const offset of [.58, .9, 1.25]) {
      const position = { x: 3, y: .015, z: wall.z - direction * offset };
      const vault = findVault(position, 0, direction, barriers, () => .09);
      assert(vault);
      for (let i = 0; i <= 240; i++) {
        const point = vaultPose(vault, i * VAULT_SECONDS / 240);
        if (Math.abs(point.z - wall.z) < wall.halfDepth + .30 - 1e-8)
          assert(point.y > wall.top + .16);
      }
      const end = vaultPose(vault, VAULT_SECONDS * 2);
      assert.equal(end.progress, 1);
      assert(Math.abs(end.y - .09) < 1e-8);
      assert((end.z - wall.z) * direction > .8);
    }
  }
});

test("walking, forced horizontal motion and jumping respect the wall's solid faces", () => {
  const near = { x: 3, y: 0, z: 13 };
  const blocked = movePastVaultBarriers(near, 3, 10, barriers);
  assert.equal(blocked.z, 12.58);
  assert.equal(movePastVaultBarriers({ ...near, y: 1 }, 3, 10, barriers).z, 10);
  assert.equal(movePastVaultBarriers({ ...near, x: 6 }, 6, 10, barriers).z, 10);
  assert.equal(movePastVaultBarriers({ x: 0, y: .2, z: 12 }, 6, 12, barriers).x, 3 - 1.27 - .30);
});

test("cap supports a landing and overlapping legacy positions reload clear of the wall", () => {
  const center = { x: 3, y: .9, z: 12 };
  assert.equal(vaultBarrierFloor(center, 0, barriers), .8);
  assert.equal(vaultBarrierFloor({ ...center, y: 0 }, 0, barriers), 0);
  const safe = clearVaultBarrier(center, barriers);
  assert(Math.abs(safe.z - wall.z) > .58);
  assert.deepEqual(clearVaultBarrier(safe, barriers), safe);
  assert.deepEqual(vaultSavePosition({ ...center, y: wall.top }, height, barriers, true),
    [center.x, wall.top, center.z]);
  assert.deepEqual(vaultSavePosition(center, height, barriers, false),
    [safe.x, 0, safe.z]);
  assert.deepEqual(vaultSavePosition({ ...center, y: 0 }, height, barriers, true),
    [safe.x, 0, safe.z]);
});
