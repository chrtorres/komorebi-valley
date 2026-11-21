import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const gameURL = process.env.BASE_URL || "http://127.0.0.1:5191/";
const evidence = process.env.EVIDENCE_DIR || join(tmpdir(), "valley-warrior");
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  args: process.env.BROWSER_GPU === "1"
    ? ["--no-sandbox", "--use-gl=angle", "--use-angle=gl"]
    : ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const checks = [];
const errors = [];
const record = (name, result) => {
  assert(result, name);
  checks.push(name);
  console.log("PASS " + name);
};
const shot = name => page.screenshot({ path: join(evidence, name + ".png") });
page.on("pageerror", error => errors.push(error.message));
page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
const source = await readFile(new URL("../src/assets/warrior.glb", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

try {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.testPad = { connected: false, mapping: "standard", index: 0, buttons, axes: [0, 0, 0, 0] };
    Object.defineProperty(navigator, "getGamepads", { value: () => window.testPad.connected ? [window.testPad] : [] });
  });
  const fetched = page.waitForResponse(response => /\/warrior(?:-[^/]+)?\.glb$/.test(response.url()));
  await page.goto(gameURL);
  const response = await fetched;
  record("Game served the committed warrior GLB", response.ok() && sha(await response.body()) === sha(source));
  const ready = () => page.waitForFunction(() => window.valley?.player.getObjectByName("ValleyWarrior"));
  await ready();
  const snapshot = () => page.evaluate(() => {
    const { player, camera, world } = valley;
    const get = name => player.getObjectByName(name);
    const point = get("WarriorPelvis").position.clone();
    return {
      p: player.position.toArray(), clearance: player.position.y - world.height(player.position.x, player.position.z),
      knee: get("LeftShin").rotation.x, hip: get("WarriorPelvis").position.y,
      scale: get("ValleyWarrior").scale.x,
      footing: get("LeftFoot").getWorldPosition(point).y - player.position.y,
      grip: get("RightGrip").children.some(node => node.visible),
      camera: camera.position.distanceTo(player.position),
    };
  });
  record("The Veiled Pass heading survives startup", await page.locator("header h1").textContent() === "The Veiled Pass");
  const start = await snapshot();
  record("Third-person camera and warrior visible", start.camera > 3);
  record("Runtime model uses authored scale", Math.abs(start.scale - 1.8/1.652) < .00001);
  record("Idle foot meets the root's rest plane", Math.abs(start.footing - .07*start.scale) < .006);
  record("Combat weapon is parented to the grip", start.grip);
  record("Exploration shows the kasa, face wrap and head wrap and loads textured human skin", await page.evaluate(() => {
    const get = name => valley.player.getObjectByName(name);
    const face = get("WarriorFace");
    return get("WarriorHelmet").visible && get("RoninKasa") && get("WarriorMask").visible &&
      get("WarriorStormHood").visible && face.material.map.image.width >= 1024 &&
      face.material.normalMap.image.width >= 512 && get("WarriorEyes").material.map.image.width >= 512;
  }));
  const blink = await page.evaluate(() => new Promise(resolve => {
    const face = valley.player.getObjectByName("WarriorFace");
    const index = face.morphTargetDictionary.Blink;
    let closed = false;
    let frameRequest;
    const watchdog = setTimeout(() => {
      cancelAnimationFrame(frameRequest);
      resolve(false);
    }, 180_000);
    function sample() {
      const value = face.morphTargetInfluences[index];
      if (closed && value < .01) {
        clearTimeout(watchdog);
        resolve(true);
        return;
      }
      closed ||= value > .75;
      frameRequest = requestAnimationFrame(sample);
    }
    frameRequest = requestAnimationFrame(sample);
  }));
  record("The exact in-game face closes and reopens its eyelids", blink);
  // A real leap needs a run-up: sprint about 2.5 s to near top speed, then jump.
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  const takeoff = await snapshot();
  await page.keyboard.press("Space");
  // 3.3 m/s takeoff: the feet clear 0.4 m about 0.17 s in and peak near 0.55 m.
  await page.waitForFunction(() => {
    const { player, world } = valley;
    return player.position.y - world.height(player.position.x, player.position.z) > .4;
  });
  const airborne = await snapshot();
  record("Keyboard sprint jump clears the ground", airborne.clearance > .4 && airborne.clearance < .62);
  record("Sprint leap folds the knee visibly", airborne.knee > start.knee + .30);
  await shot("game-leap");
  await page.waitForFunction(() => {
    const { player, world } = valley;
    return player.position.y - world.height(player.position.x, player.position.z) < .02;
  });
  await page.keyboard.up("w");
  await page.keyboard.up("ShiftLeft");
  const landed = await snapshot();
  // Flight at about 7 m/s for 0.67 s: roughly 4-5 m from takeoff to touchdown.
  record("Running leap displaces the player along the pass", takeoff.p[2] - landed.p[2] > 4);
  record("Player lands at the actual terrain height", landed.clearance < .03);

  await page.evaluate(() => {
    testPad.connected = true;
    testPad.axes[1] = -1;
    testPad.buttons[7] = { pressed: true, value: 1 };
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => { testPad.buttons[0] = { pressed: true, value: 1 }; });
  await page.waitForFunction(() => {
    const { player, world } = valley;
    return player.position.y - world.height(player.position.x, player.position.z) > .60;
  });
  const padAir = await snapshot();
  record("Synthetic Xbox RT and A trigger the leap", padAir.knee > start.knee + .25);
  await page.evaluate(() => { testPad.connected = false; });
  const disconnected = await snapshot();
  await page.waitForTimeout(130);
  const afterDisconnect = await snapshot();
  record("Disconnect cancels forward drive during a sprint leap",
    Math.hypot(afterDisconnect.p[0] - disconnected.p[0], afterDisconnect.p[2] - disconnected.p[2]) < .18);
  await page.waitForFunction(() => {
    const { player, world } = valley;
    return player.position.y - world.height(player.position.x, player.position.z) < .02;
  });
  await page.evaluate(() => valley.save());
  const saved = await snapshot();
  await page.reload();
  await ready();
  const restored = await snapshot();
  record("Save reload preserves the landing location", Math.hypot(...restored.p.map((v, i) => v - saved.p[i])) < .03);
  await shot("game-reloaded");
  const turn = await page.evaluate(() => new Promise((resolve, reject) => {
    const { player } = valley;
    let visual = player.getObjectByName("ValleyWarrior");
    while (visual.parent !== player) visual = visual.parent;
    const soles = ["LeftFoot", "RightFoot"].map(name => player.getObjectByName(name));
    const point = player.position.clone();
    const trace = [];
    const watchdog = setTimeout(() => {
      testPad.connected = false;
      reject(Error("Timed out sampling the rendered turn"));
    }, 45_000);
    testPad.connected = true;
    testPad.axes[1] = -1;
    let elapsed = 0, last;
    function sample(now) {
      elapsed += last === undefined ? 0 : Math.min(.05, (now - last) / 1000);
      last = now;
      if (elapsed >= .24) testPad.axes = [1, 0, 0, 0];
      trace.push({
        elapsed, heading: player.rotation.y, lag: visual.rotation.y,
        position: player.position.toArray(),
        boots: soles.map(foot => foot.getWorldPosition(point).toArray()),
      });
      // A friction-limited 90° cut, with leg force easing in, settles about 1 s after the stick turns.
      if (elapsed < 1.3) requestAnimationFrame(sample);
      else {
        clearTimeout(watchdog);
        testPad.connected = false;
        resolve(trace);
      }
    }
    requestAnimationFrame(sample);
  }));
  await writeFile(join(evidence, "ground-turn.json"), JSON.stringify(turn, null, 2));
  // Free running curves the travel: the stick bends the path at once, facing follows the
  // body's velocity (no side-slip), and the visible warrior never lags far behind it.
  const turnIndex = turn.findIndex(frame => frame.elapsed >= .24);
  const firstTurn = turn[turnIndex];
  const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
  const responded = turn.slice(turnIndex).find(frame => frame.elapsed <= firstTurn.elapsed + .1 &&
    frame.position[0] - firstTurn.position[0] > .001);
  // Gameplay facing never turns faster than a planted pivot (10 rad/s) in any frame.
  const pivotOk = (trace) => trace.slice(1).every((frame, i) =>
    Math.abs(angle(frame.heading - trace[i].heading)) <= 10 * (frame.elapsed - trace[i].elapsed) + .02);
  const [a, b] = turn.slice(-2);
  const travel = Math.atan2(b.position[0] - a.position[0], b.position[2] - a.position[2]);
  record("Xbox stick direction changes root travel immediately and eases the visible warrior through a turn",
    firstTurn && responded && pivotOk(turn) &&
    Math.max(...turn.map(frame => Math.abs(frame.lag))) < .6 && Math.abs(turn.at(-1).lag) < .02 &&
    Math.abs(angle(b.heading - travel)) < .2 &&
    turn.at(-1).position[0] - firstTurn.position[0] > .5);
  record("The authored boots continue articulating through the turn",
    new Set(turn.map(({ boots, position }) => (boots[0][1] - position[1]).toFixed(3))).size >= 5);
  await shot("game-ground-turn");
  // Reversal at run speed: brake, then pivot through 180° without snapping the facing.
  const reversal = await page.evaluate(() => new Promise((resolve, reject) => {
    const { player } = valley, trace = [];
    const watchdog = setTimeout(() => { testPad.connected = false; reject(Error("Timed out sampling the reversal")); }, 45_000);
    testPad.connected = true;
    testPad.axes = [0, -1, 0, 0];
    let elapsed = 0, last;
    function sample(now) {
      elapsed += last === undefined ? 0 : Math.min(.05, (now - last) / 1000);
      last = now;
      if (elapsed >= 1.2) testPad.axes = [0, 1, 0, 0];
      trace.push({ elapsed, heading: player.rotation.y, position: player.position.toArray() });
      if (elapsed < 2.8) requestAnimationFrame(sample);
      else { clearTimeout(watchdog); testPad.axes = [0, 0, 0, 0]; testPad.connected = false; resolve(trace); }
    }
    requestAnimationFrame(sample);
  }));
  await writeFile(join(evidence, "ground-reversal.json"), JSON.stringify(reversal, null, 2));
  const flip = reversal.findIndex(frame => frame.elapsed >= 1.2);
  const [r0, r1] = reversal.slice(-2), back = reversal[flip];
  const finalTravel = Math.atan2(r1.position[0] - r0.position[0], r1.position[2] - r0.position[2]);
  record("A run-speed reversal brakes, pivots at a bounded rate and runs back the other way",
    flip > 0 && pivotOk(reversal) &&
    Math.abs(angle(finalTravel - reversal[flip - 1].heading)) > 2.8 &&
    Math.abs(angle(r1.heading - finalTravel)) < .2 &&
    // The stop is not instant: the body carries on past the flip point before coming back.
    reversal.slice(flip).some(frame => Math.hypot(frame.position[0] - back.position[0], frame.position[2] - back.position[2]) > .3));
  await page.evaluate(() => {
    const enemy = valley.state.combat.enemies.find(enemy => enemy.health > 0);
    const z = enemy.z - 6;
    valley.player.position.set(enemy.x, valley.world.height(enemy.x, z), z);
  });
  await page.keyboard.press("f");
  await page.waitForFunction(() => {
    const delta = valley.player.rotation.y + Math.PI - valley.state.yaw;
    return valley.state.combat.targetId && Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < .12;
  });
  const strafe = await page.evaluate(() => new Promise((resolve, reject) => {
    const { player } = valley;
    let visual = player.getObjectByName("ValleyWarrior");
    while (visual.parent !== player) visual = visual.parent;
    const boots = ["LeftFoot", "RightFoot"].map(name => player.getObjectByName(name));
    const point = player.position.clone();
    const trace = [];
    const watchdog = setTimeout(() => reject(Error("Timed out sampling locked movement")), 45_000);
    testPad.axes = [0, 0, 0, 0];
    testPad.connected = true;
    let elapsed = 0, last;
    function sample(now) {
      elapsed += last === undefined ? 0 : Math.min(.05, (now - last) / 1000);
      last = now;
      const heading = player.rotation.y;
      trace.push({
        elapsed, heading, lock: valley.state.combat.targetId, lag: visual.rotation.y,
        input: testPad.axes[0], root: player.position.toArray(),
        soles: boots.map(foot => foot.localToWorld(point.set(0, -.07, 0)).toArray()),
      });
      testPad.axes[0] = elapsed < .45 ? 1 : -1;
      if (elapsed < .90) requestAnimationFrame(sample);
      else {
        clearTimeout(watchdog);
        testPad.connected = false;
        resolve(trace);
      }
    }
    requestAnimationFrame(sample);
  }));
  const lateralTravel = (before, after) => {
    const [dx, , dz] = after.root.map((v, i) => v - before.root[i]);
    return Math.cos(after.heading) * dx - Math.sin(after.heading) * dz;
  };
  const reverseIndex = strafe.findIndex(frame => frame.input === -1);
  record("An actual combat lock preserves visible facing through side travel and an immediate stick reversal",
    reverseIndex > 1 && strafe.every(frame => frame.lock && Math.abs(frame.lag) < .0001) &&
    lateralTravel(strafe[0], strafe[1]) * lateralTravel(strafe[reverseIndex - 1], strafe[reverseIndex]) < 0);
  const onFloor = (frame, boot) => Math.abs(frame.soles[boot][1] - frame.root[1]) < .007;
  // The first sample records the stationary pose before any strafe input.
  const pairs = strafe.slice(1).filter(frame => onFloor(frame, 0) && onFloor(frame, 1));
  const supports = strafe.slice(1).flatMap((frame, index) => frame.soles.flatMap((sole, boot) => {
    const prior = strafe[index];
    if (!onFloor(frame, boot) || !onFloor(prior, boot)) return [];
    return [Math.hypot(sole[0] - prior.soles[boot][0], sole[2] - prior.soles[boot][2])];
  }));
  record("Locked strafe keeps grounded boots ordered and support feet stable near the floor",
    pairs.length > 0 && pairs.every(({ heading, soles: [left, right] }) =>
      (right[0] - left[0]) * Math.cos(heading) - (right[2] - left[2]) * Math.sin(heading) > .035) &&
    supports.filter(drift => drift < .025).length >= 4);
  await writeFile(join(evidence, "locked-strafe.json"), JSON.stringify(strafe, null, 2));
  await shot("game-locked-strafe");
  await page.locator("#storm-enter").click();
  await page.waitForFunction(() => window.valley?.state.storm.active &&
    valley.player.getObjectByName("StormWeaponAttachment")?.parent?.name === "RightGrip");
  record("Storm keeps the ronin's kasa, face wrap and head wrap; its own scarf gives way", await page.evaluate(() => {
    const get = name => valley.player.getObjectByName(name);
    return get("WarriorStormHood").parent.name === "WarriorHead" &&
      get("WarriorStormHood").visible && get("WarriorHelmet").visible &&
      get("WarriorMask").visible && !get("StormFallbackCostume").visible &&
      !get("StormScarfFabric").visible && valley.player.parent.getObjectByName("RoninScarfTails").visible;
  }));
  // The crimson tails are world-space cloth: the first row must stay on the scarf anchor,
  // seated on the neck wrap's outer surface (about 9 cm behind it, 4-5 cm to the side).
  const scarf = () => page.evaluate(() => {
    const tails = valley.player.parent.getObjectByName("RoninScarfTails");
    const anchor = valley.player.getObjectByName("RoninScarfAnchor").getWorldPosition(valley.player.position.clone());
    const vertices = tails.children.flatMap(mesh => Array.from(mesh.geometry.attributes.position.array));
    const gaps = tails.children.map(mesh => {
      const a = mesh.geometry.attributes.position;
      const centre = valley.player.position.clone().fromBufferAttribute(a, 1);
      return centre.distanceTo(anchor);
    });
    return { vertices, collarGap: Math.max(...gaps) };
  });
  const scarfRest = await scarf();
  record("Storm attaches its weapon to the warrior grip", await page.evaluate(() => {
    const weapon = valley.player.getObjectByName("StormWeaponAttachment");
    return weapon.position.length() < .001;
  }));
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const player = valley.player;
    return player.position.y - valley.world.height(player.position.x, player.position.z) > .65;
  });
  record("Storm keeps the airborne handle anchored", await page.evaluate(() =>
    valley.player.getObjectByName("StormWeaponAttachment").position.length() < .001));
  const scarfAir = await scarf();
  record("The continuous scarf follows movement with finite cloth geometry",
    scarfAir.vertices.every(Number.isFinite) &&
    scarfRest.vertices.some((value, index) => Math.abs(value - scarfAir.vertices[index]) > .01));
  record("The scarf stays attached to the collar through takeoff",
    scarfRest.collarGap < .14 && scarfAir.collarGap < .14);
  await shot("game-storm-leap");
  record("No browser errors", errors.length === 0);
} finally {
  await writeFile(join(evidence, "checks.json"), JSON.stringify({ checks, errors, assetSha256: sha(source) }, null, 2));
  await browser.close();
}
