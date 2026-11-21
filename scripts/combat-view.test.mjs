import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createCombatView } from '../src/combat-view.js';
import { ATTACKS } from '../src/combat-core.js';

// No WebGL or browser: exercise the actual scene graph; health canvas is unused.
function fixture() {
  const scene = new T.Scene(), player = new T.Group(), arm = new T.Group();
  arm.name = 'RightArm'; arm.rotation.set(.2, -.1, .3); player.add(arm); scene.add(player);
  const view = createCombatView(T, scene, player);
  const update = pose => view.update({ player: pose, enemies: [] }, 1 / 60);
  update({});
  return {scene, player, arm, view, update, blade: arm.getObjectByName('PilgrimSwordSwing')};
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('airLight swing and trail align with core active window', () => {
  const f = fixture(), spec = ATTACKS.airLight;
  try {
    for (const progress of [0, .05, .5, .95, 1]) {
      f.update({action:'airLight',phase:'active',combo:['light'],timer:spec.startup + spec.active * progress});
      close(f.blade.rotation.x, -1.1 + progress * 2.4);
      const trail = f.blade.children.find(o => o.material.transparent);
      assert.equal(trail.visible, progress > .1 && progress < .9);
    }
    f.update({action:'airLight',phase:'recover',timer:spec.startup + spec.active + spec.recovery});
    assert.equal(f.blade.children.find(o=>o.material.transparent).visible, false);
  } finally { f.view.dispose() }
});

test('guard raises blade across chest without changing locomotion and clears on release', () => {
  const f = fixture(), armPose = f.arm.quaternion.clone();
  try {
    const idleTip = new T.Vector3(0,.9,0).applyMatrix4((f.blade.updateMatrix(), f.blade.matrix));
    f.update({action:'idle',phase:'idle',guarding:true});
    f.blade.updateMatrix();
    const guardTip = new T.Vector3(0,.9,0).applyMatrix4(f.blade.matrix);
    assert.ok(guardTip.y > idleTip.y); assert.ok(guardTip.x < idleTip.x);
    assert.ok(f.arm.quaternion.equals(armPose));
    assert.equal(f.blade.children.find(o=>o.material.transparent).visible,false);
    f.update({action:'idle',phase:'idle',guarding:false});
    assert.deepEqual(f.blade.position.toArray(),[0,0,0]); close(f.blade.rotation.x,-.35);
  } finally { f.view.dispose() }
});

test('charging action and start/startup phase aliases display windup on private pivot', () => {
  const f = fixture(), armPose = f.arm.quaternion.clone();
  try {
    for (const pose of [{action:'charging',phase:'idle'},{action:'charging',phase:'charging'},
      {action:'airLight',phase:'start'},{action:'airLight',phase:'startup'}]) {
      const raw=JSON.stringify(pose);f.update(pose);close(f.blade.rotation.x,-1.1);
      assert.ok(f.arm.quaternion.equals(armPose));assert.equal(JSON.stringify(pose),raw);
    }
  } finally { f.view.dispose() }
});

test('late fallback/GLB arm attaches and disposal removes owned weapon', () => {
  const scene=new T.Scene(),player=new T.Group(),view=createCombatView(T,scene,player);
  view.update({},.016);const fallback=new T.Group();fallback.name='RightArm';player.add(fallback);
  view.update({player:{guarding:true}},.016);assert.ok(fallback.getObjectByName('PilgrimCombatWeapon'));
  player.remove(fallback);const glb=new T.Group();glb.name='RightArm';player.add(glb);
  view.update({},.016);assert.equal(fallback.children.length,0);assert.ok(glb.getObjectByName('PilgrimCombatWeapon'));
  view.dispose();view.dispose();assert.equal(glb.children.length,0);assert.equal(scene.getObjectByName('CombatVisuals'),undefined);
});
