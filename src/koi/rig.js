import * as THREE from "three";

const UP = new THREE.Vector3(0,1,0);
const SIDE = new THREE.Vector3(0,0,1);
const LONG = new THREE.Vector3(1,0,0);
const tau = Math.PI * 2;
const interval = 24 / 34;

export function connectRig(gltf, cranial) {
  const carrier = new THREE.Group();
  const model = gltf.scene;
  const root = model.getObjectByName("SwimRoot");
  if (!root) throw new Error("The GLB is missing SwimRoot.");
  root.position.set(0,0,0);
  carrier.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const ramp = (clipName, name, keep) => {
    const clip = gltf.animations.find((item) => item.name === clipName);
    if (!clip) throw new Error(`The GLB is missing ${clipName}.`);
    const tracks = clip.tracks.filter(({name}) => !name.startsWith("SwimRoot.") && keep(name));
    const action = mixer.clipAction(new THREE.AnimationClip(name,clip.duration,tracks));
    action.setLoop(THREE.LoopOnce,1).play();
    action.paused = true;
    return action;
  };
  const joints=new Map(root.children.map((bone)=>[bone.name,bone]));
  const bindings=Object.entries(cranial.bones).map(([name, rule])=>{
    const bone=joints.get(name), axial=joints.get(rule.axial);
    const profile=cranial.profiles[rule.profile];
    if(!bone || !axial || !profile) throw new Error(`Unavailable cranial binding ${name}`);
    const pivot=new THREE.Vector3().fromArray(rule.pivot);
    const rest=new THREE.Vector3().fromArray(rule.rest);
    const axis=new THREE.Vector3().fromArray(profile.axis);
    return {bone, axial, axis, profile, dial:rule.direction, lever:rest.clone().sub(pivot)};
  });
  const isBody=(track)=>!Object.hasOwn(cranial.bones,track.split(".")[0]);
  const cruise = ramp("Cruise","Body and fins",isBody);
  const left = ramp("Left turns","Left bend",isBody);
  const right = ramp("Right turns","Right bend",isBody);
  const jointTurn=new THREE.Quaternion(), jointOffset=new THREE.Vector3();
  const surface = new Set();
  const attenuation = {value:0};
  model.traverse((node) => {
    if (node.isSkinnedMesh) node.frustumCulled = false;
    if (node.isMesh) for (const mat of [node.material].flat()) surface.add(mat);
  });
  for (const material of surface) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.pondDepth = attenuation;
      shader.fragmentShader = "uniform float pondDepth;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        diffuseColor.rgb *= exp(-vec3(.33,.105,.067)*pondDepth);
        diffuseColor.rgb += vec3(.006,.015,.013)*min(pondDepth,1.);
      `);
    };
  }
  const yaw = new THREE.Quaternion(), pitch = new THREE.Quaternion(), roll = new THREE.Quaternion();
  return {
    object:carrier,
    update(state) {
      const maneuver=Math.min(.97,.90*state.turn+.74*state.recoil);
      cruise.time=((state.phase/tau)%2)*interval;
      cruise.setEffectiveWeight(Math.min(1,state.effort*.94)*(1-maneuver));
      const turnTime = THREE.MathUtils.lerp(2.69,3.49,state.recoil/Math.max(.0001,state.turn+state.recoil));
      for (const [sign,action] of [[1,left],[-1,right]]) {
        action.time=turnTime;
        action.setEffectiveWeight(state.sign === sign ? maneuver : 0);
      }
      // Retain the imported joint rest axes and apply the simulated orientation to its parent.
      mixer.update(0);
      // Each cranial joint inherits the axial station *already evaluated for this stroke*.
      // In this rig the child bone axes and hinge landmarks share the SwimRoot local frame.
      for(const {bone,axial,axis,profile,dial,lever} of bindings){
        const progress=THREE.MathUtils.euclideanModulo(state.ventilation/tau-profile.start,1)
          /(profile.end-profile.start);
        const pulse=Math.sin(Math.PI*Math.min(1,progress))**2;
        const angle=dial*(profile.peak+profile.forage*state.mouthForage)*pulse;
        jointTurn.setFromAxisAngle(axis,angle);
        jointOffset.copy(lever).applyQuaternion(jointTurn).sub(lever).applyQuaternion(axial.quaternion);
        bone.position.copy(axial.position).add(jointOffset);
        bone.quaternion.copy(axial.quaternion).multiply(jointTurn);
      }
      carrier.position.set(state.x,state.y,state.z);
      carrier.quaternion.copy(yaw.setFromAxisAngle(UP,state.heading))
        .multiply(pitch.setFromAxisAngle(SIDE,-state.pitch))
        .multiply(roll.setFromAxisAngle(LONG,state.roll));
      attenuation.value=state.depth;
      carrier.updateMatrixWorld(true);
    },
    readRig() {
      return root.children.filter((node)=>node.isBone).map((bone)=>[
        bone.name, ...bone.position.toArray(), ...bone.quaternion.toArray(),
      ]);
    },
    rigTip:joints.get("Axial_30"),
    headCenter:joints.get("Axial_03"),
  };
}
