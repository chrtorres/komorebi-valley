// HUD choreography: title card, fading area banner, tucked control hints and a
// photo-mode clean frame while contemplating. Purely presentational: nothing here
// intercepts pointer events, so every existing button and test hook still works.

export function createInterface({ root }) {
  const body = document.body;
  const header = root.querySelector("header");
  const footerHelp = root.querySelector("footer p");
  const params = new URLSearchParams(location.search);
  // Automated runs skip the title unless asked; players always see it.
  const showTitle = params.get("title") === "1" || (!navigator.webdriver && params.get("title") !== "0");

  const title = document.createElement("div");
  title.id = "title-card";
  title.innerHTML = `
    <div class="title-mon" aria-hidden="true"></div>
    <small>木漏れ日の谷</small>
    <h1>Komorebi Valley</h1>
    <p>Relight the Veiled Pass · Weather the Celestial Storm</p>
    <span class="title-press">Press any key or button</span>`;
  if (showTitle) root.append(title);
  else title.remove();

  // Ink veil for scene changes: close over the frame, swap behind it, then dissolve.
  const veil = document.createElement("div");
  veil.id = "ink-veil";
  veil.innerHTML = `<div class="veil-banner"><small></small><h2></h2><p></p></div>`;
  root.append(veil);
  const AREAS = {
    storm: ["天嵐 · CELESTIAL STORM", "The Celestial Storm", "The Shrine Order has fallen."],
    pass: ["霧の峠 · THE VEILED PASS", "The Veiled Pass", "Something woke beyond the cedars."],
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let veiled = false, allowClick = false;
  function transition(action, area) {
    if (veiled && !(navigator.webdriver && params.get("veil") !== "1")) return;
    veiled = true;
    const [kicker, name, line] = AREAS[area];
    veil.querySelector("small").textContent = kicker;
    veil.querySelector("h2").textContent = name;
    veil.querySelector("p").textContent = line;
    veil.classList.remove("out");
    veil.classList.add("in");
    // Automation drives scene changes synchronously (existing browser contracts);
    // players see the veil close before the swap. ?veil=1 forces the player path.
    const immediate = navigator.webdriver && params.get("veil") !== "1";
    const swap = immediate ? 0 : reduce.matches ? 60 : 650;
    // A microtask (not a direct call) because the action re-clicks the button: browsers
    // ignore a nested click() on an element whose own click is still dispatching.
    (immediate ? queueMicrotask : (fn) => setTimeout(fn, swap))(() => {
      try { action(); } finally {
        // Let one frame render the new scene before revealing it.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          veil.classList.add("out");
          veil.classList.remove("in");
          setTimeout(() => { veil.classList.remove("out"); veiled = false; }, reduce.matches ? 100 : 2600);
        }));
      }
    });
  }
  // Scene-change buttons (mouse, keyboard or the pad's menu A) pass through the veil.
  document.addEventListener("click", (e) => {
    const button = e.target.closest?.("#storm-enter, #storm-leave");
    if (!button || allowClick) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    transition(() => {
      allowClick = true;
      try { button.click(); } finally { allowClick = false; }
    }, button.id === "storm-enter" ? "storm" : "pass");
  }, true);

  // Notices ease in instead of popping; each new line restarts the animation.
  const notice = root.querySelector("#notice");
  if (notice) new MutationObserver(() => {
    notice.classList.remove("fresh");
    void notice.offsetWidth;
    if (notice.textContent) notice.classList.add("fresh");
  }).observe(notice, { childList: true, characterData: true, subtree: true });

  const hint = document.createElement("span");
  hint.id = "help-hint";
  hint.textContent = "H · controls";
  root.querySelector("footer")?.prepend(hint);

  let titleOpen = showTitle, bannerTime = 0, helpTime = 14, helpPinned = false, lastStorm = null, padSeen = [];
  function dismissTitle() {
    if (!titleOpen) return;
    titleOpen = false;
    title.classList.add("gone");
    setTimeout(() => title.remove(), 1600);
    bannerTime = 0;
  }
  addEventListener("keydown", (e) => {
    dismissTitle();
    if (e.code === "KeyH" && !e.repeat) {
      helpPinned = !helpPinned;
      helpTime = helpPinned ? Infinity : 0;
    }
  });
  addEventListener("pointerdown", dismissTitle);
  body.classList.toggle("title-open", titleOpen);

  return {
    transition,
    get transitioning() { return veiled; },
    update(dt, { stormActive, engaged, contemplating }) {
      if (titleOpen) {
        const pad = navigator.getGamepads?.().find?.((p) => p);
        const pressed = pad ? pad.buttons.map((b) => b.pressed) : [];
        if (pressed.some((p, i) => p && !padSeen[i])) dismissTitle();
        padSeen = pressed;
      }
      body.classList.toggle("title-open", titleOpen);
      if (stormActive !== lastStorm) {
        lastStorm = stormActive;
        bannerTime = 0;
        if (!helpPinned) helpTime = 14;
      }
      if (!titleOpen) bannerTime += dt;
      header?.classList.toggle("faded", bannerTime > 7);
      helpTime -= dt;
      footerHelp?.classList.toggle("tucked", helpTime < 0);
      body.classList.toggle("duel-engaged", !!engaged);
      body.classList.toggle("photo-mode", !!contemplating);
      body.classList.toggle("storm-mode", !!stormActive);
    },
  };
}
