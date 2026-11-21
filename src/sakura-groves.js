import { pondRadius } from "./koi/habitat.js";
import { createLeafCards } from "./valley-vegetation.js";

const crowns = {
  yoshino: ["#f4d8dc", 1, .85],
  kanzan: ["#de9eaf", .9, 1],
  shidarezakura: ["#ebc6d2", 1.15, .78],
};
// x, z, variety, height in metres, yaw, planting group
export const sakuraPlantings = {
  pass: [
    [.5, 18.8, "yoshino", 6.7, .4, "arrival"],
    [4, 1.5, "kanzan", 5.5, 2.8, "path bend"],
    [-21.8, -12.9, "yoshino", 7.6, 1.3, "pond shore"],
    [-18.6, -1.6, "kanzan", 5.4, 4.1, "pond shore"],
    [-12.7, -15, "shidarezakura", 6.5, .7, "pond shore"],
    [-7.4, -20, "yoshino", 6.2, 2.7, "upper pass"],
    [-7.6, -26, "kanzan", 5.2, 4.8, "upper pass"],
    [-3.2, -32, "shidarezakura", 7.1, 2.4, "gate overlook"],
    [1.2, -44, "yoshino", 6.8, 5.4, "ridge"],
  ],
  storm: [
    [7.6, -17.7, "shidarezakura", 6.7, 2.3, "first gate"],
    [-13.9, -18.8, "kanzan", 5.4, 2.2, "shrine approach"],
    [-16.5, -24.3, "yoshino", 6.3, 5.2, "shrine approach"],
    [-16.2, -30.0, "kanzan", 5.7, .9, "shrine approach"],
    [7.2, -31, "yoshino", 7.3, 2.9, "roof terrace"],
    [23.0, -41.9, "shidarezakura", 7.1, 5.2, "upper shrine"],
    [24.5, -47.7, "kanzan", 6, 3.1, "upper shrine"],
    [20, -57, "yoshino", 7.2, 1.1, "arena edge"],
  ],
};

export function createSakuraGroves(T, parent, height, mode) {
  const grove = new T.Group();
  grove.name = mode === "storm" ? "Storm sakura groves" : "Veiled Pass sakura groves";
  parent.add(grove);
  const leafSkin = createLeafCards(T, 270);
  const taper = new T.CylinderGeometry(.42, 1, 1, 8);
  const bark = new T.MeshStandardMaterial({ color: "#55413a", roughness: .91 });
  const dummy = new T.Object3D(), tint = new T.Color();
  const vertical = new T.Vector3(0, 1, 0);
  const entries = sakuraPlantings[mode].map(([x, z, variety, tall, yaw, group], index) => {
    const tree = new T.Group();
    tree.name = variety;
    tree.userData = { variety, group, state: "fallback", detail: "fallback" };
    tree.position.set(x, height(x, z) - .06, z);
    tree.rotation.y = yaw;
    grove.add(tree);
    const fallback = new T.Group();
    tree.add(fallback);
    // Distant and loading silhouettes share one pink atlas and the same ground anchor.
    let seed = (index + 1) * 953;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const [pink, width, crownHeight] = crowns[variety];
    const leaves = new T.InstancedMesh(leafSkin.geometry, leafSkin.material, 270);
    const branches = new T.InstancedMesh(taper, bark, 7);
    const base = new T.Vector3(0, 0, 0);
    const fork = new T.Vector3(.09 * tall, .45 * tall, 0);
    function limb(start, end, radius, i) {
      const displacement = end.clone().sub(start);
      dummy.position.copy(start).addScaledVector(displacement, .5);
      dummy.quaternion.setFromUnitVectors(vertical, displacement.clone().normalize());
      dummy.scale.set(radius, displacement.length(), radius);
      dummy.updateMatrix();
      branches.setMatrixAt(i, dummy.matrix);
    }
    limb(base, fork, tall * .043, 0);
    for (let branch = 0; branch < 6; branch++) {
      const angle = branch * 2.4;
      const reach = tall * width * (.21 + random() * .15);
      const end = new T.Vector3(Math.cos(angle) * reach, tall * crownHeight * (.77 + random() * .2),
        Math.sin(angle) * reach);
      limb(fork, end, tall * .017, branch + 1);
      for (let i = 0; i < 45; i++) {
        const a = random() * Math.PI * 2, r = Math.sqrt(random()) * tall * .18;
        const weeping = variety === "shidarezakura" ? random() ** 1.7 * tall * .35 : 0;
        dummy.position.set(end.x + r * Math.cos(a), end.y + (random() - .5) * tall * .18 - weeping,
          end.z + r * Math.sin(a));
        dummy.rotation.set(random() * 3, a, random());
        dummy.scale.setScalar(tall * (.08 + random() * .11));
        dummy.updateMatrix();
        const slot = branch * 45 + i;
        leaves.setMatrixAt(slot, dummy.matrix);
        leaves.setColorAt(slot, tint.set(pink).multiplyScalar(.77 + random() * .25));
      }
    }
    fallback.add(branches, leaves);
    return { tree, fallback, variety, tall, pivots: [], small: [], scatter: [] };
  });
  // This atlas row is reserved for softly rounded spring leaves.
  for (let i = 0; i < 270; i++) leafSkin.geometry.attributes.leafRow.setX(i, 2);

  const litter = new T.InstancedMesh(new T.PlaneGeometry(.19, .10), new T.MeshStandardMaterial({
    color: mode === "storm" ? "#c2869b" : "#dfb9bb", roughness: .94,
  }), entries.length * 34);
  let petals = 0;
  for (const { tree, tall } of entries) {
    for (let i = 0; i < 34; i++) {
      const angle = i * 2.39996, radius = Math.sqrt(i / 34) * tall * .56;
      const x = tree.position.x + Math.cos(angle) * radius, z = tree.position.z + Math.sin(angle) * radius;
      if (pondRadius(x, z) < 1.13) continue;
      dummy.position.set(x, height(x, z) + .045, z);
      dummy.rotation.set(-Math.PI / 2, 0, angle);
      dummy.scale.setScalar(.45 + .4 * Math.sin(i * 3.1) ** 2);
      dummy.updateMatrix();
      litter.setMatrixAt(petals++, dummy.matrix);
    }
  }
  litter.count = petals;
  grove.add(litter);

  function mount(entry) {
    entry.tree.userData.state = "loading";
    import("./sakura-models.js").then(({ loadSpecimen }) => loadSpecimen(T, entry.variety)).then(({ scene, height }) => {
      const model = scene.clone(true);
      model.visible = false;
      model.scale.setScalar(entry.tall / height);
      model.traverse(object => {
        if (object.name.startsWith("Pivot_Sway")) entry.pivots.push(object);
        if (/^(Shoots|Buds|Leaves)_/.test(object.name)) entry.small.push(object);
        if (object.isInstancedMesh) entry.scatter.push([object, object.count]);
        if (object.name === "Trunk" || object.name.startsWith("Limb_")) object.receiveShadow = true;
        if (object.name === "Trunk") object.castShadow = true;
      });
      entry.tree.add(model);
      entry.model = model;
      entry.tree.userData.state = "ready";
    }).catch(() => { entry.tree.userData.state = "fallback-error"; });
  }

  return {
    object: grove,
    update(position, time, visible = true) {
      grove.visible = visible;
      if (!visible || !position || typeof window === "undefined") return;
      const nearby = entries.map(entry => ({ entry, distance: entry.tree.position.distanceTo(position) }))
        .sort((a, b) => a.distance - b.distance);
      nearby.forEach(({ entry, distance }, index) => {
        if (distance < 64 && entry.tree.userData.state === "fallback") mount(entry);
        if (!entry.model) return;
        const detail = distance > 48 || index >= 5 ? "fallback" : (index < 2 && distance < 23 ? "full" : "canopy");
        if (entry.tree.userData.detail !== detail) {
          entry.tree.userData.detail = detail;
          entry.model.visible = detail !== "fallback";
          entry.fallback.visible = detail === "fallback";
          entry.small.forEach(part => { part.visible = detail === "full"; });
          entry.scatter.forEach(([part, count]) => {
            part.count = detail === "full" ? count : Math.ceil(count * .58);
          });
        }
        entry.pivots.forEach((pivot, i) => {
          pivot.rotation.z = time ? Math.sin(time * 1.06 + entry.tree.position.x * .31 + i * 1.9) * .009 : 0;
        });
      });
    },
  };
}
