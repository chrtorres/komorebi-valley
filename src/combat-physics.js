// Closest feasible 2D capsule position: radial projections and pair/edge intersections
// avoid the oscillation a one-pass push solver exhibits between converging wardens.
export function separateCapsules(position, enemies, radius = 0.7, bound = 70) {
  const bodies = enemies.filter(
    (e) => e.health > 0 && Math.abs(e.y - position.y) <= 1.8,
  );
  const clamp = (n) => Math.max(-bound, Math.min(bound, n));
  const valid = (p) =>
    Math.abs(p.x) <= bound + 1e-8 &&
    Math.abs(p.z) <= bound + 1e-8 &&
    bodies.every((e) => Math.hypot(p.x - e.x, p.z - e.z) >= radius - 1e-7);
  const origin = { x: clamp(position.x), z: clamp(position.z) };
  if (valid(origin)) return origin;
  const candidates = [];
  const add = (x, z) => {
    const p = { x, z };
    if (valid(p)) candidates.push(p);
  };
  for (const e of bodies) {
    const dx = origin.x - e.x,
      dz = origin.z - e.z,
      d = Math.hypot(dx, dz);
    if (d > 1e-8) add(e.x + (dx / d) * radius, e.z + (dz / d) * radius);
    for (const [x, z] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ])
      add(e.x + x, e.z + z);
    for (const edge of [-bound, bound]) {
      const dx = edge - e.x;
      if (Math.abs(dx) <= radius) {
        const z = Math.sqrt(Math.max(0, radius * radius - dx * dx));
        add(edge, e.z + z);
        add(edge, e.z - z);
      }
      const dz = edge - e.z;
      if (Math.abs(dz) <= radius) {
        const x = Math.sqrt(Math.max(0, radius * radius - dz * dz));
        add(e.x + x, edge);
        add(e.x - x, edge);
      }
    }
  }
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j],
        dx = b.x - a.x,
        dz = b.z - a.z,
        d = Math.hypot(dx, dz);
      if (d < 1e-8 || d > radius * 2) continue;
      const h = Math.sqrt(Math.max(0, radius * radius - (d * d) / 4)),
        x = (a.x + b.x) / 2,
        z = (a.z + b.z) / 2;
      add(x - (dz / d) * h, z + (dx / d) * h);
      add(x + (dz / d) * h, z - (dx / d) * h);
    }
  for (const x of [-bound, bound]) for (const z of [-bound, bound]) add(x, z);
  candidates.sort(
    (a, b) =>
      (a.x - origin.x) ** 2 +
      (a.z - origin.z) ** 2 -
      ((b.x - origin.x) ** 2 + (b.z - origin.z) ** 2),
  );
  return candidates[0] || origin;
}
