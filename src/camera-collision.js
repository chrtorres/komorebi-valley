/**
 * Clip a target-to-camera segment against static world-space AABBs.
 * Padding expands obstacles for camera clearance. A box containing the target
 * (including its boundary) is ignored so the camera can escape an overlap.
 * Returns a new plain position; inputs are never mutated.
 */
export function resolveCameraPosition(target, desired, boxes, padding = 0.2) {
  const axes = ["x", "y", "z"];
  const delta = {
    x: desired.x - target.x,
    y: desired.y - target.y,
    z: desired.z - target.z,
  };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length === 0) return { x: desired.x, y: desired.y, z: desired.z };
  const clearance = Number.isFinite(padding) ? Math.max(0, padding) : 0.2;
  let closest = 1;
  let blocked = false;
  for (const box of boxes) {
    const min = {},
      max = {};
    let startsInside = true;
    for (const axis of axes) {
      min[axis] = box.min[axis] - clearance;
      max[axis] = box.max[axis] + clearance;
      if (target[axis] < min[axis] || target[axis] > max[axis])
        startsInside = false;
    }
    if (startsInside) continue;
    let enter = 0,
      exit = closest;
    let intersects = true;
    for (const axis of axes) {
      // Parallel segments either stay in this slab or cannot hit this box.
      // Explicit handling avoids 0/0 at a face and keeps boundary hits finite.
      if (delta[axis] === 0) {
        if (target[axis] < min[axis] || target[axis] > max[axis]) {
          intersects = false;
          break;
        }
        continue;
      }
      const a = (min[axis] - target[axis]) / delta[axis];
      const b = (max[axis] - target[axis]) / delta[axis];
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) {
        intersects = false;
        break;
      }
    }
    if (intersects && enter <= closest) {
      closest = enter;
      blocked = true;
    }
  }
  // Never impose a minimum orbit distance: doing so can put the camera through
  // a close wall. Preserve the full orbit whenever no obstruction is present.
  const fraction = blocked ? Math.max(0, closest - 0.001 / length) : 1;
  return {
    x: target.x + delta.x * fraction,
    y: target.y + delta.y * fraction,
    z: target.z + delta.z * fraction,
  };
}

/** Shorten the orbit where a terrain ridge intersects the sightline. */
export function resolveTerrainCamera(target, desired, height) {
  const dx = desired.x - target.x, dy = desired.y - target.y, dz = desired.z - target.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / .2);
  const point = (t) => ({ x: target.x + dx * t, y: target.y + dy * t, z: target.z + dz * t });
  const blocked = ({ x, y, z }) => y < height(x, z) + .22;
  for (let i = 1; i <= steps; i++) {
    let far = i / steps;
    if (!blocked(point(far))) continue;
    let near = (i - 1) / steps;
    for (let j = 0; j < 6; j++) {
      const mid = (near + far) / 2;
      if (blocked(point(mid))) far = mid;
      else near = mid;
    }
    return point(near);
  }
  return desired;
}
