import {
  createStormCampaign,
  RINGS,
  SCROLLS,
  SHRINES,
  STONES,
  STORM_SAVE,
  WEAPONS,
} from "./storm-campaign.js";
import { createCombatControls } from "./combat-input.js";
import { createCombatView } from "./combat-view.js";
import { createStormScene } from "./storm-scene.js";
import { createStormEffects } from "./storm-effects.js";
import "./storm.css";

export function createStormRuntime(
  T,
  scene,
  player,
  baseHeight,
  storage,
  notify,
  moveTo,
  soundEnabled,
) {
  const scenery = createStormScene(T, scene, baseHeight);
  scenery.kit.attach().catch((error) => console.warn("Storm shrine kit unavailable:", error.message));
  const height = (x, z) =>
    scenery.height(x, z, baseHeight(x, z), player.position.y);
  let initial;
  try {
    initial = JSON.parse(storage.getItem(STORM_SAVE));
  } catch {}
  let menu = null,
    previous = [],
    jumpHeld = false,
    focused = 0,
    lastButtons = [];
  const special = new Set();
  const controls = createCombatControls();
  const campaign = createStormCampaign({
    height: baseHeight,
    saveData: initial,
    notify,
    changed: () => save(),
  });
  const visual = createStormEffects(T, scene, player);
  const wardens = createCombatView(T, scene, player, { playerWeapon: false });
  let snapshot = campaign.snapshot;
  scenery.setActive(snapshot.active);
  const ui = document.createElement("section");
  ui.id = "storm-hud";
  ui.innerHTML = `<button id="storm-enter">Enter the Celestial Storm · Menu / Start</button>
    <div id="storm-status" hidden><strong id="storm-weapon"></strong><span id="storm-resources"></span><p id="storm-objective"></p><p class="storm-controls">RB / J light · LB / K heavy & slam · Y / R lightning · B / Alt dash · LS click / V ascend · LT / Q guard</p></div>
    <div id="storm-menu" role="dialog" aria-label="Shrine checkpoint" hidden></div>`;
  document.querySelector("#app").append(ui);
  const byId = (id) => ui.querySelector("#" + id),
    status = byId("storm-status"),
    dialog = byId("storm-menu");
  const getPos = () => ({
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    facing: player.rotation.y,
  });
  const group = new T.Group();
  scene.add(group);
  const gold = new T.MeshStandardMaterial({
    color: "#ffd99a",
    emissive: "#e8852e",
    emissiveIntensity: 1.2,
  });
  const cyan = new T.MeshStandardMaterial({
    color: "#c6ffff",
    emissive: "#20dcff",
    emissiveIntensity: 2.5,
  });
  const stone = new T.MeshStandardMaterial({
    color: "#625b64",
    roughness: 0.74,
  });
  const markers = [];
  for (const item of [...SHRINES, ...SCROLLS, ...STONES]) {
    const node = new T.Group();
    node.position.set(item.x, baseHeight(item.x, item.z), item.z);
    const isStone = STONES.includes(item);
    const geometry = isStone
      ? new T.CylinderGeometry(0.15, 0.24, 1, 6)
      : new T.OctahedronGeometry(0.24);
    const shape = new T.Mesh(geometry, isStone ? stone : gold);
    shape.position.y = isStone ? 0.55 : 1.35;
    node.add(shape);
    if (isStone) {
      const lamp = new T.Mesh(new T.BoxGeometry(0.36, 0.26, 0.36), gold);
      lamp.position.y = 1.1;
      node.add(lamp);
      const cap = new T.Mesh(new T.ConeGeometry(0.39, 0.34, 4), stone);
      cap.position.y = 1.38;
      node.add(cap);
    }
    group.add(node);
    markers.push({ node, item, shape, isStone });
  }
  const rings = RINGS.map((r) => {
    const mesh = new T.Mesh(new T.TorusGeometry(1.25, 0.05, 8, 32), cyan);
    mesh.position.set(r.x, baseHeight(r.x, r.z) + r.lift, r.z);
    group.add(mesh);
    return mesh;
  });
  // Each sound is synthesized locally and only plays after the existing Sound opt-in.
  let audio;
  function sound(type) {
    if (!soundEnabled() || document.hidden || !globalThis.AudioContext) return;
    try {
      audio ??= new AudioContext();
      if (audio.state !== "running") {
        audio.resume().catch(() => {});
        return;
      }
      const osc = audio.createOscillator(),
        gain = audio.createGain(),
        now = audio.currentTime;
      osc.type = type === "chain" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(type === "slam" ? 150 : 460, now);
      osc.frequency.exponentialRampToValueAtTime(
        type === "slam" ? 45 : 170,
        now + 0.18,
      );
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(now + 0.23);
    } catch {}
  }
  function save() {
    try {
      storage.setItem(STORM_SAVE, JSON.stringify(campaign.serialize()));
      return true;
    } catch {
      return false;
    }
  }
  function showMenu() {
    dialog.hidden = !menu;
    if (!menu) {
      dialog.replaceChildren();
      return;
    }
    if (menu.kind === "scroll") {
      dialog.innerHTML =
        '<h2></h2><p></p><button id="storm-close">Close</button>';
      dialog.querySelector("h2").textContent = menu.title;
      dialog.querySelector("p").textContent = menu.body;
    } else {
      const data = campaign.snapshot;
      dialog.innerHTML = `<h2>${menu.name}</h2><p>${menu.inscription}</p><p>${data.shards} upgrade shards</p><div class="storm-armory">${Object.entries(
        WEAPONS,
      )
        .map(([id, w]) => {
          const rank = data.levels[id],
            cost = 2 + rank * 2;
          return `<div><span>${w.name} · rank ${rank}</span><button data-weapon="${id}" aria-pressed="${data.weapon === id}">${data.weapon === id ? "Equipped" : "Equip"}</button><button data-upgrade="${id}" ${rank >= 3 || data.shards < cost ? "disabled" : ""}>${rank >= 3 ? "Max rank" : `Upgrade · ${cost}`}</button></div>`;
        })
        .join("")}</div>
      ${menu.index === 0 ? '<button data-trial="parry">Trial of the Bell · parry three pulses</button>' : ""}
      ${menu.index === 1 ? '<button data-trial="flight">Trial of Petals · clear four airborne rings</button>' : ""}
      <button id="storm-close">Leave shrine</button><button id="storm-leave">Return to the Veiled Pass</button>`;
    }
    const buttons = dialog.querySelectorAll("button:not(:disabled)");
    focused = Math.min(focused, buttons.length - 1);
    buttons[focused]?.focus({ preventScroll: true });
  }
  function closeMenu() {
    menu = null;
    campaign.closeShrine();
    showMenu();
    controls.reset();
  }
  function enter() {
    campaign.enter();
    snapshot = campaign.snapshot;
    scenery.setActive(true);
    moveTo(SHRINES[0]);
    syncUI();
  }
  function interact() {
    if (menu) {
      closeMenu();
      return;
    }
    const result = campaign.interact(getPos());
    if (result) {
      menu = result;
      focused = 0;
      showMenu();
    }
  }
  byId("storm-enter").onclick = enter;
  dialog.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.id === "storm-close") {
      closeMenu();
      return;
    }
    if (button.id === "storm-leave") {
      closeMenu();
      campaign.leave();
      snapshot = campaign.snapshot;
      scenery.setActive(false);
      moveTo({ x: 5, z: 16 });
      syncUI();
      return;
    }
    if (button.dataset.weapon)
      campaign.equip(button.dataset.weapon, menu.index);
    if (button.dataset.upgrade)
      campaign.upgrade(button.dataset.upgrade, menu.index);
    if (
      button.dataset.trial &&
      campaign.startTrial(button.dataset.trial, menu.index)
    ) {
      closeMenu();
      return;
    }
    showMenu();
  });
  function menuInput(pad) {
    const buttons = Array.from(
      dialog.querySelectorAll("button:not(:disabled)"),
    );
    const edge = (i) => pad?.buttons[i]?.pressed && !lastButtons[i];
    if (edge(1) || edge(2)) {
      closeMenu();
      return;
    }
    if (edge(12) || edge(14))
      focused = (focused + buttons.length - 1) % buttons.length;
    if (edge(13) || edge(15)) focused = (focused + 1) % buttons.length;
    if (edge(0)) buttons[focused]?.click();
    else buttons[focused]?.focus({ preventScroll: true });
  }
  function syncUI() {
    document
      .querySelector("#app")
      .classList.toggle("storm-active", snapshot.active);
    document.querySelector("header h1").textContent = snapshot.active
      ? "Celestial Storm"
      : "The Veiled Pass";
    document.querySelector("header p").textContent = snapshot.active
      ? "The Shrine Order has fallen."
      : "Something woke beyond the cedars.";
    byId("storm-enter").hidden = snapshot.active;
    status.hidden = !snapshot.active;
    const legacy = document.querySelector("#combat-hud");
    if (legacy) legacy.hidden = snapshot.active;
    if (!snapshot.active) return;
    byId("storm-weapon").textContent =
      WEAPONS[snapshot.weapon].name + " · " + snapshot.levels[snapshot.weapon];
    byId("storm-resources").textContent =
      `Vitality ${Math.ceil(snapshot.health)} · Spirit ${Math.floor(snapshot.spirit)} · Shards ${snapshot.shards}`;
    const { boss, trial } = snapshot;
    byId("storm-objective").textContent =
      boss.mode === "victory"
        ? "Victory · The Celestial Storm is unbound."
        : snapshot.health <= 0
          ? "Defeat · Press A / Space to return to the last shrine."
          : boss.mode === "telegraph"
            ? "Guardian · Phase " +
              boss.phase +
              " · Leap or dash out of the storm circle"
            : boss.mode === "counter"
              ? `Guardian · Phase ${boss.phase} · ${Math.ceil(boss.health)} vitality · Aerial counter now`
              : ["ready", "active"].includes(trial?.status)
                ? trial.id === "parry"
                  ? `Parry trial · ${trial.parries}/3 · ${Math.max(0, trial.wave).toFixed(1)}s to pulse`
                  : `Petal flight · ${trial.count}/4 · ${Math.ceil(trial.remaining)}s`
                : trial
                  ? `Shrine trial · ${trial.status}`
                  : "Follow the Torii to the Grand Gate · E / X to read or attune";
  }
  syncUI();
  function step(dt, keys, pad, movement) {
    const padButtons = pad?.buttons.map((b) => b.pressed) ?? [],
      edge = (i) => padButtons[i] && !previous[i];
    if (menu) {
      menuInput(pad);
      lastButtons = padButtons;
      previous = padButtons;
      return {
        motion: { dx: 0, dz: 0, vertical: 0, gravity: 0 },
        movementScale: 0,
      };
    }
    lastButtons = padButtons;
    if (edge(2)) interact();
    if (menu) {
      previous = padButtons;
      return {
        motion: { dx: 0, dz: 0, vertical: 0, gravity: 0 },
        movementScale: 0,
      };
    }
    const jump = keys.has("Space") || !!padButtons[0],
      jumpEdge = (jump && !jumpHeld) || special.has("Space");
    jumpHeld = jump;
    if (snapshot.health <= 0 && jumpEdge) moveTo(campaign.respawn());
    const input = controls.sample(keys, pad);
    input.magic = special.has("KeyR") || edge(3);
    input.ascend = special.has("KeyV") || edge(10);
    previous = padButtons;
    special.clear();
    if (
      Math.hypot(movement.moveX, movement.moveZ) > 0.1 &&
      !["startup", "active"].includes(snapshot.attack.phase)
    )
      player.rotation.y = Math.atan2(movement.moveX, movement.moveZ);
    if (input.lock && !snapshot.combat.targetId) {
      const enemy = snapshot.combat.enemies
        .filter((e) => e.health > 0)
        .sort(
          (a, b) =>
            Math.hypot(a.x - player.position.x, a.z - player.position.z) -
            Math.hypot(b.x - player.position.x, b.z - player.position.z),
        )[0];
      if (enemy)
        player.rotation.y = Math.atan2(
          enemy.x - player.position.x,
          enemy.z - player.position.z,
        );
    }
    const locked = snapshot.combat.enemies.find(
      (e) => e.id === snapshot.combat.targetId && e.health > 0,
    );
    if (locked && !["startup", "active"].includes(snapshot.attack.phase))
      player.rotation.y = Math.atan2(
        locked.x - player.position.x,
        locked.z - player.position.z,
      );
    const motion = campaign.update(dt, { ...getPos(), ...movement }, input);
    snapshot = campaign.snapshot;
    if (jumpEdge && movement.grounded && snapshot.health > 0)
      motion.vertical = 14;
    for (const fx of snapshot.effects)
      if (["chain", "slam", "ascend", "boss-aoe"].includes(fx.type))
        sound(fx.type);
    syncUI();
    return {
      motion,
      movementScale: snapshot.combat.player.movementScale,
      targetId: snapshot.combat.targetId,
    };
  }
  function render(dt, time, airborne) {
    snapshot = campaign.snapshot;
    group.visible = snapshot.active;
    scenery.update(
      { ...snapshot, time, player: getPos(), bossPhase: snapshot.boss.phase },
      dt,
    );
    const activeTrial =
      snapshot.trial?.id === "flight" &&
      ["ready", "active"].includes(snapshot.trial.status);
    rings.forEach((ring, i) => {
      ring.visible = !!activeTrial && i >= snapshot.trial.count;
    });
    for (const { node, item, shape, isStone } of markers) {
      node.visible = !snapshot.broken.includes(item.id);
      if (!isStone) shape.rotation.y = time * 0.7;
    }
    wardens.update(
      {
        enemies: snapshot.active
          ? snapshot.combat.enemies.filter((e) => e.id !== "guardian")
          : [],
        player: { action: "dead" },
        events: snapshot.combat.events,
      },
      dt,
    );
    visual.update(
      {
        ...snapshot,
        airborne,
        attack: { ...snapshot.attack, weapon: snapshot.weapon },
      },
      dt,
    );
  }
  return {
    step,
    render,
    height,
    cameraObstacles: scenery.cameraObstacles,
    save,
    interact,
    enter,
    landing() {
      if (campaign.landing(getPos())) {
        sound("slam");
        snapshot = campaign.snapshot;
      }
    },
    keyDown(code) {
      if (code === "Escape" && menu) closeMenu();
      else special.add(code);
      controls.keyDown(code);
    },
    keyUp(code) {
      controls.keyUp(code);
    },
    resetInputs() {
      controls.reset();
      special.clear();
    },
    get active() {
      return snapshot.active;
    },
    get menuOpen() {
      return !!menu;
    },
    get state() {
      return snapshot;
    },
  };
}
