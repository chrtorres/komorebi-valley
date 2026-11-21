import { createCombat, ATTACKS } from "./combat-core.js";
import { separateCapsules } from "./combat-physics.js";
import { createCombatControls } from "./combat-input.js";
import { createCombatView } from "./combat-view.js";
import "./combat.css";

const KEY = "komorebi.combat.v1";
export function createCombatRuntime(
  T,
  scene,
  player,
  height,
  storage,
  notice,
  onRespawn = () => {},
) {
  const enemies = [
    { id: "warden-cedar", x: -16, z: -29, health: 85 },
    { id: "warden-stream", x: -22, z: -31, health: 85 },
    { id: "warden-ridge", x: 17, z: -54, health: 105 },
  ];
  const core = createCombat({ height, enemies, aggroRange: 8 });
  try {
    const raw = storage.getItem(KEY);
    if (raw) core.restore(JSON.parse(raw));
  } catch {}
  const controls = createCombatControls(),
    view = createCombatView(T, scene, player);
  const panel = document.createElement("section");
  panel.id = "combat-hud";
  panel.setAttribute("aria-label", "Combat status");
  panel.innerHTML = `<small>THE CEDAR WARDENS · OPTIONAL DUELS</small><div class="combat-bars"><label>Vitality <progress id="vitality" max="100" value="100"></progress></label><label>Spirit <progress id="stamina" max="100" value="100"></progress></label></div><div id="combo" role="status"></div><div id="combat-phase"></div><details><summary>Combat guide · J / K or RB / LB</summary><p>J / RB · light &nbsp; K / LB · heavy (hold to charge)<br>Alt / B · dodge &nbsp; Q / LT · guard; tap before impact to parry<br>F / RS click · lock target &nbsp; Space / A · jump / aerial follow-up</p><p>Light → light → light: sweeping finisher<br>Light → light → heavy: launcher<br>Light → heavy / heavy → light: mixed finisher<br>Heavy → heavy: crushing strike<br>Buffer the next press late in recovery. One aerial light per jump.</p><p>The wardens wait off the lantern path at the cedar courtyard. Amber rings telegraph attacks; dodge or parry as the strike arrives. Attacks, blocks and dodges spend spirit; it regenerates after a brief rest.</p></details><button id="respawn" hidden>Return to the path · A / Space</button>`;
  document.querySelector("#app").append(panel);
  const q = (s) => panel.querySelector(s);
  let snapshot = core.update(0, {}, position()),
    respawnWasHeld = false,
    impact = 0,
    swingFacing = player.rotation.y,
    viewHidden = false;
  function position() {
    return {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      facing: player.rotation.y,
    };
  }
  function save() {
    try {
      const data = core.serialize();
      let prior;
      // A malformed old save must not prevent replacing it with valid progress.
      try {
        prior = JSON.parse(storage.getItem(KEY) || "null");
      } catch {}
      const validIds = new Set(enemies.map((e) => e.id));
      if (prior?.version === 1 && Array.isArray(prior.defeatedIds))
        data.defeatedIds = [
          ...new Set([
            ...data.defeatedIds,
            ...prior.defeatedIds.filter((id) => validIds.has(id)),
          ]),
        ];
      storage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
  function respawn() {
    snapshot = core.respawn();
    player.position.set(5, height(5, 16), 16);
    controls.reset();
    onRespawn();
    save();
    notice("You return to the path. The lights you restored remain.");
    return snapshot;
  }
  q("#respawn").onclick = respawn;
  function readInput(keys, pad) {
    return controls.sample(keys, pad);
  }
  function step(dt, keys, pad, movement, input = readInput(keys, pad)) {
    const respawnHeld = keys.has("Space") || !!pad?.buttons?.[0]?.pressed;
    if (snapshot.player.health <= 0 && respawnHeld && !respawnWasHeld) {
      respawn();
      movement = { ...movement, grounded: true, moveX: 0, moveZ: 0 };
    }
    respawnWasHeld = respawnHeld;
    const previous = snapshot.player;
    const spec = ATTACKS[previous.action];
    const finishing =
      spec && previous.timer + dt >= spec.startup + spec.active + spec.recovery;
    let targetId = snapshot.targetId;
    if (input.lock)
      targetId = targetId
        ? null
        : snapshot.enemies
            .filter(
              (e) =>
                e.health > 0 &&
                Math.hypot(e.x - player.position.x, e.z - player.position.z) <
                  24,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - player.position.x, a.z - player.position.z) -
                  Math.hypot(
                    b.x - player.position.x,
                    b.z - player.position.z,
                  ) || a.id.localeCompare(b.id),
            )[0]?.id;
    const locked = snapshot.enemies.find(
      (e) => e.id === targetId && e.health > 0,
    );
    let desired = player.rotation.y;
    if (locked)
      desired = Math.atan2(
        locked.x - player.position.x,
        locked.z - player.position.z,
      );
    else if (Math.hypot(movement.moveX, movement.moveZ) > 0.001)
      desired = Math.atan2(movement.moveX, movement.moveZ);
    // Capture one facing for the whole swing. A finishing buffered attack may capture a new facing.
    const mayTurn = !spec || finishing || input.dodge;
    player.rotation.y = mayTurn ? desired : swingFacing;
    snapshot = core.update(dt, input, { ...position(), ...movement });
    if (ATTACKS[snapshot.player.action]) {
      if (
        !spec ||
        snapshot.player.action !== previous.action ||
        snapshot.player.combo.length !== previous.combo.length
      )
        swingFacing = player.rotation.y;
      player.rotation.y = swingFacing;
    }
    impact = Math.max(0, impact - dt);
    for (const event of snapshot.events) {
      if (event.type === "enemyHit") impact = 0.08;
      if (event.type === "parry")
        notice("Perfect parry · the warden is staggered.");
      if (event.type === "enemyDefeated") {
        save();
        notice("A warden yields. Your victory is remembered.");
      }
      if (event.type === "playerDeath") {
        save();
        notice("Take a breath. Press A / Space to return to the path.");
      }
    }
    const nearest = snapshot.enemies.reduce(
      (d, e) =>
        e.health > 0
          ? Math.min(
              d,
              Math.hypot(e.x - player.position.x, e.z - player.position.z),
            )
          : d,
      Infinity,
    );
    panel.classList.toggle(
      "engaged",
      nearest < 12 ||
        snapshot.player.action !== "idle" ||
        snapshot.player.health < 100,
    );
    q("#vitality").value = snapshot.player.health;
    q("#stamina").value = snapshot.player.stamina;
    q("#combo").textContent = snapshot.player.combo
      .map((c) =>
        c === "light" ? "LIGHT" : c === "airLight" ? "AIR LIGHT" : "HEAVY",
      )
      .join("  →  ");
    const action = snapshot.player.guarding
      ? "guarding"
      : snapshot.player.action.replace(/([a-z])(\d)/g, "$1 $2");
    q("#combat-phase").textContent =
      snapshot.player.health <= 0
        ? "Rest, then return."
        : `${snapshot.targetId ? "LOCKED · " : ""}${action} · ${snapshot.player.phase}${snapshot.player.phase === "recovery" ? " · buffer next strike" : ""}`;
    q("#respawn").hidden = snapshot.player.health > 0;
    return snapshot;
  }
  function resolveBody() {
    const resolved = separateCapsules(player.position, snapshot.enemies);
    player.position.x = resolved.x;
    player.position.z = resolved.z;
  }
  return {
    core,
    readInput,
    step,
    save,
    respawn,
    resolveBody,
    keyDown(code) {
      controls.keyDown(code);
    },
    keyUp(code) {
      controls.keyUp(code);
    },
    resetInputs() {
      controls.reset();
    },
    render(dt, hidden = false) {
      if (hidden && viewHidden) return;
      viewHidden = hidden;
      view.update(
        hidden ? { enemies: [], player: { action: "dead" } } : snapshot,
        dt,
      );
    },
    get state() {
      return snapshot;
    },
    get impact() {
      return impact;
    },
    get alive() {
      return snapshot.player.health > 0;
    },
    dispose() {
      view.dispose();
      panel.remove();
    },
  };
}
