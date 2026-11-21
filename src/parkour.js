// Free-running for the Watchkeeper: solid scenery, walkable tops and roofs, mantling,
// wall-climb kicks, wall-runs and wall-jumps.
//
// The course is plain data so the rules are unit-testable without a renderer:
//   solids:   { kind: "box", cx, cz, hx, hz, y0, top, runnable?, standable? }  axis-aligned
//             { kind: "cyl", cx, cz, r, y0, top, standable? }
//   surfaces: { kind: "roof", hall: { x, y, z } }  authored irimoya roof profile
//             { kind: "box", cx, cz, hx, hz, top } walkable plinth with no blocking sides
// Units: metres, seconds. Y up. `feet` is the body's foot height.

export const PARKOUR = Object.freeze({
  radius: .32,        // body radius against scenery
  step: .55,          // ledge height walked up without a mantle
  mantleMax: 1.9,     // highest ledge (above feet) the hands can pull onto
  mantleTime: .42,    // seconds for a pull-up
  kickMax: 3.4,       // a wall-climb kick reaches ledges up to this height above the feet
  kickSpeed: 7.4,     // upward m/s from a wall-climb kick
  runMin: 4.2,        // horizontal m/s needed to start a wall-run
  runTime: 1.2,       // longest wall-run
  runGravity: 6.5,    // reduced gravity while running a wall (m/s^2)
  runLift: 2.6,       // upward m/s when a wall-run starts
  jumpAway: 5.4,      // wall-jump push away from the wall (m/s)
  jumpUp: 7.4,        // wall-jump vertical speed
  rollFall: 10.5,     // landing faster than this with input held becomes a roll
});

// ---------------------------------------------------------------- hall roof profile
// Mirrors eave_roof()/upper planes in creations/komorebi-shrine-kit create_shrine_kit.py.
const ROOF = { w0: 11.6, d0: 9.6, w1: 7.0, d1: 5.0, z0: 3.95, z1: 5.35, sag: .3, lift: .85, ridge: 6.9, beam: 7.1 };

/** Height of the authored roof above the hall origin, or -Infinity outside its footprint. */
export function roofHeight(lx, lz) {
  const ax = Math.abs(lx), az = Math.abs(lz);
  if (ax > ROOF.w0 / 2 || az > ROOF.d0 / 2) return -Infinity;
  const ux = (ROOF.w0 - 2 * ax) / (ROOF.w0 - ROOF.w1);
  const uz = (ROOF.d0 - 2 * az) / (ROOF.d0 - ROOF.d1);
  const u = Math.min(ux, uz);
  if (u < 1) {
    const w = ROOF.w0 + (ROOF.w1 - ROOF.w0) * u, d = ROOF.d0 + (ROOF.d1 - ROOF.d0) * u;
    const corner = Math.max(0, 1 - Math.max(w / 2 - ax, d / 2 - az) / 2.6) * (1 - u) ** 2;
    return ROOF.z0 + (ROOF.z1 - ROOF.z0) * u - ROOF.sag * Math.sin(Math.PI * u) * (1 - u * .4) + ROOF.lift * corner ** 2;
  }
  // Upper gabled roof: front and back planes rising to the ridge beam.
  const v = 1 - Math.min(1, az / (ROOF.d1 / 2));
  const plane = ROOF.z1 + (ROOF.ridge - ROOF.z1) * v - .18 * Math.sin(Math.PI * v);
  return az < .17 && ax < 3.95 ? Math.max(plane, ROOF.beam) : plane;
}

// ---------------------------------------------------------------- queries
function insideTop(s, x, z, margin = 0) {
  if (s.kind === "cyl") return Math.hypot(x - s.cx, z - s.cz) <= s.r + margin;
  return Math.abs(x - s.cx) <= s.hx + margin && Math.abs(z - s.cz) <= s.hz + margin;
}

/** Top of whatever walkable thing is under (x, z), counting only tops at or below feet + step. */
export function surfaceHeight(course, x, z, feet, step = PARKOUR.step) {
  let best = -Infinity;
  for (const s of course.solids) {
    if (s.standable === false || !insideTop(s, x, z)) continue;
    if (s.top <= feet + step && s.top > best) best = s.top;
  }
  for (const s of course.surfaces) {
    let top = -Infinity;
    if (s.kind === "roof") top = s.hall.y + roofHeight(x - s.hall.x, z - s.hall.z);
    else if (insideTop(s, x, z)) top = s.top;
    if (top <= feet + step && top > best) best = top;
  }
  return best;
}

/** Highest surface top under (x, z) regardless of the feet (mantle targets, camera floor). */
export function topAt(course, x, z) {
  let best = -Infinity;
  for (const s of course.solids) if (s.standable !== false && insideTop(s, x, z)) best = Math.max(best, s.top);
  for (const s of course.surfaces) {
    if (s.kind === "roof") best = Math.max(best, s.hall.y + roofHeight(x - s.hall.x, z - s.hall.z));
    else if (insideTop(s, x, z)) best = Math.max(best, s.top);
  }
  return best;
}

/** Closest point on a solid's footprint to (x, z) and the outward normal there. */
function contact(s, x, z) {
  if (s.kind === "cyl") {
    const dx = x - s.cx, dz = z - s.cz, d = Math.hypot(dx, dz) || 1e-6;
    return { distance: d - s.r, nx: dx / d, nz: dz / d };
  }
  const qx = Math.max(-s.hx, Math.min(s.hx, x - s.cx)), qz = Math.max(-s.hz, Math.min(s.hz, z - s.cz));
  const dx = x - s.cx - qx, dz = z - s.cz - qz, d = Math.hypot(dx, dz);
  if (d > 1e-6) return { distance: d, nx: dx / d, nz: dz / d };
  // Inside the footprint: leave through the nearest face.
  const ex = s.hx - Math.abs(x - s.cx), ez = s.hz - Math.abs(z - s.cz);
  return ex < ez
    ? { distance: -ex, nx: Math.sign(x - s.cx) || 1, nz: 0 }
    : { distance: -ez, nx: 0, nz: Math.sign(z - s.cz) || 1 };
}

const blocks = (s, feet, step) => feet < s.top - step && feet + 1.75 > s.y0;

/** Push a proposed body position out of blocking solids. Returns the corrected point and the last wall touched. */
export function resolveBody(course, x, z, feet, radius = PARKOUR.radius, step = PARKOUR.step) {
  let hit = null;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of course.solids) {
      if (!blocks(s, feet, step)) continue;
      const c = contact(s, x, z);
      if (c.distance < radius) {
        const push = radius - c.distance + 1e-4;
        x += c.nx * push;
        z += c.nz * push;
        hit = { solid: s, nx: c.nx, nz: c.nz };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z, hit };
}

/** A pull-up target: a top within reach ahead of the body, or null. */
export function findMantle(course, x, z, dirX, dirZ, feet, reach = PARKOUR.mantleMax) {
  const len = Math.hypot(dirX, dirZ);
  if (len < .2) return null;
  const ux = dirX / len, uz = dirZ / len;
  for (const ahead of [.45, .65, .85]) {
    const px = x + ux * ahead, pz = z + uz * ahead;
    const top = topAt(course, px, pz);
    const rise = top - feet;
    if (rise > PARKOUR.step * .6 && rise <= reach) {
      // Land a little past the lip so the body is fully on top.
      const lx = x + ux * (ahead + .25), lz = z + uz * (ahead + .25);
      const landTop = topAt(course, lx, lz);
      const land = Math.abs(landTop - top) < .35 ? { x: lx, z: lz, y: landTop } : { x: px, z: pz, y: top };
      return land;
    }
  }
  return null;
}

/** Wall-climb kick: running into a face whose top is too high to mantle but within kick reach. */
export function findKick(course, x, z, dirX, dirZ, feet, radius = PARKOUR.radius) {
  const len = Math.hypot(dirX, dirZ);
  if (len < .3) return null;
  const ux = dirX / len, uz = dirZ / len;
  for (const s of course.solids) {
    if (!blocks(s, feet, PARKOUR.step)) continue;
    const c = contact(s, x, z);
    const rise = s.top - feet;
    if (c.distance < radius + .35 && -(ux * c.nx + uz * c.nz) > .7 && rise > PARKOUR.mantleMax && rise <= PARKOUR.kickMax)
      return { solid: s, nx: c.nx, nz: c.nz };
  }
  return null;
}

/** Wall-run contact: a tall runnable face alongside a fast airborne body. */
export function findWallRun(course, x, z, vx, vz, feet, radius = PARKOUR.radius) {
  const speed = Math.hypot(vx, vz);
  if (speed < PARKOUR.runMin) return null;
  for (const s of course.solids) {
    if (!s.runnable || s.kind !== "box") continue;
    if (feet > s.top - .5 || feet + 1.6 < s.y0) continue;
    const c = contact(s, x, z);
    if (c.distance < 0 || c.distance > radius + .6) continue; // forgiving: within ~0.9 m of the face
    const along = Math.abs(vx * c.nx + vz * c.nz) / speed; // 0 when moving parallel to the face
    if (along > .62) continue;
    // Tangent follows the travel direction.
    let tx = -c.nz, tz = c.nx;
    if (tx * vx + tz * vz < 0) { tx = -tx; tz = -tz; }
    return { solid: s, nx: c.nx, nz: c.nz, tx, tz };
  }
  return null;
}

/** True while (x, z) still lies alongside the wall-run face. */
export function stillOnWall(run, x, z, feet, radius = PARKOUR.radius) {
  const s = run.solid;
  const c = contact(s, x, z);
  return c.distance >= -.05 && c.distance < radius + .7 && feet < s.top - .2 && feet + 1.6 > s.y0 &&
    Math.abs(c.nx - run.nx) + Math.abs(c.nz - run.nz) < .2;
}

/** Smooth pull-up path: rise first, then roll forward over the lip. */
export function mantlePose(from, to, t) {
  const u = Math.min(1, Math.max(0, t));
  const lift = 1 - (1 - Math.min(1, u / .65)) ** 2;
  const over = Math.max(0, (u - .35) / .65);
  const ease = over * over * (3 - 2 * over);
  return {
    x: from.x + (to.x - from.x) * ease,
    y: from.y + (to.y + .04 - from.y) * lift,
    z: from.z + (to.z - from.z) * ease,
  };
}
