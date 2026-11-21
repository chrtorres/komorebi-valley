# Komorebi Valley

Playable transformation of the Agent Town fork. Start with `npm install`, `npm run dev -- --port 5180`, then open http://127.0.0.1:5180.

Explore in third person, kindle seven lanterns with E or Xbox X, jump with Space or A, hold jump to slow descent, run with Shift or RT. Drag to turn the camera or use the right stick. Left stick or WASD moves the pilgrim. Connect an Xbox pad and press a button to expose it to the browser.

Progress and position autosave every five seconds, on restoration, on page exit, and using Save journey. Saves are local to this browser and origin. Keep the same port; clearing browser storage clears saves. Storage failures appear next to the save button.

The modern scene entry is `src/valley-next.js`; the initial prototype remains in `src/valley.js`. The world uses batched procedural geometry, generated surface textures, instanced foliage, pond koi, mountain ridges, petals, and wind-current markers. The traveler is a local Blender-authored GLB with named limb pivots. Balanced graphics avoids bloom; cinematic graphics adds bloom and higher pixel density on high-DPI screens.

Press C / Xbox Y to contemplate. Movement returns to traversal. Hold jump while airborne over the spiraling currents to gain lift, up to a bounded altitude; release to descend. Optional sound supplies a quiet wind bed and restoration tones.

Run `npm run gate:valley` before integrating any feature. It builds the production app, runs unit regressions, and drives isolated exploration and combat browser journeys with screenshots. See DEVELOPMENT.md for the review contract. Physical Xbox handling and hardware GPU performance remain human acceptance checks. This is a stylized browser game; AAA equivalence has not been established. Static camera proxies cover temple walls and roofs, tree trunks, and torii posts; foliage can still obscure a view. Combat uses deterministic kinematic capsules, hit arcs, knockback and gravity rather than a general rigid-body or ragdoll engine.
