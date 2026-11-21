// Mission: 狼煙 The Ridge Signal.
//
// One complete playable mission in the Veiled Pass, started from the watch marker:
//   1 reach the ruined cloister, 2 free-run the stone posts, 3 wall-run onto the shrine
//   roof, 4 light the signal beacon on the ridge, 5 defeat the Hollow General.
// Progress (stage, timer, best time, completion) saves to its own storage key, separate
// from the journey and duel saves. Presentation only reads gameplay state, except for
// waking/sleeping the dormant mission enemy through the combat core API.

export const MISSION_KEY = "komorebi-mission-v1";
export const GENERAL_ID = "hollow-general";
export const STAGES = [
  null,
  { title: "Reach the ruined cloister", hint: "Follow the lantern path south past the second gate. The stone posts stand west of the path behind the shrine." },
  { title: "Free-run the stone posts", hint: "Jump from post to post. Hold toward a ledge you fall short of to catch it and pull yourself up." },
  { title: "Reach the shrine roof", hint: "Jump north from the last post and pull onto the eave, or sprint beside the cloister wall, run it and kick off north." },
  { title: "Light the signal beacon", hint: "Climb the roof to the ridge. E / X lights the brazier." },
  { title: "Defeat the Hollow General", hint: "It wakes in the open field south of the cloister. Guard (Q / LT) just before its blows land to parry, then strike." },
];

export function readMission(storage) {
  try {
    const data = JSON.parse(storage.getItem(MISSION_KEY) || "null");
    if (data?.version === 1 && Number.isInteger(data.stage) && data.stage >= 0 && data.stage <= 6)
      return { stage: data.stage, time: Number(data.time) || 0, best: Number(data.best) || 0, completed: !!data.completed, runs: Number(data.runs) || 0 };
  } catch {}
  return { stage: 0, time: 0, best: 0, completed: false, runs: 0 };
}

export function createMission({ T, root, camera, storage, course, combat, notice }) {
  let state = readMission(storage);
  let stats = { wallRuns: 0, mantles: 0 };
  const persist = () => {
    try { storage.setItem(MISSION_KEY, JSON.stringify({ version: 1, ...state })); return true; } catch { return false; }
  };

  // ---------------------------------------------------------------- HUD
  const tracker = document.createElement("section");
  tracker.id = "mission-tracker";
  tracker.setAttribute("aria-live", "polite");
  tracker.innerHTML = `<small>狼煙 · THE RIDGE SIGNAL</small><h3></h3><p></p><span class="mission-step"></span>`;
  root.append(tracker);
  const marker = document.createElement("div");
  marker.id = "mission-marker";
  marker.innerHTML = `<i></i><b></b>`;
  root.append(marker);
  const card = document.createElement("section");
  card.id = "mission-card";
  card.innerHTML = `<small></small><h2></h2><p></p><dl></dl>`;
  root.append(card);

  // A soft column of light marks the waypoint in the world.
  const beam = new T.Mesh(
    new T.CylinderGeometry(.35, .35, 40, 24, 1, true),
    new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { time: { value: 0 }, color: { value: new T.Color("#ffcf8a") } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float time; uniform vec3 color; varying vec2 vUv;
        void main(){ float fade = (1. - vUv.y) * (1. - vUv.y);
          float pulse = .65 + .35 * sin(time * 2. - vUv.y * 20.);
          gl_FragColor = vec4(color, fade * .28 * pulse); }`,
    }),
  );
  beam.name = "Mission waypoint";
  beam.visible = false;
  beam.frustumCulled = false;

  let cardTimer = 0;
  function showCard(kicker, title, line, rows = []) {
    card.querySelector("small").textContent = kicker;
    card.querySelector("h2").textContent = title;
    card.querySelector("p").textContent = line;
    card.querySelector("dl").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    card.classList.remove("show");
    void card.offsetWidth;
    card.classList.add("show");
    cardTimer = rows.length ? 9 : 4.2;
  }

  // The tracker's aria-live region announces each objective; no duplicate bottom notice.
  function setStage(stage) {
    state.stage = stage;
    persist();
    if (stage >= 1 && stage <= 5) {
      tracker.querySelector("h3").textContent = STAGES[stage].title;
      tracker.querySelector("p").textContent = STAGES[stage].hint;
      tracker.querySelector(".mission-step").textContent = `Objective ${stage} of 5`;
      tracker.classList.remove("pulse");
      void tracker.offsetWidth;
      tracker.classList.add("pulse");
    }
    tracker.classList.toggle("active", stage >= 1 && stage <= 5);
    if (stage === 5) combat.core.awaken(GENERAL_ID);
    if (stage !== 5 && stage !== 6) combat.core.sleep?.(GENERAL_ID);
  }

  function start() {
    stats = { wallRuns: 0, mantles: 0 };
    state.time = 0;
    state.runs += 1;
    course.setBeacon(false);
    showCard("MISSION", "狼煙 The Ridge Signal", "The spirits doused the ridge beacon. Light it before the pass goes dark.");
    setStage(1);
  }

  function complete() {
    state.completed = true;
    state.best = state.best ? Math.min(state.best, state.time) : state.time;
    const t = state.time;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    showCard("MISSION COMPLETE", "The Ridge Signal", "The beacon burns. Every watchtower in the valley can see it.", [
      ["Time", fmt(t)], ["Best", fmt(state.best)], ["Wall-runs", stats.wallRuns], ["Ledges taken", stats.mantles],
    ]);
    setStage(6);
  }

  // Resume: an in-progress mission continues where it was saved.
  if (state.stage >= 1 && state.stage <= 5) setStage(state.stage);
  if (state.stage >= 5) course.setBeacon(true);
  if (state.stage === 6) course.setBeacon(true);

  const projected = new T.Vector3();
  function waypoint(target, dt, time) {
    beam.visible = !!target;
    marker.classList.toggle("on", !!target);
    if (!target) return;
    beam.position.set(target.x, target.y + 20, target.z);
    beam.material.uniforms.time.value = time;
    projected.set(target.x, target.y + 1.2, target.z).project(camera);
    const behind = projected.z > 1;
    let sx = (projected.x * .5 + .5) * innerWidth, sy = (-projected.y * .5 + .5) * innerHeight;
    if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
    const m = 48;
    const off = behind || sx < m || sx > innerWidth - m || sy < m || sy > innerHeight - m;
    sx = Math.min(innerWidth - m, Math.max(m, sx));
    sy = Math.min(innerHeight - m, Math.max(m, sy));
    marker.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    marker.classList.toggle("edge", off);
    const d = Math.hypot(target.x - camera.position.x, target.y - camera.position.y, target.z - camera.position.z);
    marker.querySelector("b").textContent = `${Math.round(d)} m`;
  }

  return {
    get state() { return { ...state, stats: { ...stats } }; },
    get active() { return state.stage >= 1 && state.stage <= 5; },
    /** Mission beats (cards) frame the shot with the cinematic letterbox. */
    get cinematic() { return cardTimer > 0; },
    /** The watch marker offers the mission; returns true when it handled the interaction. */
    offer() {
      if (state.stage >= 1 && state.stage <= 5) return false;
      start();
      return true;
    },
    restart() { start(); },
    /** Interact on the ridge lights the beacon. Returns true when consumed. */
    interact(player, grounded) {
      if (state.stage !== 4 || !grounded) return false;
      const b = course.beacon;
      if (Math.hypot(player.position.x - b.x, player.position.z - b.z) > 1.8 || player.position.y < b.y - 1.2) return false;
      course.setBeacon(true);
      showCard("THE BEACON BURNS", "Something stirs below", "The fire's light falls on the courtyard. A general of the old watch rises to answer it.");
      setStage(5);
      return true;
    },
    nearBeacon(player) {
      const b = course.beacon;
      return state.stage === 4 && Math.hypot(player.position.x - b.x, player.position.z - b.z) <= 1.8 && player.position.y > b.y - 1.2;
    },
    record(event) { if (event in stats) stats[event] += 1; },
    update(dt, time, { player, grounded, events, combatState }) {
      if (cardTimer > 0) {
        cardTimer -= dt;
        if (cardTimer <= 0) card.classList.remove("show");
      }
      if (!this.active) { waypoint(null, dt, time); return; }
      state.time += dt;
      const p = player.position;
      const onTop = (s) => grounded && Math.abs(p.y - s.top) < .12 && Math.hypot(p.x - s.cx, p.z - s.cz) <= s.r + .05;
      let target = null;
      switch (state.stage) {
        case 1: {
          const s = course.posts[0];
          target = { x: s.cx, y: s.top, z: s.cz };
          if (Math.hypot(p.x - s.cx, p.z - s.cz) < 3.2) setStage(2);
          break;
        }
        case 2: {
          const next = course.posts.find((s) => p.y < s.top - .2) ?? course.posts[2];
          target = { x: next.cx, y: next.top, z: next.cz };
          if (onTop(course.posts[2])) setStage(3);
          break;
        }
        case 3:
          target = { x: course.roofSpot.x, y: course.hallY + 4.6, z: course.roofSpot.z };
          if (grounded && course.onRoof(p.x, p.y, p.z)) setStage(4);
          break;
        case 4:
          target = { x: course.beacon.x, y: course.beacon.y, z: course.beacon.z };
          break;
        case 5: {
          const general = combatState?.enemies?.find((e) => e.id === GENERAL_ID);
          if (general && general.health > 0) target = { x: general.x, y: general.y + 2.4, z: general.z };
          if (events?.some((e) => e.type === "enemyDefeated" && e.id === GENERAL_ID) ||
              combatState?.defeatedIds?.includes(GENERAL_ID)) complete();
          break;
        }
      }
      waypoint(target, dt, time);
    },
    attachScene(scene) { scene.add(beam); },
  };
}
