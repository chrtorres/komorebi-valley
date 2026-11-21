# Valley delivery contract

Work on `feature/*` branches. A feature is ready for local integration only after `npm run gate:valley` passes and another engineer reviews its implementation and tests. Keep review findings and captured evidence outside the repository under `creations/smoke-test/`. Resolve blockers and rerun affected tests before committing. Remote pushes require the Git workflow's final review gate.

## Product acceptance

The four hard functional requirements are Xbox controller support, third-person playable-character view, persistent saves across reloads, and detailed combat with related physics. Their authoritative agent instructions are in AGENTS.md. Modern AAA-comparable visual quality remains an additional qualitative target.

| Requirement | Automated coverage | Required additional evidence |
| --- | --- | --- |
| Xbox controller | Discovery profiles, activation/denial states, exploration/combat input, reconnect | Physical Xbox discovery and end-to-end play on the user's browser; mocked standard Gamepad input is insufficient |
| Third person | Character/camera contract, follow/orbit/lock and obstruction cases | Inspect settled gameplay frames |
| Persistent saves | Stored bytes, malformed/denied storage, reload, lantern/defeat/respawn retention | Same-origin player preview and explicit failure reporting |
| Combat and physics | Combo phases, timing, arc/range, launch/landing, inertia, capsule separation, guard/parry/dodge | Rendered encounters and controller handling |

The user confirmed the physical Xbox controller was back after a disconnect. Retest new campaign controls on hardware before release. Automated Xbox tests inject a standard-mapped Gamepad.

Single-player, third-person exploration through a Japanese mountain valley. Seven lantern restorations form the main journey. Keyboard and standard-mapped Xbox controllers support movement, orbit camera, jumping, running, and interaction. Holding jump slows descent and catches mountain thermals. Contemplation gives a wider scenic view. Progress, position, and camera yaw persist across reloads on the same browser origin. Malformed saves recover safely and storage failure must remain visible.

Visual targets include layered mountain silhouettes, golden-hour lighting and fog, weathered paths and torii, varied vegetation, koi water, drifting petals, an authored traveler, and restrained bloom. These are art-direction targets; automated checks do not establish equivalence to a AAA game's assets, animation, or rendering.

Combat acceptance adds buffered light/heavy chains, charging, launchers and one aerial follow-up per jump, stamina, timed guard/parry, dodge invulnerability, target lock, telegraphed enemy AI, knockback/gravity, capsule separation, death/respawn, and saved defeated identities. Keyboard taps are latched between rendered frames. The visible character and attack arc use the same captured swing facing. Inactive tabs save and pause simulation.

## Regression gate

`npm run gate:valley` runs unit tests, a production build, and exploration, combat, Celestial Storm, Kōhaku pond, and Watchkeeper browser checks against a dedicated temporary origin. Keep the current player preview on port 5191 to retain its browser saves.

CI runs the same gate and uploads screenshots and results. A local pass does not establish remote CI success. The fresh Valley repository contains the game and its tests; earlier Agent Town experiments and evidence remain outside this repository.

## Celestial Storm verification

- `storm-campaign.js` coordinates progression, the aerial resource budget, the two trial state machines, and guardian telegraph/counter phases. It uses the existing fixed-step combat core for melee, hits and enemy physics.
- `storm-runtime.js` owns shrine menus and input routing, campaign storage, character movement requests, and procedural sound. `storm-scene.js` and `storm-effects.js` generate and animate the campaign environment and effects.
- `npm run test:storm` opens the application in Chromium and exercises game inputs and menus. Set `BASE_URL` to the running preview and `EVIDENCE_DIR` outside the repository to retain results and captures. Unit tests also exercise both repeatable trials and guardian victory, defeat and reload.
- Physical Xbox release check covers Menu to enter, X to open a shrine, D-pad and A to equip, B to exit the menu, sticks to move/look, RB/LB melee, Y lightning, aerial B and left-stick click, and LT to parry. Verify controller reconnect and recheck movement and one combat action afterward.


## Kōhaku pond

The stepping stones west of the main path lead to the pond at world coordinates
`(-15, -8)`. The same habitat appears in both exploration modes. Move or turn
with the existing keyboard or Xbox controls. Entering the shallows disturbs the
water, and reduced-motion mode holds the fish and surface in a still pose.

The game uses the version 008 pond study’s rig, textures, cranial bindings and
swimming simulation. The browser loads the compressed GLB on approach. The
basin shares its elevation with the player, and the water samples the wave field
for wakes and adjusts its reflection palette in Celestial Storm. The pond
remains playable if the model fails to load. Asset hash and the offline
conversion commands are in `src/assets/kohaku-metadata.json`.

Run `node scripts/koi-browser.mjs` against the player preview, or run the full
delivery gate against a production build. The pond suite checks the shipped GLB,
visible pigment and rig movement, traversal and save reload at the shore, Storm
lighting and clear tree placement, asset recovery, and reduced motion.


## Watchkeeper and sprint leaps

The Veiled Pass opens with seven extinguished signal lanterns. The Watchkeeper
is a meter-scale, dō-maru inspired character used in the pass and Celestial
Storm. The authored GLB provides hip, knee, ankle, elbow, grip and skirt pivots.
The pose follows the player’s movement and current combat phase. The game still
owns translation, collision and saves.

In the pass, hold Shift or Xbox RT while moving and press Space or A to make a
sprint leap. The launch boost fades and follows the current steering input.
Release jump to land without gliding. Celestial Storm has its own aerial
movement controls. Run `node scripts/warrior-browser.mjs` against the player
preview to check the loaded rig, grip attachment, keyboard and simulated Xbox
leaps, controller disconnect in midair, and position after reload.

## Watchkeeper vault route

The side path east of the first torii leads over two low stone walls to a
watch marker. Move toward the face of a wall and press Space or Xbox A to
vault. The same input remains a jump in open ground and becomes a sprint
leap when running. Read the marker with E or Xbox X.

The route's two walls block movement and support landings. The vault clears
the character's collision radius and runs from either side. Journey saves
taken mid-vault use the safe launch side. Saves made after landing retain
the landing position, including when standing on a wall cap. The production gate checks
keyboard and simulated Xbox traversal, wall collision, and saves.

A jump pressed together with combat input remains a combat jump. The test
suite checks an angled jump and aerial light attack at 240 Hz. On reconnect,
release A before using it to jump or vault again.

## Watchkeeper appearance and animation

The v005 GLB uses UV-mapped skin, eyes and brows, with a facial blink target.
Lacquer, iron, linen and woven armor have embedded color and normal maps.
Exploration wears the forged helmet and mask. Celestial Storm fits the
indigo hood to the animated head and shows the face, with a continuous cloth
scarf that follows movement. The asset's provenance and runtime hash are
in `src/assets/warrior-metadata.json`.

The stride solver rolls the support foot around the heel or toe, holds its
contact through changes of pace, and adjusts the next swing to the new speed.
The head counterbalances the chest. The vault uses distinct reach, tuck and
landing poses over the existing collision path. An interruption fades the
vault pose while the attack starts on its regular combat tick. Ground stance
anchors track both horizontal axes. The legs reach sideways during strafes,
the pelvis shifts toward the supporting leg, and the torso responds to
acceleration and braking. Free traversal eases the visible heading through
turns. Locked, guarded and committed actions align with gameplay facing.
The procedural feet use the player's local floor plane. The game owns
traversal, hit detection and saves.

The production gate checks the served asset bytes, live eyelid motion, the
hood and mask changeover, airborne cloth geometry, combat grip parenting,
and the existing keyboard, simulated Xbox and save regressions. Motion
coverage includes lateral foot contacts and reversal at 20 and 60 Hz and an
in-game synthetic stick turn through the shipped model. Visual review
uses studio close-ups and gameplay captures. End-to-end physical Xbox play
remains a separate acceptance check.

## Cinematic graphics and Ultra 4K

The Graphics button cycles through Balanced, Cinematic, and Ultra 4K.
Cinematic adds restrained bloom, a scene-specific color grade, and FXAA at
the physical buffer size. Devices without HDR render targets use direct tone mapping. Ultra 4K uses the same pipeline up to 3840 × 2160,
fitting the viewport aspect ratio and the WebGL device limits. A 16:9
viewport can render UHD on a smaller display. The Graphics button tooltip
reports the actual render size. Deployment can open the same save origin
with `?quality=ultra-4k` to start in that mode.

The Veiled Pass uses depth-layered dawn mist, textured ground and vegetation,
and beveled stone and joinery. Celestial Storm uses a separate sky and grade,
rough wet stone, and softer effect edges. Camera composition eases into
contemplation and returns promptly to traversal. Reduced motion removes the
camera easing. Orbit input and the obstacle solve continue on every frame.

On a WebGL-capable GPU run `BROWSER_GPU=1 npm run gate:valley` to include
the UHD production check. The gate reads the active drawing buffer and
post-processing targets, exercises orbit, and captures a 3840 × 2160 frame.
CI without a hardware request runs the tier, cap, and gameplay checks.
Set `VALLEY_VERIFY_4K=1` to run the full UHD check with software rendering.

## Sakura plantings

The Veiled Pass and Celestial Storm use the authored Sakura v002 Somei
Yoshino, Kanzan, and Shidarezakura GLBs from the local Sakura study. Solitary
trees mark arrival points and gates. Mixed pairs and trios frame the koi
shore and shrine approaches. The trees share the scene's lighting and ground
height. Matching pink understory accents and fallen petals tie the plantings
into the cedar and bamboo landscape.

The trees stream from same-origin Draco and WebP assets. At most two use
full detail near the player. A limited number of nearby trees retain their
main limbs and sampled crowns, while distant trees use lighter silhouettes.
The dormant campaign's plantings stay hidden. Branch sway follows the
graphics motion preference. The sakura browser suite compares served asset
bytes and checks placement, detail limits, and mode switching. The existing
pond browser check also verifies dry roots.
