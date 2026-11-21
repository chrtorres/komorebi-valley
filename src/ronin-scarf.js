// The ronin's crimson scarf tails: two cloth ribbons simulated in world space so they
// trail behind a run, lift in a leap and settle against the coat when standing.
//
// Verlet particles under gravity and air drag (still air plus a light valley breeze),
// with segment-length constraints and a body collider the cloth cannot pass through.
// Units: metres, seconds. The tails hang from the GLB's "RoninScarfAnchor" node.
//
// The collider is the ronin's measured silhouette, not a fixed cylinder: per height, an
// ellipse whose half-width and back/front depths come from the v006 mesh (cape, robe and
// legs, in model units). It rides the animated chest and pelvis bones, so it follows the
// running lean, the bank into turns, crouches and the authored 1.8 m scale.

const STEP = 1 / 120;
const TAILS = [
  { length: 1.12, side: -.04, width: .2, tip: .08 },
  { length: .86, side: .05, width: .17, tip: .07 },
];
const SEGMENTS = 14;
// [model height, back depth, half-width, front depth] sampled from the v006 GLB.
const PROFILE = [
  [.05, .07, .16, .28], [.40, .09, .18, .26], [.45, .15, .23, .25], [.55, .19, .26, .25],
  [.80, .19, .23, .22], [.90, .17, .34, .19], [1.05, .17, .37, .16], [1.15, .23, .38, .16],
  [1.30, .23, .38, .16], [1.35, .20, .34, .14], [1.40, .115, .11, .085], [1.47, .10, .10, .08],
];
// Ribbon half-thickness plus the sideways reach of its edges over the curved back.
const CLEARANCE = .03;
// Rest heights of the bone pivots in model space.
const CHEST_PIVOT = 1.055, PELVIS_PIVOT = .91;

/** Body ellipse at a model-space height, or null above or below the clothed body. */
export function bodyProfile(y) {
  if (y < PROFILE[0][0] || y > PROFILE.at(-1)[0]) return null;
  let i = 1;
  while (PROFILE[i][0] < y) i++;
  const a = PROFILE[i - 1], b = PROFILE[i], t = (y - a[0]) / (b[0] - a[0]);
  const at = (k) => a[k] + (b[k] - a[k]) * t + CLEARANCE;
  return { back: at(1), side: at(2), front: at(3) };
}

/**
 * Push a model-space point (x, z at height y) out of the body ellipse. `fromX/fromZ`, the
 * point's previous position, picks the exit side so fast cloth cannot tunnel through the
 * torso and pop out of the chest. Returns true when the point was moved.
 */
export function pushOutOfBody(local, fromX, fromZ) {
  const e = bodyProfile(local.y);
  if (!e) return false;
  const depth = (z) => (z < 0 ? e.back : e.front);
  const inside = (x, z) => (x / e.side) ** 2 + (z / depth(z)) ** 2;
  if (inside(local.x, local.z) >= 1) return false;
  // Exit along the previous position's bearing when it was outside, else radially.
  const useFrom = fromX !== undefined && inside(fromX, fromZ) >= 1;
  let dx = useFrom ? fromX : local.x, dz = useFrom ? fromZ : local.z;
  if (Math.hypot(dx, dz) < 1e-6) { dx = 0; dz = -1; }
  const k = 1 / Math.sqrt(inside(dx, dz));
  local.x = dx * k;
  local.z = dz * k;
  return true;
}

export function createRoninScarf(T, scene, player) {
  const group = new T.Group();
  group.name = "RoninScarfTails";
  scene.add(group);
  const fallback = new T.MeshStandardMaterial({ color: "#7d1212", roughness: .86, side: T.DoubleSide });
  let material = fallback, anchor = null, wasVisible = false, accumulator = 0, time = 0;
  const anchorWorld = new T.Vector3(), right = new T.Vector3(), lastAnchor = new T.Vector3();
  const tmp = new T.Vector3(), dir = new T.Vector3(), side = new T.Vector3(), body = new T.Vector3();
  const local = new T.Vector3(), from = new T.Vector3();
  const frames = [
    { name: "WarriorChest", pivot: CHEST_PIVOT, node: null, inverse: new T.Matrix4() },
    { name: "WarriorPelvis", pivot: PELVIS_PIVOT, node: null, inverse: new T.Matrix4() },
  ];

  // Collide one particle with the body in the bone frame covering its height.
  function collide(p, q) {
    for (const f of frames) {
      if (!f.node) continue;
      local.copy(p).applyMatrix4(f.inverse);
      const y = local.y + f.pivot;
      if (f.pivot === CHEST_PIVOT && y < 1.0) continue;
      from.copy(q).applyMatrix4(f.inverse);
      local.y = y;
      if (pushOutOfBody(local, from.x, from.z)) {
        local.y -= f.pivot;
        p.copy(local.applyMatrix4(f.node.matrixWorld));
      }
      return;
    }
  }

  const tails = TAILS.map((spec) => {
    const points = Array.from({ length: SEGMENTS + 1 }, () => new T.Vector3());
    const previous = points.map((p) => p.clone());
    const cols = 3;
    const geometry = new T.BufferGeometry();
    const positions = new Float32Array((SEGMENTS + 1) * cols * 3);
    const uv = [], index = [];
    for (let r = 0; r <= SEGMENTS; r++) {
      for (let c = 0; c < cols; c++) {
        uv.push(c / (cols - 1) * .5, r / SEGMENTS * spec.length * 3);
        if (r < SEGMENTS && c < cols - 1) {
          const a = r * cols + c;
          index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
        }
      }
    }
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    const mesh = new T.Mesh(geometry, material);
    mesh.name = "RoninScarfTail";
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    // A torn end: each edge thread stops at its own length.
    const tear = [.55, 1, .3];
    return { spec, points, previous, mesh, positions, tear, segment: spec.length / SEGMENTS };
  });

  function rootOf(tail) {
    return tmp.copy(anchorWorld).addScaledVector(right, tail.spec.side);
  }

  function reset() {
    for (const tail of tails) {
      const root = rootOf(tail).clone();
      tail.points.forEach((p, i) => p.set(root.x, root.y - i * tail.segment, root.z));
      tail.previous.forEach((p, i) => p.copy(tail.points[i]));
    }
  }

  function step(h) {
    time += h;
    const gust = .35 + .25 * Math.sin(time * .7) + .15 * Math.sin(time * 2.3);
    body.copy(player.position);
    for (const tail of tails) {
      const { points, previous, segment } = tail;
      points[0].copy(rootOf(tail));
      previous[0].copy(points[0]);
      for (let i = 1; i < points.length; i++) {
        const p = points[i], q = previous[i];
        // Light silk has a low terminal speed (about 2 m/s), so still air holds the tails
        // out behind a sprint; drag is linear in velocity relative to the breeze.
        const vx = p.x - q.x, vy = p.y - q.y, vz = p.z - q.z;
        const drag = Math.exp(-(3.6 + i * .12) * h);
        q.copy(p);
        p.x += vx * drag + (gust * .6) * h * h;
        p.y += vy * drag - 9.81 * h * h;
        p.z += vz * drag + (gust * .3 + .25 * Math.sin(time * 3.1 + i * .6)) * h * h;
      }
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i];
          dir.subVectors(b, a);
          const d = dir.length() || 1e-6;
          const k = (d - segment) / d;
          if (i === 1) b.addScaledVector(dir, -k);
          else { a.addScaledVector(dir, k * .5); b.addScaledVector(dir, -k * .5); }
        }
        for (let i = 1; i < points.length; i++) collide(points[i], previous[i]);
        for (let i = 1; i < points.length; i++) if (points[i].y < body.y + .03) points[i].y = body.y + .03;
      }
    }
  }

  function writeMesh(tail) {
    const { points, positions, spec, tear } = tail;
    for (let r = 0; r <= SEGMENTS; r++) {
      const p = points[r];
      const prev = points[Math.max(0, r - 1)], next = points[Math.min(SEGMENTS, r + 1)];
      dir.subVectors(next, prev).normalize();
      // Ribbon width lies across the body, kept perpendicular to the tail.
      side.copy(right).addScaledVector(dir, -right.dot(dir)).normalize();
      const v = r / SEGMENTS;
      const half = spec.width * (1 - .45 * v) / 2;
      for (let c = 0; c < 3; c++) {
        const u = c - 1;
        let x = p.x + side.x * half * u, y = p.y + side.y * half * u, z = p.z + side.z * half * u;
        if (r === SEGMENTS) {
          // Pull each edge thread back along the tail for a ragged end.
          const back = spec.tip * (1 - tear[c]);
          x -= dir.x * back; y -= dir.y * back; z -= dir.z * back;
        }
        const o = (r * 3 + c) * 3;
        positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
      }
    }
    tail.mesh.geometry.attributes.position.needsUpdate = true;
    tail.mesh.geometry.computeVertexNormals();
  }

  return {
    group,
    update(dt) {
      anchor = player.getObjectByName("RoninScarfAnchor");
      const visible = !!anchor && player.visible;
      group.visible = visible;
      if (!visible) { wasVisible = false; return; }
      if (material === fallback) {
        // Share the GLB's woven crimson so the tails match the neck wrap.
        player.traverse((o) => {
          if (material !== fallback || !o.isMesh) return;
          const found = (Array.isArray(o.material) ? o.material : [o.material]).find((m) => m?.name === "crimson");
          if (found) {
            material = found.clone();
            material.side = T.DoubleSide;
            for (const tail of tails) tail.mesh.material = material;
          }
        });
      }
      player.updateMatrixWorld(true);
      for (const f of frames) {
        f.node = player.getObjectByName(f.name) ?? null;
        if (f.node) f.inverse.copy(f.node.matrixWorld).invert();
      }
      anchor.getWorldPosition(anchorWorld);
      // The GLB anchor sits inside the neck wrap; seat the tail roots on its outer surface.
      const chest = frames[0];
      if (chest.node) {
        local.copy(anchorWorld).applyMatrix4(chest.inverse);
        local.y += CHEST_PIVOT;
        if (pushOutOfBody(local)) {
          local.y -= CHEST_PIVOT;
          anchorWorld.copy(local.applyMatrix4(chest.node.matrixWorld));
        }
      }
      right.set(Math.cos(player.rotation.y), 0, -Math.sin(player.rotation.y));
      if (!wasVisible || anchorWorld.distanceTo(lastAnchor) > 2) { reset(); accumulator = 0; }
      wasVisible = true;
      lastAnchor.copy(anchorWorld);
      accumulator = Math.min(accumulator + Math.max(0, dt), .1);
      while (accumulator >= STEP) { step(STEP); accumulator -= STEP; }
      for (const tail of tails) writeMesh(tail);
    },
    /** Tail tip positions, for tests. */
    tips() { return tails.map((t) => t.points.at(-1).clone()); },
    reset,
  };
}
