import * as T from "three";
import {
  findVault, movePastVaultBarriers, vaultBarrierFloor, vaultPose, vaultSavePosition, VAULT_SECONDS,
} from "./vault.js";
import { connectWarrior } from "./warrior-motion.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createWorld } from "./valley-world.js";
import { enhanceAtmosphere } from "./valley-atmosphere.js";
import { createCombatRuntime } from "./combat-runtime.js";
import { createStormRuntime } from "./storm-runtime.js";
import { createValleyRender, GRAPHICS_TIERS } from "./valley-render.js";
import { createPolish } from "./aaa-polish.js";
import { landingRetention, pushOff, stepLocomotion } from "./locomotion-physics.js";
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
const presentation = createValleyRender(renderer, scene, camera);
const player = new T.Group();
scene.add(player);
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
  const hood = gltf.scene.getObjectByName("WarriorStormHood");
  if (hood) hood.visible = false;
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
  if (nearWatchMarker()) {
    notice("Watch marker · The tracks turn toward the cedar court. Someone followed them after the signals went dark.");
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
let launchBoost = 0;
addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "AltLeft", "AltRight"].includes(e.code))
    e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (storm.active) storm.keyDown(e.code);
  else combatRuntime.keyDown(e.code);
  if (e.code === "KeyE") interact();
  if (e.code === "Space" && !storm.active && grounded && combatRuntime.alive)
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
    { x: -8, z: -42, radius: 7 },
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
    launchBoost = 0;
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
    bodyVelocity.x = bodyVelocity.z = 0;
    vault = null;
    leapDirection = null;
    launchBoost = 0;
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
    if (previous.length) bodyVelocity.x = bodyVelocity.z = 0;
    previous = [];
    $("#controller").textContent = "Keyboard ready · connect Xbox controller";
  }
  if (mx || mz) contemplating = false;
  const speed =
      keys.has("ShiftLeft") ||
      keys.has("ShiftRight") ||
      pad?.buttons[7]?.pressed
        ? 7
        : 3.6,
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
  if (jumpRequested && !storm.active && grounded && combatRuntime.alive) {
    if (mayVault) vault = findVault(player.position, dx, dz, vaultBarriers, height);
    const magnitude = Math.hypot(dx, dz);
    leapDirection = speed === 7 && magnitude > .6
      ? { x: dx / magnitude, z: dz / magnitude }
      : null;
    leapRecovery = 0;
    launchBoost = leapDirection ? .30 : 0;
    // Keep the ordinary jump impulse until combat has accepted the vault.
    vy = leapDirection ? 7.8 : 7;
    if (!vault) pushOff(bodyVelocity, dx, dz, { leap: !!leapDirection, speed });
    grounded = false;
    contemplating = false;
  }
  jumpRequested = false;
  // Momentum fades after launch and yields to braking, reversed input or pad loss.
  const boost = leapDirection && dx * leapDirection.x + dz * leapDirection.z > .25
    ? 2.2 * launchBoost / .30
    : 0;
  launchBoost = Math.max(0, launchBoost - dt);
  const vaultHeading = vault && !combatIntent ? Math.sign(vault.toZ - vault.fromZ) : null;
  const movement = {
    grounded,
    moveX: vaultHeading === null ? dx : 0,
    moveZ: vaultHeading ?? dz,
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
    launchBoost = 0;
  }
  let vaultFrame = vault ? vaultPose(vault, vault.elapsed) : null;
  if (vaultFrame) bodyVelocity.x = bodyVelocity.z = 0;
  else stepLocomotion(bodyVelocity, {
    dirX: dx, dirZ: dz, maxSpeed: speed * movementScale, grounded, dt,
    stance: Boolean(combatState.targetId || (storm.active ? storm.state.combat?.player : combatState.player)?.guarding ||
      ((storm.active ? storm.state.combat?.player : combatState.player)?.action ?? "idle") !== "idle"),
    height: storm.active ? storm.height : height, x: player.position.x, z: player.position.z,
  });
  const nextX = T.MathUtils.clamp(
    player.position.x + (bodyVelocity.x + (leapDirection?.x ?? 0) * boost * movementScale) * dt + combatState.motion.dx,
    -70, 70,
  );
  const nextZ = T.MathUtils.clamp(
    player.position.z + (bodyVelocity.z + (leapDirection?.z ?? 0) * boost * movementScale) * dt + combatState.motion.dz,
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
  const ground = vaultBarrierFloor(player.position, terrain, vaultBarriers),
    gliding = (keys.has("Space") || pad?.buttons[0]?.pressed) && vy < 0,
    wind = windZones.some(
      (w) =>
        Math.hypot(w.x - player.position.x, w.z - player.position.z) < w.radius,
    );
  let landed = false;
  const fallSpeed = vy;
  if (vaultFrame) {
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
    } else {
      vy += dt * (catchingWind ? 5 : gliding ? -2 : -18);
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
    const keep = landingRetention(fallSpeed);
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
    grounded, vertical: vy, leap: !!leapDirection || leapRecovery > 0, landed,
    vault: vaultFrame?.progress, pose, reset: resetWarriorMotion,
    committedFacing: Boolean(vaultFrame || pose?.guarding ||
      (pose?.action && pose.action !== "idle") || combatState.targetId),
  });
  resetWarriorMotion = false;
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
    : grounded && nearWatchMarker()
      ? `${pad ? "X" : "E"} · Read the watch marker`
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
  const clearCamera = placeOrbitCamera(
    target, yaw, pitch, orbitDistance, height,
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
  polish.update(realDt, elapsed, {
    player, stormActive: storm.active, events: combatEvents, reduced: reducedMotion,
    cinematic: contemplating ? 1 : 0,
  });
  hud.update(realDt, {
    stormActive: storm.active,
    engaged: !storm.active && combatRuntime.state.enemies?.some((e) => e.health > 0 &&
      Math.hypot(e.x - player.position.x, e.z - player.position.z) < 16),
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
    bodyVelocity.x = bodyVelocity.z = 0;
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
    };
  },
};
