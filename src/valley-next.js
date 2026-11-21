import * as T from "three";
import {
  findVault, movePastVaultBarriers, vaultBarrierFloor, vaultPose, vaultSavePosition, VAULT_SECONDS,
} from "./vault.js";
import { connectWarrior } from "./warrior-motion.js";
import { createRoninScarf } from "./ronin-scarf.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createWorld } from "./valley-world.js";
import { enhanceAtmosphere } from "./valley-atmosphere.js";
import { createCombatRuntime } from "./combat-runtime.js";
import { createStormRuntime } from "./storm-runtime.js";
import { createValleyRender, GRAPHICS_TIERS } from "./valley-render.js";
import { createPolish } from "./aaa-polish.js";
import { BODY, dragFactor, landingRetention, pushOff, steerFacing, stepLocomotion } from "./locomotion-physics.js";
import { createFreeRunCourse } from "./free-run-course.js";
import { createMission } from "./mission.js";
import { PARKOUR, findKick, findMantle, findWallRun, mantlePose, mantleSeconds, resolveBody, stillOnWall, surfaceHeight, topAt } from "./parkour.js";
import { createInterface } from "./aaa-interface.js";
import "./aaa.css";
import { orbitLookAngle, orbitPitch, placeOrbitCamera } from "./camera-orbit.js";
import {
  readJourney,
  writeJourney,
  deadzone,
  connectedGamepad,
  frameDelta,
} from "./journey.js";
import "./valley.css";
import "./valley-polish.css";

const root = document.querySelector("#app");
root.innerHTML = `<header><small>木漏れ日 · KOMOREBI</small><h1>The Veiled Pass</h1><p>Something woke beyond the cedars.</p></header><aside><small>THE WATCHKEEPER’S JOURNAL</small><h2>The lights went out</h2><p>Seven signal lanterns went dark in one night.<br>Relight them and find what crossed the pass.</p><strong id="progress"></strong></aside><div id="notice" role="status"></div><div id="prompt"></div><footer><span id="controller">Keyboard ready · connect Xbox controller</span><p>WASD / LS · travel &nbsp; Drag / RS / ↑↓ · look &nbsp; Shift / RT · run<br>Space / A · jump, sprint to leap, hold to glide &nbsp; E / X · restore &nbsp; C / Y · contemplate</p><button id="save">Save journey</button><button id="quality">Graphics: balanced</button><button id="sound">Sound: off</button><span id="saved"></span></footer>`;
const $ = (s) => document.querySelector(s),
  scene = new T.Scene();
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionPreference.matches;
motionPreference.addEventListener("change", (e) => {
  reducedMotion = e.matches;
});
const renderer = new T.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
root.prepend(renderer.domElement);
const camera = new T.PerspectiveCamera(54, innerWidth / innerHeight, 0.15, 700),
  world = createWorld(T, scene),
  { height, lanterns, vaultBarriers, watchMarker } = world;
enhanceAtmosphere(T, scene, world);
// Authored shrine kit (torii, lanterns, halls) streams in behind the title card.
world.kit.attach().catch((error) => console.warn("Shrine kit unavailable:", error.message));
const presentation = createValleyRender(renderer, scene, camera);
const player = new T.Group();
scene.add(player);
const scarf = createRoninScarf(T, scene, player);
function part(geometry, color, x, y, z, parent = player) {
  const m = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({ color, roughness: 0.88 }),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
part(new T.CylinderGeometry(0.24, 0.39, 0.88, 16), "#466265", 0, 0.99, 0);
part(new T.SphereGeometry(0.22, 16, 12), "#c99c72", 0, 1.62, 0);
part(new T.ConeGeometry(0.53, 0.19, 32), "#ad8c52", 0, 1.89, 0);
part(
  new T.TorusGeometry(0.41, 0.025, 6, 32),
  "#755b36",
  0,
  1.83,
  0,
).rotation.x = Math.PI / 2;
part(new T.BoxGeometry(0.42, 0.1, 0.38), "#af663f", 0, 1.43, 0);
part(new T.BoxGeometry(0.4, 0.48, 0.23), "#79644c", 0, 1.12, -0.31);
const limbs = [];
for (const side of [-1, 1]) {
  const leg = new T.Group();
  leg.position.set(side * 0.15, 0.67, 0);
  player.add(leg);
  part(
    new T.CylinderGeometry(0.09, 0.07, 0.55, 10),
    "#303f40",
    0,
    -0.27,
    0,
    leg,
  );
  part(new T.BoxGeometry(0.16, 0.1, 0.3), "#8a7356", 0, -0.55, 0.07, leg);
  limbs.push(leg);
  const arm = new T.Group();
  arm.name = side > 0 ? "RightArm" : "LeftArm";
  arm.position.set(side * 0.32, 1.29, 0);
  player.add(arm);
  part(
    new T.CylinderGeometry(0.12, 0.08, 0.57, 10),
    "#466265",
    side * 0.04,
    -0.24,
    0,
    arm,
  );
  limbs.push(arm);
}
let animateWarrior;
const loader = new GLTFLoader();
function mountCharacter(gltf, animate) {
  player.clear();
  player.add(gltf.scene);
  animateWarrior = animate;
  limbs.length = 0;
  if (!animate) {
    for (const name of ["LeftLeg", "LeftArm", "RightLeg", "RightArm"]) {
      const limb = gltf.scene.getObjectByName(name);
      if (limb) limbs.push(limb);
    }
  }
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

async function loadCharacter() {
  try {
    const warrior = await loader.loadAsync(new URL("./assets/warrior.glb", import.meta.url).href);
    mountCharacter(warrior, connectWarrior(warrior.scene));
  } catch {
    try {
      const pilgrim = await loader.loadAsync(new URL("./assets/pilgrim.glb", import.meta.url).href);
      mountCharacter(pilgrim);
    } catch {
      console.warn("Character assets unavailable; using procedural traveler.");
    }
  }
}
void loadCharacter();
let storage;
try {
  storage = localStorage;
} catch {
  storage = {
    getItem: () => null,
    setItem: () => {
      throw Error("Storage denied");
    },
  };
}
const initial = readJourney(storage, {
  position: world.spawn || [5, height(5, 16), 16],
  lit: [],
  yaw: 0,
});
const [savedX, savedY, savedZ] = initial.position;
player.position.fromArray(vaultSavePosition(
  { x: savedX, y: savedY, z: savedZ }, height, vaultBarriers, true,
));
player.rotation.y = initial.yaw + Math.PI;
let restored = initial.lit,
  yaw = initial.yaw,
  pitch = orbitPitch(initial.pitch),
  vy = 0,
  grounded = true,
  saveError = false,
  contemplating = false,
  elapsed = 0,
  last = performance.now(),
  previous = [],
  frames = 0,
  ascentCamera = 0,
  orbitDistance = 6.6,
  landingDip = 0;
// Horizontal body velocity (m/s); input accelerates it instead of setting it.
const bodyVelocity = { x: 0, z: 0 };
const requestedQuality = new URLSearchParams(location.search).get("quality");
let quality = GRAPHICS_TIERS.includes(requestedQuality) ? requestedQuality : "balanced";
const litMaterial = new T.MeshStandardMaterial({
  color: "#ffe1a1",
  emissive: "#ffc46a",
  emissiveIntensity: 2.5,
});
function refresh() {
  lanterns.forEach((l, i) => {
    if (restored.includes(i)) {
      l.lamp.material = litMaterial;
      if (l.light) l.light.intensity = 2;
    }
  });
  $("#progress").textContent = `${restored.length} / 7 lanterns restored`;
}
function save() {
  const existing = readJourney(storage, { lit: [] });
  restored = [...new Set([...existing.lit, ...restored])];
  // A save taken mid-vault resumes on the launch side, where there is ground.
  const checkpoint = vault ? { x: vault.x, y: vault.fromY, z: vault.fromZ } : player.position;
  const position = vaultSavePosition(checkpoint, height, vaultBarriers, grounded && !vault);
  saveError = !writeJourney(storage, { position, lit: restored, yaw, pitch });
  if (!combatRuntime.save()) saveError = true;
  if (storm.active && !storm.save()) saveError = true;
  refresh();
  $("#saved").textContent = saveError
    ? "Storage unavailable · progress cannot be saved"
    : "Journey saved";
  return !saveError;
}
let noticeUntil = 0;
function notice(text) {
  $("#notice").textContent = text;
  noticeUntil = elapsed + 5;
}
function nearWatchMarker() {
  return Math.hypot(player.position.x - watchMarker.x, player.position.z - watchMarker.z) < 2.1 &&
    Math.abs(player.position.y - height(watchMarker.x, watchMarker.z)) < 1.5;
}
function interact() {
  if (storm.active) {
    storm.interact();
    return;
  }
  if (!combatRuntime.alive || vault) return;
  if (mission.interact(player, grounded)) return;
  if (nearWatchMarker()) {
    const begun = mission.offer();
    notice("Watch marker · The tracks turn toward the cedar court. Someone followed them after the signals went dark." +
      (begun ? " The ridge beacon has gone dark — follow the light west." : ""));
    return;
  }
  const i = lanterns.findIndex(
    (l) => Math.hypot(l.x - player.position.x, l.z - player.position.z) < 3,
  );
  if (i < 0) {
    notice("Approach a stone lantern to restore its light.");
    return;
  }
  if (restored.includes(i)) {
    notice("This signal is already burning.");
    return;
  }
  restored.push(i);
  refresh();
  save();
  notice(
    restored.length === 7
      ? "All seven signals burn. The watch can see the pass again."
      : "Signal lit. Something moves farther up the pass.",
  );
  chime();
}
function contemplate() {
  contemplating = !contemplating;
  notice(
    contemplating
      ? "Breathe. There is nowhere else you need to be."
      : "The path is waiting.",
  );
}
refresh();
$("#save").onclick = save;
const keys = new Set();
let jumpRequested = false;
let padJumpNeedsRelease = false;
let vault = null;
let leapDirection = null;
let leapRecovery = 0;
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "AltLeft", "AltRight"].includes(e.code))
    e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (storm.active) storm.keyDown(e.code);
  else combatRuntime.keyDown(e.code);
  if (e.code === "KeyE") interact();
  if (e.code === "Space" && !storm.active && (grounded || wallRun) && combatRuntime.alive)
    jumpRequested = true;
  if (e.code === "KeyC") contemplate();
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  combatRuntime.keyUp(e.code);
  storm.keyUp(e.code);
});
addEventListener("blur", () => {
  keys.clear();
  jumpRequested = false;
  combatRuntime.resetInputs();
  storm.resetInputs();
  drag = null;
});
let drag = null;
const canvas = renderer.domElement;
canvas.style.touchAction = "none";
canvas.addEventListener("pointerdown", (event) => {
  if (drag || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
function endDrag(event) {
  if (drag?.id === event.pointerId) drag = null;
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("lostpointercapture", endDrag);
canvas.addEventListener("pointermove", (event) => {
  if (drag?.id !== event.pointerId) return;
  yaw -= (event.clientX - drag.x) * .005;
  lastLook = elapsed;
  pitch = orbitPitch(pitch + (event.clientY - drag.y) * .006);
  drag.x = event.clientX;
  drag.y = event.clientY;
});
// Sound stays opt-in because browser audio needs an explicit user gesture.
let audio,
  sound = false;
function chime() {
  if (!sound || !audio) return;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.frequency.value = 440 + restored.length * 55;
  g.gain.setValueAtTime(0.06, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 2.5);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 2.5);
}
$("#sound").onclick = () => {
  sound = !sound;
  if (sound && !audio) {
    audio = new AudioContext();
    const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 4,
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    let n = 0;
    for (let i = 0; i < data.length; i++) {
      n = (n + Math.random() * 0.04 - 0.02) * 0.99;
      data[i] = n;
    }
    const ambient = audio.createBufferSource();
    ambient.buffer = buffer;
    ambient.loop = true;
    const g = audio.createGain();
    g.gain.value = 0.2;
    ambient.connect(g).connect(audio.destination);
    ambient.start();
  }
  if (audio) {
    if (sound) audio.resume();
    else audio.suspend();
  }
  $("#sound").textContent = `Sound: ${sound ? "on" : "off"}`;
};
function resizePresentation() {
  presentation.resize(innerWidth, innerHeight, devicePixelRatio, quality);
  const { width, height } = presentation.resolution;
  const button = $("#quality");
  button.textContent = `Graphics: ${quality === "ultra-4k" ? "Ultra 4K" : quality}`;
  button.title = `Rendering at ${width} × ${height}`;
}
$("#quality").onclick = () => {
  quality = GRAPHICS_TIERS[(GRAPHICS_TIERS.indexOf(quality) + 1) % GRAPHICS_TIERS.length];
  resizePresentation();
};
resizePresentation();
const windZones = [
    { x: 10, z: -20, radius: 8 },
    { x: -28, z: -50, radius: 7 }, // matches the second current in valley-world.js
  ],
  target = new T.Vector3();
let resetWarriorMotion = false;
const combatRuntime = createCombatRuntime(
  T,
  scene,
  player,
  height,
  storage,
  notice,
  () => {
    resetWarriorMotion = true;
    vy = 0;
    vault = null;
    leapDirection = null;
    leapRecovery = 0;
    grounded = true;
    contemplating = false;
    keys.clear();
  },
);
const storm = createStormRuntime(
  T,
  scene,
  player,
  height,
  storage,
  notice,
  (position) => {
    resetWarriorMotion = true;
    player.position.set(position.x, height(position.x, position.z), position.z);
    player.rotation.y = Math.PI;
    bodyVelocity.x = bodyVelocity.z = bodyVelocity.ax = bodyVelocity.az = 0;
    vault = null;
    leapDirection = null;
    leapRecovery = 0;
    vy = 0;
    grounded = true;
    yaw = 0;
    contemplating = false;
    save();
  },
  () => sound,
);
const stormCameraObstacles = [...world.cameraObstacles, ...storm.cameraObstacles];
const polish = createPolish(T, { scene, camera, world, root });
const hud = createInterface({ root });
// Free-running course and the Ridge Signal mission (Veiled Pass only).
const freeRun = createFreeRunCourse(T, scene, world);
const mission = createMission({ T, root, camera, storage, course: freeRun, combat: combatRuntime, notice });
mission.attachScene(scene);
// Parkour state: an active wall-run or pull-up, and once-per-airtime moves.
let freeFacing = null, wallRun = null, leftWall = null, mantle = null, kickUsed = false, wallRunsThisAir = 0, wallLean = 0, bankLean = 0, lastTravelHeading = null;
// The orbit camera treats roofs and course tops as ground, so it never slips beneath a roof.
const cameraFloor = (x, z) => Math.max(height(x, z), topAt(freeRun.course, x, z));
// Manual look input pauses the camera's lazy follow behind the direction of travel.
let lastLook = -Infinity;
function frame(now) {
  requestAnimationFrame(frame);
  // Hit-stop briefly slows simulation time; the real frame delta still drives presentation.
  const realDt = frameDelta(now, last);
  const dt = realDt * polish.timeScale;
  last = now;
  // Inactive tabs retain progress without advancing enemy AI or consuming GPU work.
  if (document.hidden) return;
  elapsed += dt;
  let pad = connectedGamepad(navigator);
  if (pad && padJumpNeedsRelease) {
    if (pad.buttons[0]?.pressed) {
      const buttons = Array.from(pad.buttons);
      buttons[0] = { pressed: false, touched: false, value: 0 };
      pad = { axes: pad.axes, buttons };
    } else padJumpNeedsRelease = false;
  }
  const verticalLook = Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
  pitch = orbitPitch(pitch + (verticalLook + deadzone(pad?.axes?.[3])) * dt * 1.75);
  let mx = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    mz = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
  // Standard Xbox button edges prevent a held X from activating repeatedly.
  if (pad) {
    if (!storm.active && pad.buttons[9]?.pressed && !previous[9]) hud.transition(() => storm.enter(), "storm");
    mx += deadzone(pad.axes[0]);
    mz += deadzone(pad.axes[1]);
    yaw -= deadzone(pad.axes[2]) * dt * 2;
    if (deadzone(pad.axes[2]) || deadzone(pad.axes[3])) lastLook = elapsed;
    if (pad.buttons[0]?.pressed && !previous[0] && !storm.active)
      jumpRequested = true;
    if (!storm.active && pad.buttons[2]?.pressed && !previous[2]) interact();
    if (!storm.active && pad.buttons[3]?.pressed && !previous[3]) contemplate();
    previous = pad.buttons.map((b) => b.pressed);
    $("#controller").textContent =
      "Xbox connected · A jump · X restore · Y contemplate";
  } else {
    // A reconnect may report A already held. Wait for a release before accepting a jump edge.
    if (previous.length) padJumpNeedsRelease = true;
    // Losing the controller is a loss of intent: shed carried momentum rather than drift on.
    if (previous.length) bodyVelocity.x = bodyVelocity.z = bodyVelocity.ax = bodyVelocity.az = 0;
    previous = [];
    $("#controller").textContent = "Keyboard ready · connect Xbox controller";
  }
  if (mx || mz) contemplating = false;
  const speed =
      keys.has("ShiftLeft") ||
      keys.has("ShiftRight") ||
      pad?.buttons[7]?.pressed
        ? BODY.sprint
        : BODY.run,
    len = Math.max(1, Math.hypot(mx, mz)),
    dx = (mx * Math.cos(yaw) + mz * Math.sin(yaw)) / len,
    dz = (-mx * Math.sin(yaw) + mz * Math.cos(yaw)) / len;
  const duel = combatRuntime.state;
  // Read latched edges once. A press may still be queued between fixed combat ticks.
  const duelInput = storm.active ? null : combatRuntime.readInput(keys, pad);
  const combatIntent = duelInput && (duelInput.light || duelInput.heavy || duelInput.heavyHeld ||
    duelInput.heavyRelease || duelInput.guard || duelInput.dodge || duelInput.lock ||
    combatRuntime.core.hasPendingAction);
  const mayVault = !storm.active && grounded && duel.player.health > 0 &&
    duel.player.action === "idle" && !duel.player.guarding && !duel.targetId && !combatIntent;
  if (jumpRequested && wallRun && !storm.active) {
    // Wall-jump: keep the run's momentum and kick away from the face.
    const along = Math.max(5, Math.hypot(bodyVelocity.x, bodyVelocity.z));
    bodyVelocity.x = wallRun.tx * along * .8 + wallRun.nx * PARKOUR.jumpAway;
    bodyVelocity.z = wallRun.tz * along * .8 + wallRun.nz * PARKOUR.jumpAway;
    vy = PARKOUR.jumpUp;
    // The feet just pushed off this face: it cannot catch the body again this jump.
    leftWall = wallRun.solid;
    wallRun = null;
    kickUsed = false;
    jumpRequested = false;
  }
  if (jumpRequested && !storm.active && grounded && combatRuntime.alive) {
    if (mayVault) vault = findVault(player.position, dx, dz, vaultBarriers, height);
    const magnitude = Math.hypot(dx, dz);
    leapDirection = speed === BODY.sprint && magnitude > .6
      ? { x: dx / magnitude, z: dz / magnitude }
      : null;
    leapRecovery = 0;
    // Keep the ordinary jump impulse until combat has accepted the vault.
    vy = leapDirection ? BODY.leap : BODY.jump;
    if (!vault) pushOff(bodyVelocity, dx, dz, speed);
    grounded = false;
    contemplating = false;
  }
  jumpRequested = false;
  const vaultHeading = vault && !combatIntent ? Math.sign(vault.toZ - vault.fromZ) : null;
  // Free running faces the way the body travels, so turns curve instead of side-slipping.
  const carried = Math.hypot(bodyVelocity.x, bodyVelocity.z);
  const freeStance = storm.active
    ? !storm.state.combat?.targetId && !storm.state.combat?.player?.guarding
    : duel.player.action === "idle" && !duel.player.guarding && !duel.targetId;
  // Facing turns toward travel (or the stick when nearly still) at a planted-pivot rate,
  // so reversals and slow cuts rotate the body instead of snapping it. Combat input keeps
  // aiming at the stick, so a swing never captures a half-turned facing.
  const steering = freeStance && !combatIntent && vaultHeading === null && !wallRun && Math.hypot(dx, dz) > .05;
  freeFacing = steering
    ? steerFacing(freeFacing ?? player.rotation.y,
      carried > .8 ? Math.atan2(bodyVelocity.x, bodyVelocity.z) : Math.atan2(dx, dz), dt)
    : null;
  const movement = {
    grounded,
    moveX: vaultHeading === null ? dx : 0,
    moveZ: vaultHeading ?? dz,
    ...(steering ? { faceX: Math.sin(freeFacing), faceZ: Math.cos(freeFacing) } : {}),
  };
  const wasGrounded = grounded;
  const beforeX = player.position.x, beforeZ = player.position.z;
  const combatState = storm.active
    ? storm.step(dt, keys, pad, movement)
    : combatRuntime.step(dt, keys, pad, movement, duelInput);
  if (storm.active || combatState.player.action !== "idle")
    contemplating = false;
  if (combatState.targetId) {
    const behind = player.rotation.y + Math.PI;
    yaw +=
      Math.atan2(Math.sin(behind - yaw), Math.cos(behind - yaw)) *
      Math.min(1, dt * 10);
  }
  const movementScale = storm.active
    ? combatState.movementScale
    : combatState.player.movementScale;
  if (vault && (storm.active || combatState.player.action !== "idle" || combatState.player.guarding ||
      combatState.targetId || combatState.events.some(event => event.type === "playerHit")))
    vault = null;
  if (vault) {
    vault.elapsed += dt;
    vy = 0;
    leapDirection = null;
  }
  let vaultFrame = vault ? vaultPose(vault, vault.elapsed) : null;
  if (vaultFrame) bodyVelocity.x = bodyVelocity.z = bodyVelocity.ax = bodyVelocity.az = 0;
  else stepLocomotion(bodyVelocity, {
    dirX: dx, dirZ: dz, maxSpeed: speed * movementScale, grounded, dt,
    stance: Boolean(combatState.targetId || (storm.active ? storm.state.combat?.player : combatState.player)?.guarding ||
      ((storm.active ? storm.state.combat?.player : combatState.player)?.action ?? "idle") !== "idle"),
    height: storm.active ? storm.height : height, x: player.position.x, z: player.position.z,
  });
  if (wallRun && !vaultFrame) {
    // Running the wall: momentum is redirected along the face.
    const along = Math.max(6.2, Math.hypot(bodyVelocity.x, bodyVelocity.z));
    bodyVelocity.x = wallRun.tx * along;
    bodyVelocity.z = wallRun.tz * along;
  }
  if (mantle) bodyVelocity.x = bodyVelocity.z = bodyVelocity.ax = bodyVelocity.az = 0;
  const nextX = T.MathUtils.clamp(
    player.position.x + bodyVelocity.x * dt + combatState.motion.dx,
    -70, 70,
  );
  const nextZ = T.MathUtils.clamp(
    player.position.z + bodyVelocity.z * dt + combatState.motion.dz,
    -70, 70,
  );
  const destination = vaultFrame ?? movePastVaultBarriers(player.position, nextX, nextZ, vaultBarriers);
  player.position.x = destination.x;
  player.position.z = destination.z;
  if (!storm.active) {
    const beforePush = { x: player.position.x, y: vaultFrame?.y ?? player.position.y, z: player.position.z };
    combatRuntime.resolveBody();
    if (beforePush.x !== player.position.x || beforePush.z !== player.position.z) {
      if (vaultFrame) {
        player.position.y = vaultFrame.y;
        vaultFrame = null;
        vault = null;
        vy = 0;
      }
      const corrected = movePastVaultBarriers(beforePush, player.position.x, player.position.z, vaultBarriers);
      player.position.x = corrected.x;
      player.position.z = corrected.z;
    }
    if (!vaultFrame && !mantle) {
      // Scenery is solid: slide along walls, posts and lanterns instead of passing through.
      const body = resolveBody(freeRun.course, player.position.x, player.position.z, player.position.y);
      player.position.x = body.x;
      player.position.z = body.z;
    }
  }
  limbs.forEach(
    (l, i) =>
      (l.rotation.x = T.MathUtils.lerp(
        l.rotation.x,
        mx || mz
          ? Math.sin(
              elapsed * speed * 2.6 + (i === 0 || i === 3 ? 0 : Math.PI),
            ) * 0.45
          : 0,
        0.2,
      )),
  );
  const terrain = storm.active
    ? storm.height(player.position.x, player.position.z)
    : height(player.position.x, player.position.z);
  const ground = Math.max(
      vaultBarrierFloor(player.position, terrain, vaultBarriers),
      storm.active ? -Infinity : surfaceHeight(freeRun.course, player.position.x, player.position.z, player.position.y),
    ),
    gliding = (keys.has("Space") || pad?.buttons[0]?.pressed) && vy < 0,
    wind = windZones.some(
      (w) =>
        Math.hypot(w.x - player.position.x, w.z - player.position.z) < w.radius,
    );
  let landed = false;
  const fallSpeed = vy;
  const hasInput = Math.hypot(dx, dz) > .3;
  if (!storm.active && !vaultFrame && combatRuntime.alive) {
    if (mantle) {
      mantle.t += dt / mantle.seconds;
      const p = mantlePose(mantle.from, mantle.to, mantle.t);
      player.position.set(p.x, p.y, p.z);
      vy = 0;
      if (mantle.t >= 1) {
        player.position.y = mantle.to.y;
        mantle = null;
        grounded = true;
      }
    } else if (!grounded) {
      const feet = player.position.y;
      const ledge = hasInput && vy < 4.5 && !wallRun &&
        findMantle(freeRun.course, player.position.x, player.position.z, dx, dz, feet);
      if (ledge) {
        mantle = { from: player.position.clone(), to: ledge, t: 0, seconds: mantleSeconds(ledge.y - feet) };
        wallRun = null;
        leapDirection = null;
        mission.record("mantles");
      } else {
        const kick = !kickUsed && hasInput && findKick(freeRun.course, player.position.x, player.position.z, dx, dz, feet);
        if (kick) {
          vy = Math.max(vy, PARKOUR.kickSpeed);
          kickUsed = true;
        }
        const sprinting = speed === BODY.sprint;
        if (!wallRun && sprinting && hasInput && wallRunsThisAir < 2) {
          const run = findWallRun(freeRun.course, player.position.x, player.position.z, bodyVelocity.x, bodyVelocity.z, feet);
          if (run && run.solid !== leftWall) {
            wallRun = { ...run, t: 0 };
            wallRunsThisAir += 1;
            // The first foot on the wall pushes up; it never takes away the jump's rise.
            vy = Math.max(vy, PARKOUR.runLift);
            mission.record("wallRuns");
          }
        }
        if (wallRun) {
          wallRun.t += dt;
          if (wallRun.t > PARKOUR.runTime || !hasInput ||
              !stillOnWall(wallRun, player.position.x, player.position.z, feet)) wallRun = null;
        }
      }
    }
  }
  if (grounded || storm.active) {
    wallRun = null;
    kickUsed = false;
    wallRunsThisAir = 0;
    leftWall = null;
  }
  if (mantle) {
    // The pull-up owns the body this frame.
  } else if (vaultFrame) {
    player.position.y = vaultFrame.y;
    grounded = landed = vaultFrame.progress === 1;
    if (landed) {
      vault = null;
      vy = 0;
    }
  } else {
    // Thermal lift remains active through upward motion; otherwise velocity oscillates at the apex.
    const catchingWind =
      wind &&
      !grounded &&
      player.position.y <= ground + 30 &&
      (keys.has("Space") || pad?.buttons[0]?.pressed);
    if (storm.active) {
      if (
        combatState.motion.vertical !== null &&
        combatState.motion.vertical !== undefined
      )
        vy = combatState.motion.vertical;
      vy -= dt * 20 * (combatState.motion.gravity ?? 1);
    } else if (wallRun) {
      vy -= dt * PARKOUR.runGravity;
    } else {
      // Real gravity and quadratic air drag. Gliding and thermals are the game's
      // deliberate non-physical abilities on top of the baseline.
      vy += dt * (catchingWind ? 5 : gliding ? -2 : -BODY.g);
      vy *= dragFactor(Math.abs(vy), dt);
      if (gliding) vy = Math.max(vy, -2.2);
      vy = Math.min(vy, 8);
    }
    player.position.y += vy * dt;
    if (!storm.active && catchingWind && player.position.y > ground + 30) {
      player.position.y = ground + 30;
      vy = Math.min(vy, 0);
    }
    // Follow short downhill steps so sprinting over a slope keeps the jump input live.
    const followsSlope = !storm.active && wasGrounded && vy <= 0 && player.position.y - ground < .11;
    landed = player.position.y <= ground && !wasGrounded;
    if (player.position.y <= ground || followsSlope) {
      player.position.y = ground;
      vy = 0;
      grounded = true;
      if (storm.active && landed) storm.landing();
    } else grounded = false;
  }
  if (landed && leapDirection) leapRecovery = .34;
  if (landed && !vaultFrame) {
    // Touchdown: legs absorb part of the horizontal momentum and the camera dips with the impact.
    // Holding a direction through a hard landing becomes a roll that keeps the run going.
    const roll = !storm.active && hasInput && fallSpeed < -PARKOUR.rollFall;
    const keep = roll ? .9 : landingRetention(fallSpeed);
    bodyVelocity.x *= keep;
    bodyVelocity.z *= keep;
    if (!reducedMotion) landingDip = Math.min(.45, Math.max(landingDip, -fallSpeed * .028));
  }
  // Walls and clamps stop the body: keep velocity consistent with where it actually went.
  if (dt > 0 && !vaultFrame) {
    const movedX = (player.position.x - beforeX - combatState.motion.dx) / dt;
    const movedZ = (player.position.z - beforeZ - combatState.motion.dz) / dt;
    if (Math.abs(movedX) < Math.abs(bodyVelocity.x)) bodyVelocity.x = movedX;
    if (Math.abs(movedZ) < Math.abs(bodyVelocity.z)) bodyVelocity.z = movedZ;
  }
  if (grounded || storm.active || !combatRuntime.alive) leapDirection = null;
  const traveledX = player.position.x - beforeX, traveledZ = player.position.z - beforeZ;
  const travel = Math.hypot(traveledX, traveledZ);
  const heading = player.rotation.y;
  const sinHeading = Math.sin(heading), cosHeading = Math.cos(heading);
  const pose = storm.active ? storm.state.combat.player : combatState.player;
  animateWarrior?.({
    dt, distance: travel, heading,
    forward: travel > .0001 ? (traveledX * sinHeading + traveledZ * cosHeading) / travel : 1,
    sideways: travel > .0001 ? (traveledX * cosHeading - traveledZ * sinHeading) / travel : 0,
    grounded: grounded || !!wallRun, vertical: wallRun ? 0 : vy, leap: !!leapDirection || leapRecovery > 0, landed,
    vault: vaultFrame?.progress ?? (mantle ? mantle.t : undefined), pose, reset: resetWarriorMotion,
    committedFacing: Boolean(vaultFrame || pose?.guarding ||
      (pose?.action && pose.action !== "idle") || combatState.targetId),
  });
  resetWarriorMotion = false;
  // Lean into a wall-run: roll the visible body toward the face.
  const visual = player.children[0];
  if (visual) {
    let lean = 0;
    if (wallRun) {
      const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
      lean = -Math.sign(rightX * -wallRun.nx + rightZ * -wallRun.nz) * .3;
    }
    wallLean += (lean - wallLean) * Math.min(1, dt * 10);
    // Bank into curved runs: lean = atan(v·ω / g), as a runner tilts against grip.
    const travelHeading = Math.atan2(bodyVelocity.x, bodyVelocity.z);
    const runSpeed = Math.hypot(bodyVelocity.x, bodyVelocity.z);
    const yawRate = grounded && runSpeed > 1 && dt > 0 && lastTravelHeading !== null
      ? Math.atan2(Math.sin(travelHeading - lastTravelHeading), Math.cos(travelHeading - lastTravelHeading)) / dt : 0;
    lastTravelHeading = runSpeed > 1 ? travelHeading : null;
    const bank = T.MathUtils.clamp(-Math.atan(runSpeed * yawRate / 9.81), -.26, .26);
    bankLean += (bank - bankLean) * Math.min(1, dt * 8);
    visual.rotation.z = reducedMotion ? 0 : wallLean + bankLean;
  }
  scarf.update(dt);
  leapRecovery = Math.max(0, leapRecovery - dt);
  const near = lanterns.findIndex(
    (l, i) =>
      !restored.includes(i) &&
      Math.hypot(l.x - player.position.x, l.z - player.position.z) < 3,
  );
  const vaultHint = mayVault && grounded && findVault(
    player.position, Math.sin(player.rotation.y), Math.cos(player.rotation.y), vaultBarriers, height,
  );
  $("#prompt").textContent = storm.active
    ? ""
    : grounded && mission.nearBeacon(player)
      ? `${pad ? "X" : "E"} · Light the signal beacon`
    : grounded && nearWatchMarker()
      ? `${pad ? "X" : "E"} · Read the watch marker${mission.active ? "" : " · begin The Ridge Signal"}`
      : near >= 0
        ? `${pad ? "X" : "E"} · Restore this lantern`
        : vaultHint
          ? `${pad ? "A" : "Space"} · Vault while moving toward the wall`
          : wind
            ? "Hold jump · ride the mountain wind"
            : "";
  if (elapsed > noticeUntil) $("#notice").textContent = "";
  // Ease composition while orbit input and the obstruction solve remain immediate.
  const hoverPose = storm.active && storm.state.hover && !reducedMotion ? 1 : 0;
  ascentCamera = T.MathUtils.lerp(ascentCamera, hoverPose, reducedMotion ? 1 : 1 - Math.exp(-7 * dt));
  const distance = (contemplating ? 10 : 6.6) + ascentCamera * 0.65;
  const followRate = distance > orbitDistance ? 9 : 24;
  orbitDistance = T.MathUtils.lerp(orbitDistance, distance, reducedMotion ? 1 : 1 - Math.exp(-followRate * dt));
  landingDip = Math.max(0, landingDip - realDt * 1.6);
  target.copy(player.position).y += 1.3 - ascentCamera * 0.25 - Math.sin(Math.min(1, landingDip / .45) * Math.PI) * landingDip * .5;
  // Field of view opens with ground speed to sell momentum.
  const groundSpeed = Math.hypot(bodyVelocity.x, bodyVelocity.z);
  const fov = 54 + (reducedMotion ? 0 : Math.max(0, groundSpeed - 3.6) * 1.1);
  if (Math.abs(camera.fov - fov) > .01) {
    camera.fov += (fov - camera.fov) * Math.min(1, realDt * 5);
    camera.updateProjectionMatrix();
  }
  // Lazy follow: with no look input, ease the camera behind the direction of travel.
  const travelSpeed = Math.hypot(bodyVelocity.x, bodyVelocity.z);
  // Only a straight-ahead stick recentres; following a diagonal would rotate the
  // camera-relative input with it and curve the run into a spiral.
  const straightAhead = mz < -.3 && Math.abs(mx) < .2 * Math.abs(mz);
  if (straightAhead && elapsed - lastLook > 1.1 && travelSpeed > 1.5 && !combatRuntime.state.targetId && !contemplating && !vault) {
    const behind = Math.atan2(-bodyVelocity.x, -bodyVelocity.z);
    const turn = Math.atan2(Math.sin(behind - yaw), Math.cos(behind - yaw));
    if (Math.abs(turn) < 1.31) yaw += turn * Math.min(1, realDt * 1.4 * Math.min(1, travelSpeed / 5));
  }
  const clearCamera = placeOrbitCamera(
    target, yaw, pitch, orbitDistance, storm.active ? height : cameraFloor,
    storm.active ? stormCameraObstacles : world.cameraObstacles,
    ascentCamera * 2.55,
  );
  camera.position.set(clearCamera.x, clearCamera.y, clearCamera.z);
  const lookAngle = orbitLookAngle(
    target, camera.position, player.position.y, pitch, T.MathUtils.degToRad(camera.fov),
  );
  const forward = Math.cos(lookAngle);
  // At the zenith, use the orbit heading as screen-up to avoid a yaw flip.
  if (forward < .00001) camera.up.set(Math.sin(yaw), 0, Math.cos(yaw));
  else camera.up.set(0, 1, 0);
  camera.lookAt(
    camera.position.x - Math.sin(yaw) * forward,
    camera.position.y + Math.sin(lookAngle),
    camera.position.z - Math.cos(yaw) * forward,
  );
  world.update?.(dt, reducedMotion ? 0 : elapsed, player.position, storm.active);
  world.pond.update(dt, player.position, camera.position, reducedMotion, storm.active);
  storm.render(dt, reducedMotion ? 0 : elapsed, !grounded);
  combatRuntime.render(dt, storm.active);
  const combatEvents = storm.active ? storm.state.combat?.events ?? [] : combatRuntime.state.events ?? [];
  freeRun.update(realDt, reducedMotion ? 0 : elapsed);
  if (!storm.active) mission.update(dt, elapsed, { player, grounded, events: combatEvents, combatState: combatRuntime.state });
  polish.update(realDt, elapsed, {
    player, stormActive: storm.active, events: combatEvents, reduced: reducedMotion,
    cinematic: contemplating || mission.cinematic ? 1 : 0,
  });
  hud.update(realDt, {
    stormActive: storm.active,
    engaged: !storm.active && combatRuntime.state.enemies?.some((e) => e.health > 0 &&
      Math.hypot(e.x - player.position.x, e.z - player.position.z) < 9),
    contemplating,
  });
  presentation.render(storm.active, realDt);
  frames++;
}
requestAnimationFrame(frame);
setInterval(save, 5000);
addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    bodyVelocity.x = bodyVelocity.z = bodyVelocity.ax = bodyVelocity.az = 0;
    jumpRequested = false;
    // A disconnect can occur while the animation loop is paused.
    padJumpNeedsRelease = true;
    combatRuntime.resetInputs();
    storm.resetInputs();
    save();
  }
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  resizePresentation();
});
window.valley = {
  player,
  camera,
  lanterns,
  interact,
  save,
  world,
  freeRun,
  renderer,
  combat: combatRuntime.core,
  respawn: combatRuntime.respawn,
  get state() {
    return {
      lit: [...restored],
      position: player.position.toArray(),
      saveError,
      vault: vault ? { id: vault.id, progress: Math.min(1, vault.elapsed / VAULT_SECONDS) } : null,
      yaw,
      frames,
      quality,
      graphics: presentation.resolution,
      combat: combatRuntime.state,
      storm: storm.state,
      grounded,
      vertical: vy,
      mission: mission.state,
      parkour: { wallRun: !!wallRun, mantle: !!mantle, kickUsed },
    };
  },
};
