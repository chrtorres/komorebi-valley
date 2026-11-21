import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { enhanceAtmosphere } from "../src/valley-atmosphere.js";

// Optional module URL lets an isolated worktree reuse installed dependencies.
const T = await import(process.env.THREE_MODULE_URL || "three");
const digest = (texture) =>
  createHash("sha256").update(texture.image.data).digest("hex");
function fixture() {
  const scene = new T.Scene();
  const sun = new T.DirectionalLight("#ffdda2", 3.3);
  sun.position.set(-35, 55, -42);
  scene.add(sun);
  scene.fog = new T.FogExp2("#abcabc", 0.008);
  const geometry = new T.PlaneGeometry(240, 240, 2, 2);
  geometry.setAttribute(
    "color",
    new T.Float32BufferAttribute(
      new Float32Array(geometry.attributes.position.count * 3).fill(0.7),
      3,
    ),
  );
  const terrain = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({ vertexColors: true }),
  );
  const unrelated = new T.Mesh(
    new T.PlaneGeometry(10, 10),
    new T.MeshStandardMaterial(),
  );
  const rock = new T.Mesh(
    new T.BoxGeometry(),
    new T.MeshStandardMaterial({ vertexColors: true }),
  );
  scene.add(terrain, unrelated, rock);
  return { scene, terrain, unrelated, rock, world: { height: () => 0 } };
}

test("procedural terrain color, normal and roughness textures are deterministic", () => {
  const a = fixture(),
    b = fixture();
  enhanceAtmosphere(T, a.scene, a.world);
  enhanceAtmosphere(T, b.scene, b.world);
  for (const [left, right] of [
    [a.terrain.material.map, b.terrain.material.map],
    [a.terrain.material.normalMap, b.terrain.material.normalMap],
    [a.terrain.material.roughnessMap, b.terrain.material.roughnessMap],
  ]) {
    assert(left.isDataTexture);
    assert.equal(digest(left), digest(right));
    assert.equal(left.image.data.length, 256 * 256 * 4);
  }
});

test("terrain detail preserves unrelated materials and geometry", () => {
  const f = fixture();
  const unrelated = f.unrelated.material,
    rock = f.rock.material;
  const terrainGeometry = f.terrain.geometry;
  enhanceAtmosphere(T, f.scene, f.world);
  assert(f.terrain.material.map.isDataTexture);
  assert.equal(f.unrelated.material, unrelated);
  assert.equal(f.rock.material, rock);
  assert.equal(f.terrain.geometry, terrainGeometry);

});

test("repeated enhancement returns the same API and exactly one sky", () => {
  const f = fixture();
  const api = enhanceAtmosphere(T, f.scene, f.world),
    count = f.scene.children.length;
  assert.equal(enhanceAtmosphere(T, f.scene, f.world), api);
  assert.equal(f.scene.children.length, count);
  const skies = f.scene.children.filter(
    (object) => object.name === "Valley atmosphere sky",
  );
  assert.equal(skies.length, 1);
  assert.equal(skies[0].castShadow, false);
  assert.equal(skies[0].material.side, T.BackSide);
  assert.equal(skies[0].geometry.index.count / 3, 960);
});

test("sky uniforms contain finite components", () => {
  const f = fixture();
  enhanceAtmosphere(T, f.scene, f.world);
  const sky = f.scene.getObjectByName("Valley atmosphere sky");
  for (const { value } of Object.values(sky.material.uniforms)) {
    const components = value.isColor
      ? [value.r, value.g, value.b]
      : value.isVector3
        ? value.toArray()
        : [value];
    assert(components.every(Number.isFinite));
  }
});

test("missing world height contract is rejected", () => {
  assert.throws(() => enhanceAtmosphere(T, new T.Scene(), {}), TypeError);
});
