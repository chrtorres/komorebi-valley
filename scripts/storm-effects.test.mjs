import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFile } from "node:fs/promises";
import { createStormEffects } from "../src/storm-effects.js";
function fixture() {
  const scene = new T.Scene(),
    player = new T.Group();
  scene.add(player);
  const arm = new T.Group();
  arm.name = "RightArm";
  player.add(arm);
  const left = new T.Group();
  left.name = "LeftArm";
  player.add(left);
  return {
    scene,
    player,
    arm,
    left,
    view: createStormEffects(T, scene, player),
  };
}
const active = { active: true, weapon: "kunai", effects: [] };
test("real authored GLB replacing player children reclaims costume and both weapons; restores hat", async () => {
  const f = fixture();
  f.view.update(active, 0.016);
  const bytes = await readFile(
    new URL("../src/assets/pilgrim.glb", import.meta.url),
  );
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  f.player.clear();
  f.player.add(gltf.scene);
  f.view.update(active, 0.016);
  assert.equal(f.player.getObjectByName("StormCampaignCloth").parent, f.player);
  const right = gltf.scene.getObjectByName("RightArm"),
    left = gltf.scene.getObjectByName("LeftArm");
  assert.equal(right.getObjectByName("StormWeaponAttachment").parent, right);
  assert.equal(left.getObjectByName("StormOffhandKunai").parent, left);
  const hats = [];
  gltf.scene.traverse((o) => {
    if (/^(straw[ _]hat|hat[ _](cap|chin|radial|woven))/i.test(o.name))
      hats.push(o);
  });
  assert.ok(hats.length > 40);
  assert.ok(hats.every((o) => !o.visible));
  f.view.update({ active: false }, 0.016);
  assert.ok(hats.every((o) => o.visible));
  f.view.dispose();
});
test("fallback hat and legacy visibility restore exactly across activation and disposal", () => {
  const f = fixture(),
    hat = new T.Mesh(new T.ConeGeometry(0.53, 0.19, 32)),
    brim = new T.Mesh(new T.TorusGeometry(0.41, 0.025, 6, 32));
  brim.visible = false;
  const legacy = new T.Group();
  legacy.name = "PilgrimCombatWeapon";
  f.player.add(hat, brim, legacy);
  f.view.update(active, 0.016);
  assert.equal(hat.visible, false);
  assert.equal(legacy.visible, false);
  f.view.update({ active: false }, 0.016);
  assert.equal(hat.visible, true);
  assert.equal(brim.visible, false);
  assert.equal(legacy.visible, true);
  f.view.update(active, 0.016);
  f.view.dispose();
  f.view.dispose();
  assert.equal(hat.visible, true);
  assert.equal(brim.visible, false);
});
test("twin kunai and broad airborne pose preserve arm locomotion; raw timer animates", () => {
  const f = fixture();
  f.arm.rotation.set(0.2, 0.1, 0.3);
  f.left.rotation.set(-0.3, 0.1, 0.2);
  const r = f.arm.quaternion.clone(),
    l = f.left.quaternion.clone();
  f.view.update({ ...active, airborne: true }, 0.016);
  const hand = f.arm.getObjectByName("StormWeaponAttachment"),
    off = f.left.getObjectByName("StormOffhandKunai");
  assert.ok(off.visible);
  assert.ok(hand.rotation.z < -0.8);
  assert.ok(off.rotation.z > 0.8);
  assert.ok(f.arm.quaternion.equals(r));
  assert.ok(f.left.quaternion.equals(l));
  f.view.update(
    {
      ...active,
      attack: {
        action: "airLight",
        phase: "active",
        timer: (0.08 + 0.14 * 0.5) * 0.59,
      },
    },
    0.016,
  );
  assert.ok(Math.abs(hand.rotation.x - 0.1) < 1e-9);
  f.view.update({ ...active, weapon: "katana" }, 0.016);
  assert.equal(off.visible, false);
  f.view.dispose();
  assert.equal(off.parent, null);
});
test("ascension spreads weapon pose, pooled effects expire, boss hazard uses origin", () => {
  const f = fixture(),
    effects = [{ type: "ascend", x: 0, y: 0, z: 0 }];
  const boss = {
    x: 10,
    y: 2,
    z: -65,
    health: 100,
    maxHealth: 210,
    phase: 3,
    mode: "telegraph",
    timer: 0.5,
    origin: { x: 1, y: 0, z: 3 },
  };
  const state = { ...active, effects, boss };
  const before = JSON.stringify(state);
  f.view.update(state, 0.016);
  assert.equal(JSON.stringify(state), before);
  assert.ok(f.arm.getObjectByName("StormWeaponAttachment").rotation.z < -0.8);
  const root = f.scene.getObjectByName("StormEffects"),
    ring = root.children.find((o) => o.geometry?.type === "RingGeometry");
  assert.deepEqual(ring.position.toArray(), [1, 0.05, 3]);
  assert.equal(ring.scale.x, 6.45);
  f.view.update(state, 0.016);
  assert.equal(
    root.children.filter((o) => o.name.startsWith("StormBurst_") && o.visible)
      .length,
    1,
  );
  for (let i = 0; i < 10; i++) f.view.update({ ...active, effects: [] }, 0.1);
  assert.equal(
    root.children.filter((o) => o.name.startsWith("StormBurst_") && o.visible)
      .length,
    0,
  );
  f.view.dispose();
});
test("reference helices use two static shader ribbons; airborne uniforms advance and cloth tails flutter", () => {
  const f = fixture();
  f.view.update({ ...active, hover: true }, 0.05);
  const helices = f.player.getObjectByName("StormCyanHelices");
  assert.equal(helices.visible, true);
  assert.equal(helices.children.length, 2);
  const ribbon = helices.children[0],
    buffer = ribbon.geometry.attributes.position.array,
    mat = ribbon.material;
  assert.equal(mat.isShaderMaterial, true);
  assert.equal(mat.depthWrite, false);
  assert.equal(mat.blending, T.AdditiveBlending);
  assert.equal(ribbon.geometry.attributes.position.count, 322);
  assert.equal(ribbon.geometry.index.count, 960);
  const time = mat.uniforms.time.value,
    tail = f.player.getObjectByName("StormRobeTail_0"),
    angle = tail.rotation.x;
  f.view.update({ ...active, hover: true }, 0.05);
  assert.ok(mat.uniforms.time.value > time);
  assert.equal(ribbon.geometry.attributes.position.array, buffer);
  assert.notEqual(tail.rotation.x, angle);
  f.view.update({ ...active, hover: false, airborne: false }, 0.016);
  assert.equal(helices.visible, false);
  f.view.dispose();
});
test("travel gear and wardrobe restore; shared source material remains unchanged and clone disposed", () => {
  const f = fixture(),
    original = new T.MeshStandardMaterial({ color: 0x456655 });
  original.name = "robe";
  const robe = new T.Mesh(new T.BoxGeometry(), original),
    outside = new T.Mesh(new T.BoxGeometry(), original);
  const pack = new T.Group();
  pack.name = "Backpack";
  const strap = new T.Group();
  strap.name = "Shoulder_strap";
  strap.visible = false;
  f.player.add(robe, pack, strap);
  f.scene.add(outside);
  const originalColor = original.color.clone();
  f.view.update(active, 0.016);
  const clone = robe.material;
  assert.notEqual(clone, original);
  assert.equal(outside.material, original);
  assert.ok(original.color.equals(originalColor));
  assert.equal(pack.visible, false);
  f.view.update({ active: false }, 0.016);
  assert.equal(robe.material, original);
  assert.equal(pack.visible, true);
  assert.equal(strap.visible, false);
  f.view.update(active, 0.016);
  assert.equal(robe.material, clone);
  let disposed = false;
  clone.addEventListener("dispose", () => (disposed = true));
  f.view.dispose();
  assert.equal(robe.material, original);
  assert.equal(disposed, true);
  original.dispose();
  robe.geometry.dispose();
  outside.geometry.dispose();
});
