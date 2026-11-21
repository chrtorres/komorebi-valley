// Momentum-based locomotion for the Watchkeeper.
//
// The player body carries a horizontal velocity (m/s) that input *accelerates*
// rather than sets. Ground contact supplies traction: strong acceleration from
// rest that tapers toward top speed, firm braking when input stops, and a harder
// skid when reversing. In the air only a little control remains and momentum is
// conserved apart from light drag. Slopes resist climbing and assist descent.
// Pure functions: no three.js or DOM, so it is unit-testable in node.

export const LOCOMOTION = Object.freeze({
  groundAccel: 26,   // m/s² from rest (≈ 2.6 g sprint start, game-tuned)
  topAccelShare: .45, // fraction of accel left near top speed
  brake: 30,          // m/s² when input stops (boots on stone)
  skid: 44,           // m/s² when input opposes velocity
  airAccel: 4.5,      // m/s² of air steering
  airDrag: .12,       // 1/s quadratic-free linear drag in air
  uphillResist: 1.5,  // speed loss per unit grade climbing
  downhillAssist: .5, // speed gain per unit grade descending
  maxAssist: .22,
  hardLanding: 10.5,  // m/s downward speed that counts as a hard landing
});

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
  const { dirX, dirZ, grounded, dt } = input;
  if (!(dt > 0)) return velocity;
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
  if (grounded) {
    const opposing = velocity.x * targetX + velocity.z * targetZ < 0;
    if (intent < .05) rate = tuning.brake;
    else if (opposing) rate = tuning.skid;
    else {
      const topShare = Math.min(1, speed / Math.max(.001, input.maxSpeed || 1));
      rate = tuning.groundAccel * (1 - (1 - tuning.topAccelShare) * topShare);
      // Shedding excess speed (e.g. after a sprint or into an attack) uses brakes.
      if (speed > maxSpeed + .05) rate = Math.max(rate, tuning.brake);
    }
  } else {
    const drag = Math.exp(-tuning.airDrag * dt);
    velocity.x *= drag;
    velocity.z *= drag;
    if (intent < .05) return velocity;
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
 * Leg push-off at takeoff: a jump drives the body along the input direction.
 * Sprint leaps bound forward to at least `leapSpeed`; ordinary jumps add a
 * modest step. Velocity already beyond the target is kept (momentum).
 */
export function pushOff(velocity, dirX, dirZ, { leap = false, speed = 3.6, leapSpeed = 6.2 } = {}) {
  const intent = Math.hypot(dirX, dirZ);
  if (intent < .05) return velocity;
  const ux = dirX / intent, uz = dirZ / intent;
  const along = velocity.x * ux + velocity.z * uz;
  const target = leap ? leapSpeed : Math.min(speed * Math.min(1, intent), Math.max(0, along) + 1.5);
  if (along < target) {
    velocity.x += ux * (target - along);
    velocity.z += uz * (target - along);
  }
  return velocity;
}
