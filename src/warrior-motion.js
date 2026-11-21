import { MathUtils, Quaternion, Vector2, Vector3 } from "three";

const { clamp, lerp, euclideanModulo, smoothstep } = MathUtils;
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const smooth = t => t * t * (3 - 2 * t);
const soleHeight = .07;
const heel = -.07;
const toe = .15;
const vaultBlendOut = .22;
const blinkIntervals = [4.1, 3.2, 5.4, 2.8];
const stopGrace = .06;
const settlingStepTime = .18;
const settledTime = stopGrace + 2 * settlingStepTime;

// A stance foot travels backward through local space by the distance the body moved.
export function strideFoot(phase, cycleMeters, stance, lift) {
  const p = euclideanModulo(phase, 1);
  const half = cycleMeters * stance / 2;
  if (p < stance) return { forward: half - cycleMeters * p, rise: 0 };
  const swing = (p - stance) / (1 - stance);
  return {
    // Carry the ankle's backward velocity through toe-off and the next contact.
    forward: lerp(-half, half, smooth(swing)) -
      cycleMeters * (1 - stance) * swing * (1 - swing) * (1 - 2 * swing),
    rise: lift * Math.sin(Math.PI * swing) ** 2,
  };
}

export function solveLeg(forward, drop, thigh, shin = thigh) {
  const minReach = Math.max(.05, Math.abs(thigh - shin) + .0001);
  const reach = clamp(Math.hypot(drop, forward), minReach, thigh + shin - .0001);
  const hipBend = Math.acos(clamp((thigh ** 2 + reach ** 2 - shin ** 2) / (2 * thigh * reach), -1, 1));
  const kneeBend = Math.acos(clamp((reach ** 2 - thigh ** 2 - shin ** 2) / (2 * thigh * shin), -1, 1));
  return {
    hip: -Math.atan2(forward, drop) - hipBend,
    knee: kneeBend,
  };
}

function footPitch(phase, stance, contact, push) {
  if (phase < stance) {
    const support = phase / stance;
    return contact * (1 - smoothstep(support, 0, .32)) + push * smoothstep(support, .52, 1);
  }
  const swing = (phase - stance) / (1 - stance);
  return lerp(push, contact, smoothstep(swing, .04, .72));
}

// Vector2's y component represents world Z. The support point stays there while the body turns.
function plantedStep(foot, phase, path, rest, cycle, stance, lift, gait, running, blend, constrain) {
  const { travel, direction, forward, heading } = path;
  const strike = cycle * stance / 2 * gait;
  const base = new Vector2(rest * Math.cos(heading), -rest * Math.sin(heading)).add(travel);
  const contactPitch = lerp(-.40, .10, running) * gait * forward;
  if (foot.phase === undefined || phase < foot.phase) {
    foot.anchor = foot.nextStrike?.clone() ?? base.clone().addScaledVector(direction, strike - phase * cycle);
    foot.stance = stance;
    foot.heading = foot.nextHeading ?? heading;
    foot.nextHeading = undefined;
    foot.contactPitch = foot.nextPitch ?? contactPitch;
    foot.pushPitch = lerp(.47, .62, running) * gait * forward;
    foot.nextStrike = undefined;
    foot.nextPitch = undefined;
  }
  foot.phase = phase;
  // Lift early if a changing pace would carry the body too far past the support foot.
  if (phase < foot.stance && phase > .001 && base.clone().sub(foot.anchor).dot(direction) > .59) {
    foot.pushPitch = footPitch(phase, foot.stance, foot.contactPitch, foot.pushPitch);
    foot.stance = phase;
  }
  if (phase < foot.stance) {
    return {
      point: foot.anchor,
      heading: foot.heading,
      rise: 0,
      pitch: footPitch(phase, foot.stance, foot.contactPitch, foot.pushPitch),
      load: Math.sin(Math.PI * phase / foot.stance),
    };
  }

  const swing = (phase - foot.stance) / (1 - foot.stance);
  const goal = base.addScaledVector(direction, (1 - phase) * cycle + strike);
  constrain(goal);
  // Commit before contact. A late speed change belongs to the following step.
  if (foot.nextStrike === undefined || swing < .90) {
    foot.nextStrike = foot.nextStrike ? foot.nextStrike.lerp(goal, blend) : goal;
    foot.nextPitch = lerp(foot.nextPitch ?? contactPitch, contactPitch, blend);
    foot.nextHeading = heading;
  }
  return {
    point: foot.anchor.clone().lerp(foot.nextStrike, smooth(swing)),
    heading: foot.heading + angleDelta(foot.heading, foot.nextHeading) * smooth(swing),
    rise: lift * Math.sin(Math.PI * swing) ** 2,
    pitch: footPitch(phase, foot.stance, foot.nextPitch, foot.pushPitch),
    load: 0,
  };
}

function settleFoot(foot, time) {
  const progress = clamp(time / settlingStepTime, 0, 1);
  const remaining = 1 - smooth(progress);
  return {
    stride: foot.stride * remaining,
    lateral: foot.lateral * remaining,
    yaw: foot.yaw * remaining,
    rise: foot.rise * remaining + Math.min(.10, Math.hypot(foot.stride, foot.lateral) * .45) * Math.sin(Math.PI * progress) ** 2,
    pitch: foot.pitch * (1 - smoothstep(progress, .05, .7)),
    load: foot.load * remaining,
  };
}

export function connectWarrior(scene) {
  const node = name => scene.getObjectByName(name);
  const root = node("ValleyWarrior");
  const pelvis = node("WarriorPelvis");
  const chest = node("WarriorChest");
  const head = node("WarriorHead");
  const face = node("WarriorFace");
  const blink = face?.morphTargetDictionary?.Blink;
  const legs = ["Left", "Right"].map(side => [
    node(side + "Leg"), node(side + "Shin"), node(side + "Foot"),
  ]);
  const arms = ["Left", "Right"].map(side => [
    node(side + "Arm"), node(side + "Forearm"), node(side + "Grip"),
  ]);
  const panels = Array.from({ length: 8 }, (_, index) => node("Kusazuri" + index));
  if ([root, pelvis, chest, ...legs.flat(), ...arms.flat(), ...panels].some(part => !part))
    throw new Error("Warrior asset is missing required articulation");
  const hipHeight = pelvis.position.y;
  const links = legs.map(([, knee, foot]) => [-knee.position.y, -foot.position.y]);
  const armRoll = arms.map(([upper]) => upper.rotation.z);
  const scale = root.scale.x;
  for (const panel of panels) panel.rotation.reorder("YXZ");

  let phase = 0, gait = 0, pace = 0, landing = 0, landingDuration = .17;
  const travel = new Vector2();
  const direction = new Vector2();
  const restWidths = legs.map(([hip]) => hip.position.x);
  const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0), zAxis = new Vector3(0, 0, 1);
  const twist = new Quaternion();
  const restPelvisX = pelvis.position.x;
  let footStates = [], groundSteps, settling, restarting, visualHeading;
  let hipShift = 0, previousForwardSpeed = 0, brakeLean = 0;
  let vaultProgress = 0, vaultRelease = vaultBlendOut;
  let chestPitch = chest.rotation.x;
  let blinkClock = 0, blinkInterval = 2.6, blinkCount = 0;
  return ({ dt, distance, forward, sideways = 0, heading = 0, grounded, vertical, leap, landed, vault, pose, reset, committedFacing }) => {
    if (blink !== undefined) {
      blinkClock += dt;
      if (blinkClock >= blinkInterval + .156) {
        blinkClock -= blinkInterval + .156;
        blinkInterval = blinkIntervals[blinkCount++ % blinkIntervals.length];
      }
      const elapsed = blinkClock - blinkInterval;
      face.morphTargetInfluences[blink] = smoothstep(elapsed, 0, .055) *
        (1 - smoothstep(elapsed, .074, .156));
    }
    // A teleport or respawn must not leave either foot anchored to the previous location.
    if (reset || distance > 1.2) {
      distance = 0;
      visualHeading = undefined;
      landing = 0;
      vaultRelease = vaultBlendOut;
      travel.set(0, 0);
      footStates.length = 0;
      groundSteps = settling = restarting = undefined;
      gait = pace = hipShift = brakeLean = previousForwardSpeed = 0;
      phase = 0;
    }
    const worldX = sideways * Math.cos(heading) + forward * Math.sin(heading);
    const worldZ = forward * Math.cos(heading) - sideways * Math.sin(heading);
    const oldHeading = visualHeading ?? heading;
    const gap = angleDelta(oldHeading, heading);
    // Free traversal can turn through a plant. Attacks and vaults keep their authored gameplay facing.
    // Committed facing can snap. Keep the old foot contacts and let the next step realign them.
    const snap = committedFacing && Math.abs(gap) > .9;
    const turn = committedFacing ? gap : clamp(gap * (1 - Math.exp(-16 * dt)), -12 * dt, 12 * dt);
    visualHeading = oldHeading + turn;
    scene.rotation.y = turn - gap;
    heading = visualHeading;
    const sin = Math.sin(heading), cos = Math.cos(heading);
    forward = worldX * sin + worldZ * cos;
    sideways = worldX * cos - worldZ * sin;
    const speed = grounded && dt > 0 ? distance / dt : 0;
    const pivot = grounded && Math.abs(turn) > .006;
    const blend = 1 - Math.exp(-dt * 17);
    // Keep cadence and contact through a one-frame neutral stick sample.
    const briefNeutral = grounded && distance === 0 && !pivot && groundSteps &&
      (settling?.elapsed ?? 0) + dt <= stopGrace;
    if (!briefNeutral) {
      gait = lerp(gait, clamp(speed / .85, pivot ? .34 : 0, 1), blend);
      pace = lerp(pace, speed, blend);
      const forwardSpeed = speed * forward;
      const acceleration = dt > 0 ? (forwardSpeed - previousForwardSpeed) / dt : 0;
      brakeLean = lerp(brakeLean, grounded ? clamp(acceleration * .002, -.085, .085) : 0, blend);
      previousForwardSpeed = forwardSpeed;
    }
    const running = smoothstep(pace, 3.6, 7) * smoothstep(forward, .25, .95);
    const shuffle = committedFacing && !snap ? smoothstep(Math.abs(sideways), .38, .98) * smoothstep(pace, .3, 2) : 0;
    const cycle = lerp(lerp(lerp(.78, 1.78, smoothstep(pace, .45, 3.6)), 3.48, running), 1.02, shuffle);
    const stance = lerp(.56, .28, running);
    if (landed) {
      landingDuration = leap ? .34 : .17;
      landing = landingDuration;
    } else landing = grounded ? Math.max(0, landing - dt) : 0;
    const lift = lerp(.12, .30, running) * gait;
    const toLocal = (step, i) => {
      const x = step.point.x - travel.x, z = step.point.y - travel.y;
      return { ...step, stride: x * sin + z * cos, lateral: x * cos - z * sin - restWidths[i], yaw: angleDelta(heading, step.heading) };
    };
    const toWorld = (step, i, atHeading) => {
      const lateral = restWidths[i] + step.lateral;
      return new Vector2(lateral * Math.cos(atHeading) + step.stride * Math.sin(atHeading),
        step.stride * Math.cos(atHeading) - lateral * Math.sin(atHeading)).add(travel);
    };
    if (!grounded) {
      travel.set(0, 0);
      footStates.length = 0;
      groundSteps = settling = restarting = undefined;
    } else if (distance > 0 || pivot) {
      direction.set(worldX, worldZ);
      if (distance === 0) direction.set(0, 0);
      const fromRest = !groundSteps;
      const resuming = settling?.elapsed > stopGrace;
      if (fromRest || resuming) {
        const stanceFeet = groundSteps ?? restWidths.map(() => ({ stride: 0, lateral: 0, yaw: 0, rise: 0, pitch: 0, load: 0 }));
        const startingHeading = heading - turn;
        const startingFeet = stanceFeet.map((step, i) => toWorld(step, i, startingHeading));
        // Both soles start from their previous poses. On a pivot, the outside foot moves first.
        phase = turn > 0 ? stance : euclideanModulo(stance + .5, 1);
        if (!pivot || snap) phase = 0;
        footStates = startingFeet.map((point, i) => ({
          nextStrike: point, nextPitch: stanceFeet[i].pitch, nextHeading: startingHeading + stanceFeet[i].yaw,
        }));
        if (resuming && settling.elapsed < settledTime) {
          restarting = { feet: stanceFeet, points: startingFeet, heading: startingHeading, elapsed: 0 };
        }
      } else {
        // A turn in place advances the swing without adding root motion.
        const pivotMotion = snap ? 0 : Math.min(.42, Math.abs(turn) * .33);
        phase = euclideanModulo(phase + Math.max(distance / scale, pivotMotion) / cycle, 1);
      }
      travel.addScaledVector(direction, distance / scale);
      settling = undefined;
      const path = { travel, direction, forward: distance ? forward : 0, heading };
      const right = new Vector2(cos, -sin);
      groundSteps = legs.map((_, i) => {
        const side = Math.sign(restWidths[i]);
        const other = footStates[1 - i];
        const constrain = point => {
          const support = other?.anchor ?? other?.nextStrike;
          if (shuffle < .35 || !support) return;
          // The trailing boot closes toward the leading boot during a shuffle.
          const separation = ((point.x - support.x) * cos - (point.y - support.y) * sin) * side;
          point.addScaledVector(right, Math.max(0, .11 - separation) * side);
        };
        return toLocal(plantedStep(footStates[i] ??= {}, euclideanModulo(phase + i * .5, 1),
          path, restWidths[i] + side * shuffle * .17, cycle, stance, lift, gait, running, blend, constrain), i);
      });
      if (restarting) {
        restarting.elapsed += dt;
        const weight = smoothstep(restarting.elapsed, 0, .15);
        groundSteps = groundSteps.map((step, i) => {
          const previous = toLocal({
            ...restarting.feet[i], point: restarting.points[i], heading: restarting.heading + restarting.feet[i].yaw,
          }, i);
          return {
            stride: lerp(previous.stride, step.stride, weight),
            lateral: lerp(previous.lateral, step.lateral, weight),
            yaw: previous.yaw + angleDelta(previous.yaw, step.yaw) * weight,
            rise: lerp(previous.rise, step.rise, weight),
            pitch: lerp(previous.pitch, step.pitch, weight),
            load: lerp(previous.load, step.load, weight),
          };
        });
        if (weight === 1) restarting = undefined;
      }
    } else if (groundSteps) {
      // Finish the airborne foot first and keep the other planted until it can take a settling step.
      settling ??= { feet: groundSteps, first: groundSteps[1].rise > groundSteps[0].rise ? 1 : 0, elapsed: 0 };
      settling.elapsed = Math.min(settledTime, settling.elapsed + dt);
      if (!briefNeutral) {
        restarting = undefined;
        groundSteps = settling.feet.map((foot, i) => settleFoot(foot,
          settling.elapsed - stopGrace - (i === settling.first ? 0 : settlingStepTime)));
      }
    }

    const action = pose?.action;
    const attacking = ["startup", "active", "recovery"].includes(pose?.phase);
    const charge = action === "charging";
    const guarding = pose?.guarding || action === "guard";
    const strike = attacking ? (pose.phase === "startup" ? -.26 : pose.phase === "active" ? .30 : .11) : charge ? -.3 : 0;
    // The vault supplies normalized progress. Reach before gathering the knees,
    // then release the arms and extend the lead leg for the landing.
    if (vault !== undefined) {
      vaultProgress = vault;
      vaultRelease = 0;
    } else {
      vaultRelease = Math.min(vaultBlendOut, vaultRelease + dt);
    }
    // Keep the last vault shape briefly when gameplay switches to an attack or fall.
    const vaultWeight = 1 - smoothstep(vaultRelease, 0, vaultBlendOut);
    const brace = vaultWeight * smoothstep(vaultProgress, .02, .22) * (1 - smoothstep(vaultProgress, .37, .66));
    const gather = vaultWeight * smoothstep(vaultProgress, .12, .43) * (1 - smoothstep(vaultProgress, .54, .90));
    const extend = vaultWeight * smoothstep(vaultProgress, .56, .76) * (1 - smoothstep(vaultProgress, .80, 1));
    const tuck = grounded ? 0 : (leap ? .30 : .16) + clamp(vertical / 45, -.08, .12);
    const impact = landing ? Math.sin(Math.PI * landing / landingDuration) : 0;
    const steps = legs.map((_, i) => {
      let step = groundSteps?.[i];
      if (!step) {
        const p = euclideanModulo(phase + i * .5, 1);
        const { forward: stride, rise } = strideFoot(p, cycle, stance, lift);
        step = {
          stride: stride * gait * forward,
          lateral: 0,
          yaw: 0,
          rise,
          pitch: footPitch(p, stance, lerp(-.40, .10, running), lerp(.47, .62, running)) * gait * forward,
          load: Math.sin(Math.PI * clamp(p / stance, 0, 1)),
        };
      }
      let { stride, lateral, rise } = step;
      const { pitch, yaw } = step;
      // A change in direction can put a late swing target outside the usable leg arc.
      const reach = Math.hypot(stride, lateral);
      const limit = (links[i][0] + links[i][1]) * .78;
      if (grounded && reach > limit) {
        stride *= limit / reach;
        lateral *= limit / reach;
        rise += .09 * smoothstep(reach, limit, limit + .12);
      }
      const contact = pitch < 0 ? heel : toe;
      // Rotate around the heel or toe so rolling through stance keeps the sole on the plane.
      const cos = Math.cos(pitch), sin = Math.sin(pitch);
      const rollOffset = contact * (1 - cos) + soleHeight * sin;
      return {
        gaitStride: stride,
        lateral: lateral + rollOffset * Math.sin(yaw),
        stride: stride + rollOffset * Math.cos(yaw) +
          tuck * (i ? .64 : .39) + gather * (i ? .16 : -.09) + extend * (i ? .19 : -.18),
        rise: rise + contact * sin + soleHeight * (cos - 1) +
          tuck * (i ? .76 : .56) + gather * (i ? .085 : .13) - extend * (i ? .055 : .02),
        pitch: pitch - .35 * tuck,
        yaw,
        load: step.load,
      };
    });
    const supportSide = steps[1].load - steps[0].load;
    hipShift = lerp(hipShift, (supportSide * .045 + clamp(sideways * speed * .008, -.04, .04)) * gait, blend);
    pelvis.position.x = restPelvisX + hipShift;
    // Lower the hips as required to keep both ankle targets inside the leg's reach.
    const requiredSink = Math.max(...steps.map(({ stride, rise, lateral }, i) => {
      const reach = links[i][0] + links[i][1] - .002;
      return hipHeight - soleHeight - rise - Math.sqrt(Math.max(0, reach ** 2 - stride ** 2 - (lateral - hipShift) ** 2));
    }));
    const lead = steps[0].gaitStride - steps[1].gaitStride;
    const doubleSupport = .5 + .5 * Math.cos(4 * Math.PI * (phase - .03));
    const sprintLoad = Math.max(steps[0].load, steps[1].load);
    const gaitSink = gait * lerp(.012 + .04 * doubleSupport, -.048 + .124 * sprintLoad, running);
    const sink = Math.max(requiredSink, gaitSink + .43 * brace + .14 * gather) +
      (guarding ? .025 : 0) + .13 * impact;
    pelvis.position.y = hipHeight - sink;
    const balance = guarding || charge || attacking ? 0 : 1;
    const lean = gait * lerp(.055, .30, running) * forward + .24 * tuck + .56 * impact + brakeLean;
    chestPitch = lerp(chestPitch, lean, blend);
    chest.rotation.x = chestPitch + .82 * brace + .45 * gather;
    chest.rotation.y = lerp(chest.rotation.y, strike - lead * lerp(.12, .18, running) * balance, blend);
    chest.rotation.z = lerp(chest.rotation.z, (-supportSide * gait * lerp(.075, .046, running) - sideways * speed * .016) * balance, blend);
    if (head) {
      head.rotation.x = lerp(head.rotation.x, -.68 * chest.rotation.x + .14 * brace, blend);
      head.rotation.y = lerp(head.rotation.y, -.58 * chest.rotation.y, blend);
      head.rotation.z = lerp(head.rotation.z, -.72 * chest.rotation.z, blend);
    }

    legs.forEach(([hip, knee, foot], i) => {
      const { stride, rise, pitch, lateral, yaw } = steps[i];
      const drop = hipHeight - soleHeight - sink - rise;
      const side = lateral - hipShift;
      const bank = Math.atan2(side, Math.max(.001, drop));
      const angles = solveLeg(stride, Math.hypot(drop, side), ...links[i]);
      // Rotate the leg's bending plane towards the ankle, then undo that bank at the boot.
      hip.quaternion.setFromAxisAngle(zAxis, bank).multiply(twist.setFromAxisAngle(xAxis, angles.hip));
      knee.rotation.x = angles.knee;
      foot.quaternion.setFromAxisAngle(xAxis, -angles.hip - angles.knee)
        .multiply(twist.setFromAxisAngle(zAxis, -bank))
        .multiply(twist.setFromAxisAngle(yAxis, yaw))
        .multiply(twist.setFromAxisAngle(xAxis, pitch));
    });

    arms.forEach(([upper, forearm], i) => {
      const side = i ? 1 : -1;
      const swing = -side * lead;
      const target = guarding ? -.70 : charge || attacking ? -.52 - strike
        : swing * lerp(.37, .62, running) - .10 * gait * running - tuck * 1.8;
      upper.rotation.x = lerp(upper.rotation.x, target, blend);
      upper.rotation.z = lerp(upper.rotation.z, armRoll[i] + side * (tuck * .6 + .13 * brace), blend);
      const elbow = lerp(.24, 1.05, running * gait) + Math.max(0, -swing) * .25;
      forearm.rotation.x = lerp(forearm.rotation.x, guarding ? -.86 : attacking ? -.46 : -elbow, blend);
      if (brace > 0) {
        const reach = lerp(-.82, .34, smoothstep(vaultProgress, .23, .54)) + (i ? .12 : 0);
        upper.rotation.x = lerp(upper.rotation.x, reach - chest.rotation.x, brace);
        forearm.rotation.x = lerp(forearm.rotation.x, -.12, brace);
      }
    });
    panels.forEach((panel, i) => {
      const side = i * Math.PI / 4;
      const flare = Math.max(0, Math.cos(side)) * (.9 * tuck + .18 * gait + .54 * gather);
      const sway = Math.sin(phase * Math.PI * 2 + side) * gait * .11;
      panel.rotation.x = lerp(panel.rotation.x, -flare + sway, blend);
    });
  };
}
