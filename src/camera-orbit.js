import { resolveCameraPosition, resolveTerrainCamera } from "./camera-collision.js";

export const DEFAULT_PITCH = Math.atan2(1.84, 6.6);
const MIN_PITCH = -1.45;
const MAX_PITCH = 1.12;

export function orbitPitch(value) {
  return Number.isFinite(value)
    ? Math.max(MIN_PITCH, Math.min(MAX_PITCH, value))
    : DEFAULT_PITCH;
}

function overheadBlend(pitch) {
  const amount = Math.max(0, Math.min(1, (-pitch - .85) / (-MIN_PITCH - .85)));
  return amount * amount * (3 - 2 * amount);
}

export function orbitPosition(pivot, yaw, pitch, distance) {
  // Keep the initial horizontal orbit distance familiar while allowing a true vertical arc.
  const radius = distance / Math.cos(DEFAULT_PITCH);
  const orbit = radius * Math.cos(pitch);
  // Move close behind the player when looking straight up from ground level.
  const horizontal = orbit + (.38 - orbit) * overheadBlend(pitch);
  return {
    x: pivot.x + Math.sin(yaw) * horizontal,
    y: pivot.y + Math.sin(pitch) * radius,
    z: pivot.z + Math.cos(yaw) * horizontal,
  };
}

export function placeOrbitCamera(pivot, yaw, pitch, distance, height, boxes, lower = 0) {
  const desired = orbitPosition(pivot, yaw, pitch, distance);
  const low = Math.min(1, Math.max(0, -pitch / .45));
  const clearance = .8 - .35 * low * low * (3 - 2 * low);
  desired.y = Math.max(desired.y - lower, height(desired.x, desired.z) + clearance);

  const horizontal = point => Math.hypot(point.x - pivot.x, point.z - pivot.z);
  const unobstructed = resolveCameraPosition(pivot, desired, boxes);
  const eye = resolveTerrainCamera(pivot, unobstructed, height);
  const span = horizontal(unobstructed);
  const liftLimit = 3.9 * (1 - overheadBlend(pitch));
  // Solve the eye height needed to clear the bank, then fade that lift as the
  // orbit closes in on the player for the overhead view.
  if (pitch >= 0 || liftLimit === 0 || span - horizontal(eye) < .002) return eye;

  const steps = Math.ceil(span / .17);
  const limit = span / horizontal(desired);
  let lift = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i * limit / steps;
    const floor = height(
      pivot.x + t * (desired.x - pivot.x),
      pivot.z + t * (desired.z - pivot.z),
    ) + .23;
    const line = pivot.y + t * (desired.y - pivot.y);
    lift = Math.max(lift, (floor - line) / t);
  }
  const raised = { ...desired, y: desired.y + Math.min(lift, liftLimit) };
  const candidate = resolveTerrainCamera(
    pivot, resolveCameraPosition(pivot, raised, boxes), height,
  );
  return horizontal(candidate) > horizontal(eye) ? candidate : eye;
}

export function orbitLookAngle(pivot, eye, feetY, pitch, verticalFov) {
  const overhead = overheadBlend(pitch);
  if (overhead === 1) return Math.PI / 2;
  const horizontal = Math.hypot(pivot.x - eye.x, pivot.z - eye.z);
  const currentAngle = Math.atan2(pivot.y - eye.y, horizontal);
  if (pitch >= 0 || horizontal < .05) return currentAngle;

  // When the ground stops the camera descending, tilt its aim up and keep the
  // lower edge of the frame below the player's feet at ordinary tilt angles.
  const feetAngle = Math.atan2(feetY - eye.y, horizontal);
  const ceiling = Math.max(currentAngle, feetAngle + verticalFov / 2 - .065);
  const aim = Math.min(currentAngle - pitch * .42, ceiling);
  if (overhead === 0) return aim;
  const headAngle = Math.atan2(feetY + 1.8 - eye.y, horizontal);
  const biased = aim + (Math.PI / 2 - aim) * overhead;
  const lower = headAngle - verticalFov / 2 + .035;
  const upper = headAngle + verticalFov / 2 - .035;
  return Math.max(lower, Math.min(upper, biased));
}
