# Komorebi Valley

A third-person Japanese valley exploration game, developed in this fresh repository. The retained foundation was authored and tested locally before import; this repository does not claim Git ancestry from Agent-Town/agent-town.

## Run

Use Node.js 20 or later. Run `npm ci`, then `npm run dev -- --port 5191 --strictPort`. Open http://127.0.0.1:5191. Keep that browser origin to retain your saved journey. For a production build, run `npm run build` followed by `npm start -- --port 5191 --strictPort`.

Move with WASD / Xbox left stick, orbit with mouse drag / right stick, jump with Space / A, run with Shift / RT, and restore lanterns with E / X. Saves remain in this browser; clearing site storage clears them. Physical Xbox handling requires a connected pad and a button press to expose it to the browser.

## Development

Create a feature branch for each change. Run `npm run test:journey` and the relevant browser regressions before integration. `npm run gate:valley` builds and runs the full exploration suite. Evidence is retained outside the repository. Work is reviewed locally by another engineer before release; no remote push is implied by a local commit.

The foundation has 40 passing exploration browser cases, retained with source hashes under the workspace's `creations/smoke-test/komorebi-valley-gate/`. Environment and integration changes require fresh checks here; inherited evidence is not a claim of tests performed in this repository.

## Combat

Choose **Enter the Celestial Storm** or press Xbox Menu to start the campaign. Follow the courtyard through First Gate, Sakura Court and Grand Torii in order. At a shrine, press E / X to read the inscription, equip or upgrade a weapon, or choose a trial. In shrine menus use D-pad and A, with B to close. Read gold-marked scrolls and shatter stone lanterns for shards. The four weapons differ in swing timing, reach, power and arc.

Press R / Y for chain lightning, V / left-stick click in the air for Ascension, Alt / B for a directional dash, and K / LB in the air for a ground slam. Use Space / A for a high jump and J / RB for airborne follow-ups. At the First Gate, guard just before each bell pulse to win the parry trial. At Sakura Court, pass four rings without landing using jumps, Ascension and refreshed air dashes. The guardian wards off damage during windups. Jump or dash clear of the marked circle and strike during the counter window. Aerial attacks and spells cast in the air are more effective during that window.

Campaign progression, weapon ranks, lore, and trial rewards save to the same browser origin. The Veiled Pass remains available through the shrine menu. The storage keys for each mode are separate from their transient combat state.

Optional spirit-warden duels wait in the cedar courtyard, off the lantern path. Press J / Xbox RB for light attacks, K / LB for heavy attacks (hold to charge), Alt / B to dodge, Q / LT to guard, and F / right-stick click to lock a target. A fresh guard just before impact parries. Space / A jumps; one light follow-up is available per jump. RT continues to sprint.

Buffer the next strike late in recovery. Light-light-light ends in a sweep; light-light-heavy launches; light-heavy and heavy-light produce mixed finishers; heavy-heavy crushes. Stamina limits attack, guard and dodge frequency. Defeated wardens and vitality persist in browser storage. If defeated, press A / Space or the on-screen return button; restored lanterns and victories remain.

`npm run test:unit` checks deterministic timing, damage, launch/landing physics, inputs, persistence and atmosphere. `npm run test:combat` drives combat through the browser against BASE_URL (default documented in its script). Both combat and exploration regressions are required before release. The Combat guide in the game describes the full control scheme.

## Authored character

The meter-scale pilgrim model is retained as `src/assets/pilgrim.glb`, with measurements beside it. Regenerate its source, GLB and review renders with Blender: `blender --background --python tools/create_pilgrim.py -- --output <review-directory> --height 1.8`. The original interactive review and asset-validation evidence remain in workspace `creations/komorebi-valley/version-002/`. This is a game asset, not an approved print model.
