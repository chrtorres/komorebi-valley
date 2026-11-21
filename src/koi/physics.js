export const DT = 1 / 60;
export const WIDTH = 9.6, HEIGHT = 7.6;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const unit = (x) => clamp(x, 0, 1);
const ease = (a, b, x) => { const t = unit((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const shore = (x, z) => Math.hypot(x / 4.35, z / 3.43);
export function floorAt(x, z) {
  const r = shore(x, z);
  return -1.23 + 1.55 * ease(.55, 1.04, r) + .035 * Math.sin(x * 1.74 + .26) * Math.cos(z * 2.01);
}

export class WaveField {
  constructor(size = 96) {
    this.size = size;
    this.height = new Float32Array(size * size);
    this.velocity = new Float32Array(size * size);
    this.wet = new Uint8Array(size * size);
    this.damp = new Float32Array(size * size);
    this.pixels = new Uint8Array(size * size * 4);
    this.dx = WIDTH / (size - 1);
    this.dz = HEIGHT / (size - 1);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const r = shore(i * this.dx - WIDTH / 2, j * this.dz - HEIGHT / 2);
      this.wet[j * size + i] = r < .985;
      this.damp[j * size + i] = Math.exp(-DT * (.68 + 8 * ease(.84, .984, r)));
    }
  }

  impact(x, z, impulse, radius = .09) {
    const ix = (x + WIDTH / 2) / this.dx, iz = (z + HEIGHT / 2) / this.dz;
    const range = Math.ceil(3 * radius / Math.min(this.dx, this.dz));
    for (let j = Math.max(1, Math.floor(iz) - range); j <= Math.min(this.size - 2, Math.ceil(iz) + range); j++) {
      for (let i = Math.max(1, Math.floor(ix) - range); i <= Math.min(this.size - 2, Math.ceil(ix) + range); i++) {
        const idx = j * this.size + i;
        if (!this.wet[idx]) continue;
        const k = ((ix - i) * this.dx)**2 + ((iz - j) * this.dz)**2;
        this.velocity[idx] += impulse * Math.exp(-k / (2 * radius**2));
      }
    }
  }

  step() {
    const n = this.size, h = this.height, v = this.velocity;
    // Update velocity from the previous height before integrating any new heights.
    const c2 = 1.65**2;
    const xx = c2 * DT / this.dx**2, zz = c2 * DT / this.dz**2;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (this.wet[k]) {
        v[k] = (v[k] + xx * (h[k-1] + h[k+1] - 2*h[k]) + zz * (h[k-n] + h[k+n] - 2*h[k])) * this.damp[k];
      }
    }
    for (let k = 0; k < h.length; k++) if (this.wet[k]) h[k] += v[k] * DT;
  }

  elevation(x, z) {
    const i = clamp(Math.round((x + WIDTH / 2) / this.dx), 0, this.size-1);
    const j = clamp(Math.round((z + HEIGHT / 2) / this.dz), 0, this.size-1);
    return this.height[j * this.size + i];
  }

  encode() {
    const n = this.size, h = this.height, p = this.pixels;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j*n + i;
      p[4*k] = clamp(128 + 370 * (h[j*n + Math.min(n-1, i+1)] - h[j*n + Math.max(0, i-1)]) / (2*this.dx), 0, 255);
      p[4*k+1] = clamp(128 + 370 * (h[Math.min(n-1, j+1)*n + i] - h[Math.max(0, j-1)*n + i]) / (2*this.dz), 0, 255);
      p[4*k+2] = clamp(128 + 1900 * h[k], 0, 255);
      p[4*k+3] = 255;
    }
    return p;
  }

  metrics() {
    let max = 0, energy = 0;
    for (let i = 0; i < this.height.length; i++) {
      max = Math.max(max, Math.abs(this.height[i]));
      energy += this.height[i]**2 + .04 * this.velocity[i]**2;
    }
    return { waveHeight: max, waveActivity: energy };
  }
}

export const MODES = {
  cruise: ["Cruise", "Steady tail beats maintain speed as the fish circles the deeper water."],
  burst: ["Burst and glide", "A burst adds thrust. In the glide, the tail quiets and drag slows the fish."],
  turn: ["Routine turns", "Watch the body bend into the turn, followed by a tail recoil and a stronger lateral wake."],
  forage: ["Bottom forage", "The fish descends and tilts head-down. Sediment lifts near the mouth, drifts, then settles."],
  surface: ["Shallow swim", "Tail impulses are more visible at the surface as the fish swims at a shallower depth."],
  rest: ["Station holding", "The koi slows, keeps breathing, and uses small paired-fin movements to hold depth."],
};

function gaussian(value, scale) { return Math.exp(-((value / scale)**2)); }

export class Pond {
  constructor(waveResolution = 48) {
    this.time = 0;
    this.modeTime = 0;
    this.mode = "cruise";
    this.x = 1.0;
    this.z = -.88;
    this.y = -.57;
    this.heading = .07;
    this.vx = -.28;
    this.vz = .02;
    this.vy = 0;
    this.yawRate = .20;
    this.pitch = 0;
    this.roll = 0;
    this.phase = 0;
    this.mouthForage = 0;
    this.effort = .87;
    this.turn = 0;
    this.recoil = 0;
    this.sign = 1;
    this.startleAge = Infinity;
    this.startleSign = 1;
    this.startleCount = 0;
    this.wakeCount = 0;
    this.liftCount = 0;
    this.stage = "Steady strokes";
    this.vortices = [];
    this.sediment = [];
    this.tracers = [];
    this.field = new WaveField(waveResolution);
    this.seed = 27431;
  }

  random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  select(mode) {
    if (!(mode in MODES) || mode === this.mode) return;
    this.mode = mode;
    this.modeTime = 0;
    this.startleAge = Infinity;
  }

  disturb(x = this.x, z = this.z, react = true) {
    this.field.impact(x, z, .68, .11);
    if (react && Math.hypot(x - this.x, z - this.z) < 1.1 && this.startleAge > 1.2) {
      const sideways = (x - this.x) * Math.sin(this.heading) + (z - this.z) * Math.cos(this.heading);
      this.startleSign = sideways >= -.0001 ? -1 : 1;
      this.startleAge = 0;
      this.startleCount++;
    }
  }

  flow(x, y, z, includeBody = true) {
    const dxBody = x - this.x, dzBody = z - this.z;
    const displaced = includeBody ? .42 * Math.exp(-14 * (dxBody*dxBody + dzBody*dzBody) - 9 * Math.abs(y-this.y)) : 0;
    let vx = .012 + this.vx * displaced, vz = -.008 + this.vz * displaced;
    for (const vortex of this.vortices) {
      const dx = x - vortex.x, dz = z - vortex.z;
      const r2 = dx*dx + dz*dz;
      if (r2 > 1.8) continue;
      // Regularized, decaying vortex cores limit near-tail velocities and drive particles and plants.
      const factor = vortex.spin * Math.exp(-vortex.age * .95 - r2 * 2.4 - Math.abs(y-vortex.y)*4.4)
        / (.034 + r2);
      vx -= dz * factor;
      vz += dx * factor;
    }
    return [vx, vz];
  }

  sample() {
    return {
      mode: this.mode, time: this.time, x: this.x, y: this.y, z: this.z, depth: -this.y,
      speed: Math.hypot(this.vx, this.vy, this.vz), heading: this.heading, pitch: this.pitch, roll: this.roll,
      phase: this.phase, effort: this.effort, turn: this.turn, recoil: this.recoil, sign: this.sign,
      ventilation: this.time * TAU * .82, mouthForage: this.mouthForage, stage: this.stage,
      wakeCount: this.wakeCount, liftCount: this.liftCount, startleCount: this.startleCount,
    };
  }

  step() {
    const oldPhase = this.phase;
    this.time += DT;
    this.modeTime += DT;
    this.startleAge += DT;
    const t = this.modeTime;
    let drive = .9, frequency = 1.42, depth = .58 + .14*Math.sin(t * .52), desiredYaw = .32;
    let turn = 0, recoil = 0, sign = 1, forage = 0, boost = 0;
    let stage = "Steady strokes";
    if (this.mode === "burst") {
      const u = (t + .13) % 3.5;
      const push = ease(0, .23, u) * (1 - ease(1.04, 1.32, u));
      drive = .015 + 1.34 * push;
      frequency = 1.2 + 1.43 * push;
      desiredYaw = .25;
      stage = push > .15 ? "Burst" : "Glide";
    } else if (this.mode === "turn") {
      const u = (t + .25) % 4.9;
      sign = Math.floor((t + .25) / 4.9) % 2 === 0 ? 1 : -1;
      turn = gaussian(u - 1.22, .28);
      recoil = gaussian(u - 1.70, .21) * (1 - turn);
      desiredYaw = .23 + sign * (2.26 * turn + .40 * recoil);
      drive = .68 + .44 * recoil;
      stage = turn > .19 ? "C-bend" : recoil > .16 ? "Tail recoil" : "Approach";
    } else if (this.mode === "forage") {
      forage = ease(.45, 2.5, t) * (.62 + .38 * (1 - Math.cos(t * 1.25)) * .5);
      depth = -floorAt(this.x, this.z) - mix(.24, .155, forage);
      drive = .27;
      frequency = 1.0;
      desiredYaw = .28;
      stage = forage > .35 ? "Sifting the bed" : "Descent";
    } else if (this.mode === "surface") {
      depth = .17 + .023 * Math.sin(t * .9);
      drive = .78;
      desiredYaw = .38;
      stage = "Shallow pass";
    } else if (this.mode === "rest") {
      depth = .49;
      drive = .11;
      frequency = .68;
      desiredYaw = .05;
      stage = "Holding depth";
    }
    if (this.startleAge < .94) {
      const u = this.startleAge;
      sign = this.startleSign;
      turn = gaussian(u - .16, .106);
      recoil = gaussian(u - .41, .13);
      drive = .38 + 1.24 * recoil;
      frequency = 2.46;
      desiredYaw = sign * (7.8 * turn + 1.4 * recoil);
      depth = clamp(-this.y + .10, .21, .99);
      forage = 0;
      boost = 5.8 * recoil;
      stage = u < .30 ? "Startle bend" : "Escape stroke";
    }
    const proximity = shore(this.x, this.z);
    if (proximity > .57) {
      const inward = Math.atan2(-this.z, this.x);
      const steering = clamp(4 * angleDelta(inward, this.heading), -3, 3);
      desiredYaw = mix(desiredYaw, steering, ease(.57, .76, proximity));
      drive *= 1 - .36 * ease(.78, .88, proximity);
    }

    this.effort = mix(this.effort, drive, 1 - Math.exp(-DT * 11));
    this.phase += TAU * frequency * DT;
    this.yawRate += (desiredYaw - this.yawRate) * DT * 7;
    this.heading += this.yawRate * DT;
    this.turn = turn; this.recoil = recoil; this.sign = sign; this.stage = stage;

    // The root integrates thrust, quadratic water drag and lift at 60 Hz in meter units.
    const fx = -Math.cos(this.heading), fz = Math.sin(this.heading);
    const lx = Math.sin(this.heading), lz = Math.cos(this.heading);
    const [wx, wz] = this.flow(this.x, this.y, this.z, false);
    const axial = (this.vx - wx) * fx + (this.vz - wz) * fz;
    const lateral = (this.vx - wx) * lx + (this.vz - wz) * lz;
    const tailVelocity = this.effort * (frequency / 1.42) * Math.cos(this.phase);
    const thrust = 1.95 * tailVelocity**2 + boost;
    const aft = (thrust - 6.6 * axial * Math.abs(axial) - .48 * axial) / 3.6;
    const side = (-5.8 * lateral - 9.0 * lateral * Math.abs(lateral) + .40 * Math.sin(this.phase) * this.effort) / 3.6;
    this.vx += DT * (aft * fx + side * lx);
    this.vz += DT * (aft * fz + side * lz);
    this.x += DT * this.vx;
    this.z += DT * this.vz;
    if (shore(this.x, this.z) > .86) {
      const scale = .86 / shore(this.x, this.z);
      this.x *= scale; this.z *= scale;
      this.vx *= .82; this.vz *= .82;
    }
    const floor = floorAt(this.x, this.z);
    const targetY = clamp(-depth, floor + .15, -.145);
    const lift = (targetY - this.y) * 7.3 - this.vy * 4.5;
    this.vy += DT * lift;
    const candidate = this.y + DT * this.vy;
    this.y = clamp(candidate, floor + .135, -.13);
    if (this.y !== candidate) this.vy = 0;
    this.pitch = mix(this.pitch, clamp(Math.atan2(this.vy, .20 + Math.abs(axial)) - .43 * forage, -.53, .44), DT * 5.8);
    this.roll = mix(this.roll, clamp(-.18 * this.yawRate + .038*this.effort*Math.sin(this.phase), -.33, .33), DT * 6);

    const halfBeat = Math.floor(this.phase / Math.PI);
    if (halfBeat > Math.floor(oldPhase / Math.PI) && this.effort > .13) {
      const sideSign = halfBeat % 2 ? 1 : -1;
      const sweep = .080 * sideSign + .11 * sign * turn;
      const tx = this.x - fx * .30 + lx * sweep, tz = this.z - fz * .30 + lz * sweep;
      this.vortices.push({ x: tx, y: this.y, z: tz, age: 0,
        spin: sideSign * (.026 * this.effort) + sign * .042 * turn,
        vx: -fx * (.055 + .06 * this.effort) + lx * sign * .19 * turn,
        vz: -fz * (.055 + .06 * this.effort) + lz * sign * .19 * turn });
      this.wakeCount++;
      for (let i=0; i<16 && this.tracers.length < 608; i++) {
        const a = i/16*TAU+halfBeat*.41;
        const r = .035 + .027*(i%4)/3;
        this.tracers.push({x:tx+r*Math.cos(a),y:this.y+.025*Math.cos(2*a),z:tz+r*Math.sin(a),
          age:0, strength:Math.min(1,.7*this.effort+.45*turn)});
      }
      const surfaceImpulse = (.117 * this.effort + .113 * turn) * Math.exp(4.8 * this.y);
      this.field.impact(tx, tz, surfaceImpulse * sideSign, .105);
      this.field.impact(tx - lx * .14, tz - lz * .14, -surfaceImpulse * sideSign, .105);
    }
    for (const vortex of this.vortices) {
      vortex.age += DT;
      vortex.x += vortex.vx * DT;
      vortex.z += vortex.vz * DT;
    }
    this.vortices = this.vortices.filter(({ age }) => age < 5.4);
    for (const tracer of this.tracers) {
      tracer.age += DT;
      const [u,v] = this.flow(tracer.x,tracer.y,tracer.z);
      tracer.x += u*DT; tracer.z += v*DT;
    }
    this.tracers = this.tracers.filter(({age}) => age < 4.6);

    const nx = this.x + fx * .317, nz = this.z + fz * .317;
    // Approximate the articulated envelope at the snout and peduncle in addition to the center.
    const slope = Math.sin(this.pitch);
    const clearance = Math.max(floorAt(nx,nz) + .029 - slope*.317,
      floorAt(this.x-fx*.27,this.z-fz*.27) + .035 + slope*.27);
    if (this.y < clearance) {
      this.y = Math.min(-.13, clearance);
      this.vy = Math.max(0, this.vy);
    }
    const mouthClearance = this.y + slope * .317 - floorAt(nx,nz);
    const intake = forage * (1 - ease(.065,.155,mouthClearance));
    this.mouthForage = mix(this.mouthForage,intake,1 - Math.exp(-DT*6.0));
    if (forage > .32 && mouthClearance < .12
        && this.random() < DT * 25 * forage && this.sediment.length < 480) {
      this.sediment.push({ x: nx + (this.random()-.5)*.10, y: floorAt(nx,nz)+.025,
        z: nz+(this.random()-.5)*.10, age: 0, diameter: .005 + this.random()*.012,
        vx: .065 * fx + (this.random()-.5)*.12, vz: .065 * fz + (this.random()-.5)*.12,
        vy: .075 + this.random()*.13 });
      this.liftCount++;
    }
    for (const grain of this.sediment) {
      grain.age += DT;
      const [u, v] = this.flow(grain.x, grain.y, grain.z);
      grain.vx += (u-grain.vx) * DT * 2;
      grain.vz += (v-grain.vz) * DT * 2;
      grain.vy += (-.029-grain.vy) * DT * 1.4;
      grain.x += grain.vx * DT; grain.y += grain.vy * DT; grain.z += grain.vz * DT;
    }
    this.sediment = this.sediment.filter((grain) => grain.age < 12 && grain.y > floorAt(grain.x, grain.z) + .003);
    this.field.step();
  }
}
