const BODY_RADIUS = .30;
const LANDING_GAP = .58;
export const VAULT_SECONDS = .64;

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function findVault(position, directionX, directionZ, barriers, height) {
  const magnitude = Math.hypot(directionX, directionZ);
  if (magnitude < .28 || Math.abs(directionZ) / magnitude < .83) return null;
  const sign = Math.sign(directionZ);
  for (const barrier of barriers) {
    const offset = (barrier.z - position.z) * sign;
    if (offset < barrier.halfDepth + BODY_RADIUS - .025 ||
        offset > barrier.halfDepth + 1.02 ||
        Math.abs(position.x - barrier.x) > barrier.halfWidth - BODY_RADIUS)
      continue;

    const z = barrier.z + sign * (barrier.halfDepth + LANDING_GAP);
    const y = height(position.x, z);
    if (Math.abs(y - position.y) > .48 || barrier.top - position.y > 1.1) continue;
    return { id: barrier.id, x: position.x, fromZ: position.z, fromY: position.y,
      toZ: z, toY: y, overY: barrier.top + .17, elapsed: 0 };
  }
  return null;
}

export function vaultPose(vault, elapsed) {
  const progress = Math.max(0, Math.min(1, elapsed / VAULT_SECONDS));
  // Lift before advancing. At contact distance the feet still clear the near edge.
  const travel = smoothstep((progress - .24) / .54);
  const lift = smoothstep(progress / .24) * (1 - smoothstep((progress - .78) / .22));
  const baseline = vault.fromY + (vault.toY - vault.fromY) * travel;
  return {
    progress,
    x: vault.x,
    z: vault.fromZ + (vault.toZ - vault.fromZ) * travel,
    y: baseline + (vault.overY - baseline) * lift,
  };
}

export function movePastVaultBarriers(position, x, z, barriers) {
  const solid = barriers.filter(barrier => position.y < barrier.top - .006);
  const start = clearVaultBarrier(position, solid);
  x += start.x - position.x;
  z += start.z - position.z;
  for (const b of solid) {
    const minX = b.x - b.halfWidth - BODY_RADIUS, maxX = b.x + b.halfWidth + BODY_RADIUS;
    const minZ = b.z - b.halfDepth - BODY_RADIUS, maxZ = b.z + b.halfDepth + BODY_RADIUS;
    if (start.z > minZ && start.z < maxZ) {
      if (start.x <= minX && x > minX) x = minX;
      if (start.x >= maxX && x < maxX) x = maxX;
    }
    if (x > minX && x < maxX) {
      if (start.z <= minZ && z > minZ) z = minZ;
      if (start.z >= maxZ && z < maxZ) z = maxZ;
    }
  }
  return { x, z };
}

export function vaultBarrierFloor(position, terrain, barriers) {
  for (const b of barriers) {
    if (position.y >= b.top - .006 &&
        Math.abs(position.x - b.x) < b.halfWidth + BODY_RADIUS &&
        Math.abs(position.z - b.z) < b.halfDepth + BODY_RADIUS)
      terrain = Math.max(terrain, b.top);
  }
  return terrain;
}

export function clearVaultBarrier(position, barriers) {
  let { x, z } = position;
  for (const b of barriers) {
    if (Math.abs(x - b.x) >= b.halfWidth + BODY_RADIUS ||
        Math.abs(z - b.z) >= b.halfDepth + BODY_RADIUS)
      continue;
    const sideX = Math.sign(x - b.x) || 1;
    const sideZ = Math.sign(z - b.z) || 1;
    const edgeX = b.x + sideX * (b.halfWidth + BODY_RADIUS + .015);
    const edgeZ = b.z + sideZ * (b.halfDepth + BODY_RADIUS + .015);
    if (Math.abs(x - edgeX) < Math.abs(z - edgeZ)) x = edgeX;
    else z = edgeZ;
  }
  return { x, z };
}

export function vaultSavePosition(position, height, barriers, allowCap) {
  const ground = height(position.x, position.z);
  const floor = vaultBarrierFloor(position, ground, barriers);
  if (allowCap && floor > ground && Math.abs(position.y - floor) < .025)
    return [position.x, floor, position.z];
  const { x, z } = clearVaultBarrier(position, barriers);
  return [x, height(x, z), z];
}
