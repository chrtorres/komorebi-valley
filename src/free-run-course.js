// The Veiled Pass free-running course and the scenery the Watchkeeper can touch.
//
// Physical data (solids/surfaces) drives src/parkour.js; meshes are smooth, bevelled
// pieces in the shrine kit's palette. The mission route runs west from the lantern path
// behind the shrine at (-15, -37): three stone posts, a wall-run along the cloister
// wall, and a wall-jump north onto the roof's back slope.
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { roofHeight } from "./parkour.js";

export const HALLS = [[-15, -37], [15, -65]];
export const COURSE = {
  // Spaced 6.3 m: a level sprint leap (about 7 m/s forward, 7.8 m/s up) comes down onto the
  // next post's 1.5 m wide top; a plain hop reaches the low first post from the path.
  // The line runs between the cloister wall and the roof's back eave. The last post is
  // too low to reach the roof directly: the route is a wall-run and a wall-jump north.
  posts: [[3.2, -42.9, .9], [-3.1, -42.8, 1.3], [-9.4, -42.7, 1.5]], // x, z, height above own ground
  // South of the roof's back eave: the run ends in a wall-jump north onto the roof.
  wall: { x0: -10.6, x1: -16.0, z: -43.4, thickness: .45, topAboveHall: 5.6 },
  beaconHall: 0, // index into HALLS
};

function stoneMaterial(T, color = "#8f8d84") {
  return new T.MeshStandardMaterial({ color, roughness: .9 });
}

/** Weathered stone post: tapered, with a softly rounded crown (no hard rims). */
function postGeometry(T, radius, height) {
  const pts = [];
  pts.push(new T.Vector2(0, 0));
  pts.push(new T.Vector2(radius * 1.12, 0));
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new T.Vector2(radius * (1.1 - .1 * t) + .015 * Math.sin(t * 9), height * .9 * t));
  }
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * Math.PI / 2;
    pts.push(new T.Vector2(radius * (1 - .12 * (1 - Math.cos(a))) * Math.cos(a) + .001, height * .9 + height * .1 * Math.sin(a)));
  }
  pts.push(new T.Vector2(0, height));
  const g = new T.LatheGeometry(pts, 28);
  // Organic irregularity so posts read as hewn, weathered stone.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + .035 * Math.sin(a * 3 + y * 2.1) + .02 * Math.sin(a * 7 - y * 4);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Rounded tile cap (semi-cylinder) along X for the cloister wall. */
function capGeometry(T, length, radius) {
  const shape = new T.Shape();
  shape.moveTo(-radius, 0);
  shape.absarc(0, 0, radius, Math.PI, 0, true);
  shape.lineTo(-radius, 0);
  const g = new T.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function createFreeRunCourse(T, scene, world) {
  const { height } = world;
  const group = new T.Group();
  group.name = "Free-run course";
  scene.add(group);
  const solids = [], surfaces = [];

  // Halls: walls block, roofs are walkable, podiums are steps.
  for (const [x, z] of HALLS) {
    const y = height(x, z);
    solids.push({ kind: "box", cx: x, cz: z, hx: 4.1, hz: 3.1, y0: y, top: y + 3.7, standable: false, name: "hall" });
    surfaces.push({ kind: "roof", hall: { x, y, z } });
    surfaces.push({ kind: "box", cx: x, cz: z, hx: 5, hz: 4, top: y + .5 });
  }
  // Torii posts and Kasuga lanterns are solid; lantern roofs can be stood on.
  const pathX = (z) => 5 + Math.sin((z - 16) * 0.055) * 8;
  for (const z of [8, -37]) for (const s of [-1, 1]) {
    const x = pathX(z) + s * 2.65, y = height(x, z);
    solids.push({ kind: "cyl", cx: x, cz: z, r: .3, y0: y, top: y + 5.6, standable: false, name: "torii" });
  }
  for (const l of world.lanterns) {
    const y = height(l.x, l.z);
    solids.push({ kind: "cyl", cx: l.x, cz: l.z, r: .42, y0: y, top: y + 2.42, name: "lantern" });
  }

  // Stone posts.
  const posts = COURSE.posts.map(([x, z, h], i) => {
    const y = height(x, z);
    const mesh = new T.Mesh(postGeometry(T, .76, h + .35), stoneMaterial(T, ["#8f8d84", "#878679", "#93907f"][i]));
    mesh.position.set(x, y - .35, z);
    mesh.rotation.y = i * 1.3;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const solid = { kind: "cyl", cx: x, cz: z, r: .74, y0: y, top: y + h, name: `post-${i + 1}` };
    solids.push(solid);
    return solid;
  });

  // Cloister wall: plaster on a stone footing under a rounded tile cap. Runnable both faces.
  const hall = HALLS[COURSE.beaconHall], hallY = height(hall[0], hall[1]);
  const w = COURSE.wall, length = Math.abs(w.x1 - w.x0), cx = (w.x0 + w.x1) / 2;
  const base = Math.min(height(w.x0, w.z), height(w.x1, w.z), height(cx, w.z)) - .3;
  const top = hallY + w.topAboveHall;
  const plaster = new T.Mesh(new RoundedBoxGeometry(length, top - base - .2, w.thickness, 3, .06),
    new T.MeshStandardMaterial({ color: "#e7ddcb", roughness: .92 }));
  plaster.position.set(cx, (top + base - .2) / 2, w.z);
  const footing = new T.Mesh(new RoundedBoxGeometry(length + .1, .9, w.thickness + .12, 3, .08), stoneMaterial(T, "#7f7d73"));
  footing.position.set(cx, base + .45, w.z);
  const cap = new T.Mesh(capGeometry(T, length + .5, w.thickness * .78), new T.MeshStandardMaterial({ color: "#363d3f", roughness: .5 }));
  cap.position.set(cx, top - .2, w.z);
  for (const m of [plaster, footing, cap]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  const wall = { kind: "box", cx, cz: w.z, hx: length / 2, hz: w.thickness / 2, y0: base, top, runnable: true, name: "cloister-wall" };
  solids.push(wall);

  // Signal beacon: a bronze brazier on the ridge of the shrine roof.
  const beaconPos = new T.Vector3(hall[0] + .9, hallY + 7.1, hall[1]);
  const brazier = new T.Group();
  const bronze = new T.MeshStandardMaterial({ color: "#8a6a32", roughness: .35, metalness: .85 });
  const bowl = new T.Mesh(new T.LatheGeometry([
    new T.Vector2(.05, 0), new T.Vector2(.12, .05), new T.Vector2(.3, .22), new T.Vector2(.36, .34), new T.Vector2(.33, .36),
  ], 32), bronze);
  bowl.position.y = .28;
  brazier.add(bowl);
  for (let i = 0; i < 3; i++) {
    const leg = new T.Mesh(new T.CylinderGeometry(.025, .03, .36, 8), bronze);
    const a = i * Math.PI * 2 / 3;
    leg.position.set(Math.cos(a) * .14, .16, Math.sin(a) * .14);
    leg.rotation.set(Math.sin(a) * .25, 0, -Math.cos(a) * .25);
    brazier.add(leg);
  }
  const flameMaterial = new T.MeshBasicMaterial({ color: "#ffb35a", transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  const flames = [0, 1, 2].map((i) => {
    const f = new T.Mesh(new T.ConeGeometry(.16 - i * .04, .7 - i * .12, 16, 1, true), flameMaterial.clone());
    f.position.y = .62 + i * .06;
    brazier.add(f);
    return f;
  });
  const fireLight = new T.PointLight("#ff9a45", 0, 18, 2);
  fireLight.position.y = .9;
  brazier.add(fireLight);
  brazier.position.copy(beaconPos);
  brazier.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(brazier);
  let lit = 0;

  return {
    course: { solids, surfaces },
    posts,
    wall,
    hallY,
    roofSpot: { x: hall[0] + 2.4, z: hall[1] - 3.6 },
    /** True when (x, y, z) stands on this course's shrine roof surface. */
    onRoof(x, y, z) {
      const h = roofHeight(x - hall[0], z - hall[1]);
      return h > 3.5 && y >= hallY + h - .15;
    },
    beacon: beaconPos,
    setBeacon(on) { lit = on ? Math.max(lit, .001) : 0; },
    get beaconLit() { return lit > 0; },
    update(dt, time) {
      if (lit > 0) lit = Math.min(1, lit + dt * .8);
      flames.forEach((f, i) => {
        f.material.opacity = lit * (.55 - i * .12);
        const flicker = 1 + .12 * Math.sin(time * (13 + i * 5) + i) + .07 * Math.sin(time * 29 + i * 2);
        f.scale.set(lit, lit * flicker, lit);
        f.rotation.y = time * (1 + i);
      });
      fireLight.intensity = lit * (6 + Math.sin(time * 17) * .8);
    },
  };
}
