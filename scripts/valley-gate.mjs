import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preview } from "vite";
const evidence = resolve(
  process.env.EVIDENCE_DIR || "../creations/smoke-test/komorebi-valley-gate",
);
await mkdir(evidence, { recursive: true });
const report = (data) =>
  writeFile(
    `${evidence}/gate.json`,
    JSON.stringify({ ...data, time: new Date().toISOString() }, null, 2),
  );
let graphics = process.env.BROWSER_GPU === "1" || process.env.VALLEY_VERIFY_4K === "1"
  ? "pending"
  : "skipped (set BROWSER_GPU=1 for hardware or VALLEY_VERIFY_4K=1 for software)";
async function run(command, args, env = {}) {
  return new Promise((done, reject) => {
    const p = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? done() : reject(Error(`${command} exited ${code}`)),
    );
  });
}
let server;
let baseURL;
await report({ passed: false, status: "running", graphics });
try {
  await run("npm", ["run", "test:unit"]);
  await run("npm", ["run", "build"]);
  server = await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  console.log(`Valley gate preview at ${baseURL}`);
  if (graphics === "pending") {
    graphics = "running";
    await run(process.execPath, ["scripts/valley-graphics-browser.mjs"], {
      BASE_URL: baseURL,
      EVIDENCE_DIR: `${evidence}/graphics`,
    });
    graphics = "passed";
  } else {
    console.log(`Ultra 4K production check ${graphics}`);
  }
  for (const suite of ["sakura", "storm", "valley", "combat", "koi", "warrior", "vault"]) {
    const script = suite === "valley" ? "valley-regression" : `${suite}-browser`;
    await run(process.execPath, [`scripts/${script}.mjs`], {
      BASE_URL: baseURL,
      EVIDENCE_DIR: suite === "valley" ? evidence : resolve(evidence, suite),
    });
  }
  await report({ passed: true, status: "complete", baseURL, graphics });
} catch (error) {
  if (graphics === "running") graphics = "failed";
  await report({ passed: false, status: "failed", baseURL, graphics, error: error.message });
  throw error;
} finally {
  await server?.close();
}
