// Momentum-based locomotion for the ronin, on a real-world baseline (SI units).
//
// BODY holds measured human values; everything else derives from it, so tuning starts
// from reality. Sources: sprint force-velocity model (Samozino/Morin: v = vmax(1-e^-t/τ),
// a = a0(1 - v/v0)); jump height h = v²/2g; preferred walking pace 1.4 m/s; rubber on dry
// stone μ ≈ 0.5-0.7; reference tricking footage (real-time flip, 0.667 s flight →
// 3.27 m/s takeoff, 0.55 m rise). Pure functions: no three.js or DOM.

const STATURE = 1.8; // m, the ronin's authored height
export const BODY = Object.freeze({
  g: 9.81,           // m/s²
  height: STATURE,
  reach: 1.33 * STATURE, // m, standing fingertip reach with arms overhead (anthropometric)
  walk: 1.4,         // m/s, preferred walking pace (partial stick)
  run: 3.5,          // m/s, easy run (full stick)
  sprint: 7.5,       // m/s, fit recreational sprint (Shift / RT)
  a0: 8,             // m/s², sprint F-v intercept (≈ F0 8 N/kg)
  v0: 8.5,           // m/s, F-v velocity intercept: τ = v0/a0 ≈ 1.06 s
  mu: .6,            // rubber sole on dry stone
  stop: 4.5,         // m/s², comfortable deceleration when input stops
  dragK: .0045,      // 1/m, ½ρCdA/m: ½·1.225·0.55 m²/75 kg; terminal ≈ 47 m/s
  jump: 2.7,         // m/s takeoff: 0.37 m countermovement jump, fit adult
  leap: 3.3,         // m/s takeoff with run-up and arm swing (footage: 3.27)
  push: 2.6,         // m/s horizontal from a standing broad jump (≈ 2.2 m)
});

// Falling from 2 m (6.3 m/s) is where untrained landings stop being absorbable.
const HARD_LANDING = Math.sqrt(2 * BODY.g * 2);

export const LOCOMOTION = Object.freeze({
  minAccel: .6,                // m/s² floor so the F-v curve still reaches its target
  brake: BODY.stop,
  skid: BODY.mu * BODY.g,      // planted reversal: friction-limited
  airAccel: 0,                 // no air control: the centre of mass is ballistic
  uphillResist: 1.5,           // speed loss per unit grade climbing
  downhillAssist: .5,          // speed gain per unit grade descending
  maxAssist: .22,
  hardLanding: HARD_LANDING,
  lateralGrip: BODY.mu * BODY.g, // m/s² of sideways traction for curving the run
  maxTurnRate: 9,              // rad/s pivot ceiling at walking pace
  reverseAngle: 2.3,           // turns sharper than ≈130° plant and skid instead of curving
  cutFloor: .3,                // a runner cutting 70°+ slows to this share of top speed
  forceRise: .08,              // s, leg force development: acceleration eases in, no jolts
  pivotRate: 10,               // rad/s, fastest planted body turn (180° in ≈ 0.3 s)
});

/** Sprint force-velocity: available propulsive acceleration at a given speed. */
export const driveAccel = (speed, tuning = LOCOMOTION) =>
  Math.max(tuning.minAccel, BODY.a0 * (1 - speed / BODY.v0));

/** Quadratic air drag on a velocity component pair over dt (implicit, stable). */
export const dragFactor = (speed, dt) => 1 / (1 + BODY.dragK * speed * dt);

const clampLength = (x, z, max) => {
  const length = Math.hypot(x, z);
  return length > max && length > 0 ? [x / length * max, z / length * max] : [x, z];
};

/** Grade (rise over run) of the ground along a unit direction. */
export function gradeAlong(height, x, z, dirX, dirZ, probe = .6) {
  if (!height || (!dirX && !dirZ)) return 0;
  const ahead = height(x + dirX * probe, z + dirZ * probe);
  const behind = height(x - dirX * probe, z - dirZ * probe);
  const grade = (ahead - behind) / (2 * probe);
  return Number.isFinite(grade) ? grade : 0;
}

/**
 * Advance horizontal velocity one step.
 * @param {{x:number,z:number}} velocity mutated in place
 * @param {{dirX:number,dirZ:number,maxSpeed:number,grounded:boolean,dt:number,
 *          height?:(x:number,z:number)=>number, x?:number, z?:number}} input
 */
export function stepLocomotion(velocity, input, tuning = LOCOMOTION) {
  const { dt, grounded } = input;
  if (!(dt > 0)) return velocity;
  const vx = velocity.x, vz = velocity.z;
  driveStep(velocity, input, tuning);
  if (!grounded || (input.stance && grounded) || !tuning.forceRise) {
    velocity.ax = velocity.az = 0;
    return velocity;
  }
  // Feet build force over ~80 ms: low-pass the acceleration so starts, stops, cuts and
  // the change between them ease in instead of switching within one frame.
  const k = 1 - Math.exp(-dt / tuning.forceRise);
  velocity.ax = (velocity.ax ?? 0) + ((velocity.x - vx) / dt - (velocity.ax ?? 0)) * k;
  velocity.az = (velocity.az ?? 0) + ((velocity.z - vz) / dt - (velocity.az ?? 0)) * k;
  // Friction circle: all horizontal force (drive, braking and cornering together) ≤ μmg.
  const grip = BODY.mu * BODY.g, a = Math.hypot(velocity.ax, velocity.az);
  if (a > grip) { velocity.ax *= grip / a; velocity.az *= grip / a; }
  velocity.x = vx + velocity.ax * dt;
  velocity.z = vz + velocity.az * dt;
  // Released input never creeps backwards past rest.
  if (Math.hypot(input.dirX, input.dirZ) < .05 && velocity.x * vx + velocity.z * vz <= 0) {
    velocity.x = velocity.z = velocity.ax = velocity.az = 0;
  }
  return velocity;
}

/** Turn a facing angle toward `desired` no faster than a planted pivot allows. */
export function steerFacing(current, desired, dt, tuning = LOCOMOTION) {
  const gap = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
  const limit = tuning.pivotRate * dt;
  return current + Math.max(-limit, Math.min(limit, gap));
}

function driveStep(velocity, input, tuning) {
  const { dirX, dirZ, grounded, dt } = input;
  // Fighting stance: short planted steps re-place the feet every frame, so footwork
  // follows input directly instead of carrying free-run momentum.
  const planted = Boolean(input.stance && grounded);
  const intent = Math.min(1, Math.hypot(dirX, dirZ));
  let maxSpeed = Math.max(0, input.maxSpeed) * intent;
  if (grounded && intent > 0) {
    const grade = gradeAlong(input.height, input.x ?? 0, input.z ?? 0, dirX / intent, dirZ / intent);
    maxSpeed *= grade > 0
      ? 1 / (1 + grade * tuning.uphillResist)
      : 1 + Math.min(tuning.maxAssist, -grade * tuning.downhillAssist);
  }
  let targetX = intent > 0 ? dirX / intent * maxSpeed : 0;
  let targetZ = intent > 0 ? dirZ / intent * maxSpeed : 0;
  if (planted) {
    velocity.x = targetX;
    velocity.z = targetZ;
    return velocity;
  }
  const speed = Math.hypot(velocity.x, velocity.z);
  let rate;
  if (grounded && intent >= .05 && speed > .6 && maxSpeed > 0) {
    // Cornering: a runner curves the velocity (bounded by lateral grip) instead of
    // sliding sideways along a chord; only near-reversals plant and skid.
    const heading = Math.atan2(velocity.x, velocity.z);
    const delta = Math.atan2(Math.sin(Math.atan2(targetX, targetZ) - heading),
      Math.cos(Math.atan2(targetX, targetZ) - heading));
    if (Math.abs(delta) < tuning.reverseAngle) {
      const turn = Math.min(tuning.maxTurnRate, tuning.lateralGrip / speed) * dt;
      const next = heading + Math.max(-turn, Math.min(turn, delta));
      // Runners slow to cut: speed scales with cos(turn), braking at friction, so a sharp
      // cut tightens the radius (r = v²/μg) instead of orbiting the target.
      const want = maxSpeed * Math.max(tuning.cutFloor, Math.cos(delta));
      const accel = driveAccel(speed, tuning);
      const nextSpeed = speed < want ? Math.min(want, speed + accel * dt) : Math.max(want, speed - tuning.skid * dt);
      velocity.x = Math.sin(next) * nextSpeed;
      velocity.z = Math.cos(next) * nextSpeed;
      return velocity;
    }
  }
  if (grounded) {
    const opposing = velocity.x * targetX + velocity.z * targetZ < 0;
    if (intent < .05) rate = tuning.brake;
    else if (opposing) rate = tuning.skid;
    else {
      rate = driveAccel(speed, tuning);
      // Shedding excess speed (e.g. after a sprint or into an attack) uses brakes.
      if (speed > maxSpeed + .05) rate = Math.max(rate, tuning.brake);
    }
  } else {
    const drag = dragFactor(speed, dt);
    velocity.x *= drag;
    velocity.z *= drag;
    if (intent < .05 || !tuning.airAccel) return velocity;
    rate = tuning.airAccel;
    // Faster than the input asks while heading the same way: steer, keep momentum.
    if (speed > maxSpeed && velocity.x * targetX + velocity.z * targetZ > 0) {
      targetX = dirX / intent * speed;
      targetZ = dirZ / intent * speed;
    }
  }
  const [stepX, stepZ] = clampLength(targetX - velocity.x, targetZ - velocity.z, rate * dt);
  velocity.x += stepX;
  velocity.z += stepZ;
  return velocity;
}

/** Fraction of horizontal speed kept on touchdown; hard landings absorb more. */
export function landingRetention(fallSpeed, tuning = LOCOMOTION) {
  const impact = Math.max(0, -fallSpeed);
  if (impact <= tuning.hardLanding * .6) return 1;
  return Math.max(.35, 1 - (impact - tuning.hardLanding * .6) / (tuning.hardLanding * 1.6));
}

/**
 * Leg push-off at takeoff: a standing jump gains up to a broad jump's horizontal speed
 * along the input; a running jump keeps its approach speed (legs cannot add more).
 */
export function pushOff(velocity, dirX, dirZ, maxSpeed = BODY.sprint) {
  const intent = Math.hypot(dirX, dirZ);
  if (intent < .05) return velocity;
  const ux = dirX / intent, uz = dirZ / intent;
  const along = velocity.x * ux + velocity.z * uz;
  const target = Math.min(maxSpeed * Math.min(1, intent), BODY.push);
  if (along < target) {
    velocity.x += ux * (target - along);
    velocity.z += uz * (target - along);
  }
  return velocity;
}

/**
 * Horizontal distance covered by a ballistic jump before the feet pass `rise` metres above
 * takeoff on the way down (drag is under 1% at running speeds). Null when never reached.
 */
export function jumpReach(speed, takeoff, rise = 0, g = BODY.g) {
  const disc = takeoff * takeoff - 2 * g * rise;
  if (disc < 0) return null;
  return speed * (takeoff + Math.sqrt(disc)) / g;
}
