const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const venvPython = resolve(
  projectRoot,
  ".venv",
  isWindows ? "Scripts/python.exe" : "bin/python",
);
const python = process.env.PYTHON || (existsSync(venvPython) ? venvPython : "python");
const viteEntry = resolve(projectRoot, "client/node_modules/vite/bin/vite.js");
const children = [];
let stopping = false;

function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[ShopSense] Could not start ${label}: ${error.message}`);
    if (label === "API" && error.code === "EACCES") {
      console.error("[ShopSense] The Python virtual environment is inaccessible. Recreate it with the setup commands in README.md.");
    }
    stopChildren(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (code !== 0 || signal) {
      console.error(`[ShopSense] ${label} stopped (${signal || `exit ${code}`}).`);
      stopChildren(code || 1);
    }
  });
  return child;
}

if (!existsSync(viteEntry)) {
  console.error("[ShopSense] Frontend dependencies are missing. Run `npm install --prefix client` first.");
  process.exit(1);
}

console.log("[ShopSense] Starting API at http://127.0.0.1:8000 and frontend at http://localhost:5173");
start("API", python, [resolve(projectRoot, "scripts/start_api.py"), "--reload"]);
start("frontend", process.execPath, [viteEntry, "--host", "127.0.0.1"], {
  cwd: resolve(projectRoot, "client"),
});

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));
