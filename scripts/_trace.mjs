import { chromium } from "playwright";
const [fx, fz, fh, tx, tz, jd] = process.argv.slice(2).map(Number);
const b = await chromium.launch({ args: ["--no-sandbox", "--use-gl=angle", "--use-angle=gl"] });
const page = await b.newPage();
await page.addInitScript(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  window.testPad = { connected: true, mapping: "standard", index: 0, buttons, axes: [0, 0, 0, 0] };
  Object.defineProperty(navigator, "getGamepads", { value: () => [window.testPad] });
});
await page.goto("http://127.0.0.1:5193/?title=0");
await page.waitForFunction(() => window.valley?.state.frames > 30 && window.valley.player.getObjectByName("ValleyWarrior"));
const trace = await page.evaluate(async ([fx, fz, fh, tx, tz, jd]) => {
  const { player, world } = window.valley;
  player.position.set(fx, world.height(fx, fz) + fh, fz);
  await new Promise(r => setTimeout(r, 700));
  const pad = window.testPad, out = [];
  let jumped = false;
  const topTo = world.height(tx, tz);
  return await new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => {
      const st = window.valley.state, [px, py, pz] = st.position;
      const d = Math.hypot(tx - px, tz - pz);
      const c = Math.cos(st.yaw), s = Math.sin(st.yaw), dx = (tx - px) / d, dz = (tz - pz) / d;
      pad.axes[0] = c * dx - s * dz; pad.axes[1] = s * dx + c * dz;
      pad.buttons[7] = { pressed: true, value: 1 };
      if (!jumped && st.grounded && d < jd) { jumped = true; pad.buttons[0] = { pressed: true, value: 1 }; setTimeout(() => pad.buttons[0] = { pressed: false, value: 0 }, 90); }
      out.push([Math.round(performance.now() - t0), px.toFixed(2), (py - topTo).toFixed(2), pz.toFixed(2), st.grounded ? "G" : "a", st.parkour.mantle ? "M" : "", st.parkour.kickUsed ? "K" : "", st.vertical.toFixed(2), d.toFixed(2)]);
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else { pad.axes[0] = pad.axes[1] = 0; resolve(out); }
    };
    tick();
  });
}, [fx, fz, fh, tx, tz, jd]);
for (const r of trace.filter((_, i) => i % 3 === 0)) console.log(r.join(" "));
await b.close();
