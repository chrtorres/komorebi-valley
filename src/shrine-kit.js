// Authored shrine kit: torii parts, Kasuga stone lantern, irimoya hall and the
// war-worn spirit warden, generated in Blender (creations/komorebi-shrine-kit).
//
// World builders record placements synchronously (so collision, camera volumes
// and unit tests never wait on the network). `attach()` loads the GLB once and
// turns each part into InstancedMeshes, one per material primitive.
//
// Asset contract: metres, +Y up, authored front faces +Z, origin at ground centre.

let kitPromise = null;
const KIT_URL = new URL("./assets/shrine-kit.glb", import.meta.url).href;

function indexParts(scene) {
  scene.updateMatrixWorld(true);
  const parts = new Map();
  for (const node of scene.children) {
    // A multi-material node arrives as a Group of primitives; single-material as a Mesh.
    const primitives = [];
    node.traverse((object) => {
      if (!object.isMesh) return;
      primitives.push({ geometry: object.geometry, material: object.material, local: object.matrixWorld.clone() });
    });
    parts.set(node.name, { node, primitives });
  }
  return parts;
}

/** Load (once) and index the kit's runtime nodes by name. */
export function loadShrineKit(T) {
  if (!kitPromise) {
    kitPromise = import("three/addons/loaders/GLTFLoader.js")
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(KIT_URL))
      .then(({ scene }) => indexParts(scene));
  }
  return kitPromise;
}

/** Parse kit bytes directly (unit tests and offline tools); same index as loadShrineKit. */
export async function parseShrineKit(arrayBuffer) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
  return indexParts(gltf.scene);
}

/** Collects placements, then instantiates them once the kit has loaded. */
export function createKitPlacer(T, parent, { castShadow = true } = {}) {
  const placements = new Map();
  const dummy = new T.Object3D();
  let attached = false;
  return {
    place(name, position, { rotationY = 0, rotationZ = 0, scale = [1, 1, 1] } = {}) {
      dummy.position.set(...position);
      dummy.rotation.set(0, rotationY, rotationZ);
      dummy.scale.set(...scale);
      dummy.updateMatrix();
      if (!placements.has(name)) placements.set(name, []);
      placements.get(name).push(dummy.matrix.clone());
    },
    /** World matrices recorded for one part (inspection and tests). */
    placements(name) {
      return placements.get(name) ?? [];
    },
    get count() {
      let n = 0;
      for (const list of placements.values()) n += list.length;
      return n;
    },
    /** Resolves to the created InstancedMeshes; safe to call more than once. */
    async attach(materialHook) {
      return this.attachParts(await loadShrineKit(T), materialHook);
    },
    attachParts(parts, materialHook) {
      if (attached) return [];
      attached = true;
      const meshes = [];
      for (const [name, matrices] of placements) {
        const part = parts.get(name);
        if (!part) throw new Error(`Shrine kit is missing ${name}`);
        for (const { geometry, material, local } of part.primitives) {
          const mesh = new T.InstancedMesh(geometry, materialHook ? materialHook(material, name) : material, matrices.length);
          matrices.forEach((m, i) => mesh.setMatrixAt(i, new T.Matrix4().multiplyMatrices(m, local)));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = castShadow;
          mesh.receiveShadow = true;
          mesh.name = `Kit ${name}`;
          parent.add(mesh);
          meshes.push(mesh);
        }
      }
      return meshes;
    },
  };
}

/**
 * Myojin torii from unit parts. Mirrors assemble_torii() in the Blender generator.
 * `span` is the post-centre distance, `height` the post height, `thick` scales sections.
 */
export function placeTorii(placer, x, y, z, span, height, { thick = 1, lean = .04 } = {}) {
  for (const s of [-1, 1]) {
    const px = x + s * span / 2;
    // Posts lean inward (uchikorobi): the right post's head tips toward -X.
    placer.place("ToriiPillar", [px, y, z], { rotationZ: s * lean * .5, scale: [thick, height, thick] });
    placer.place("ToriiKamaki", [px, y, z], { scale: [thick, 1, thick] });
    placer.place("ToriiDaiishi", [px, y, z], { scale: [thick, 1, thick] });
  }
  placer.place("ToriiNuki", [x, y + .8 * height, z], { scale: [span + 1.1, thick, thick] });
  placer.place("ToriiGakuzuka", [x, y + .8 * height + .17 * thick, z], { scale: [thick, .17 * height - .3 * thick, thick] });
  placer.place("ToriiPlaque", [x, y + .885 * height, z + .12 * thick], { scale: [thick, thick, thick] });
  placer.place("ToriiShimaki", [x, y + .97 * height, z], { scale: [span + 1.5, thick, thick] });
  placer.place("ToriiKasagi", [x, y + .97 * height + .32 * thick, z], { scale: [span + 2.4, thick, thick] });
}

/** A paper chochin: soft lathe silhouette for lanterns hung on the Storm gates. */
export function chochinGeometry(T, radius = .2, height = .42) {
  const points = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    points.push(new T.Vector2(Math.max(.035, Math.sin(Math.PI * t) * radius), (t - .5) * height));
  }
  return new T.LatheGeometry(points, 24);
}
