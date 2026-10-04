const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const projectRoot = path.resolve(__dirname, "..");
const serverEnvPath = path.join(projectRoot, "server", ".env");
const rootEnvPath = path.join(projectRoot, ".env");

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
}
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

const serverPath = path.join(projectRoot, "server", "index.js");
const defaultPythonUrl = "http://127.0.0.1:8000";
const aiServiceUrl = (process.env.AI_SERVICE_URL || defaultPythonUrl).replace(/\/+$/, "");
const pythonServiceUrl = new URL(aiServiceUrl);
const isLocalPython = ["localhost", "127.0.0.1", "::1"].includes(pythonServiceUrl.hostname);
const aiPort = process.env.PYTHON_AI_PORT || pythonServiceUrl.port || "8000";
const watchServer = process.argv.includes("--watch");

if (!["http:", "https:"].includes(pythonServiceUrl.protocol)) {
  throw new Error("AI_SERVICE_URL must be an HTTP or HTTPS URL.");
}

const children = new Set();
let shuttingDown = false;

function getPythonCommand() {
  if (process.env.PYTHON_EXECUTABLE) {
    return { command: process.env.PYTHON_EXECUTABLE, args: [] };
  }
  if (process.env.PYTHON) {
    const args = process.env.PYTHON.toLowerCase() === "py" ? ["-3"] : [];
    return { command: process.env.PYTHON, args };
  }

  const virtualEnvs = [
    path.join(projectRoot, ".venv"),
    path.join(projectRoot, "analytics_api", ".venv"),
  ];
  for (const virtualEnv of virtualEnvs) {
    const executable = path.join(
      virtualEnv,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python"
    );
    if (fs.existsSync(executable)) return { command: executable, args: [] };
  }
  return { command: process.platform === "win32" ? "py" : "python3", args: process.platform === "win32" ? ["-3"] : [] };
}

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

function startChild(command, args, label) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(`[ShopSense] Could not start ${label}: ${error.message}`);
    stopChildren(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(
        `[ShopSense] ${label} stopped${signal ? ` (${signal})` : ` (exit ${code ?? "unknown"})`}.`
      );
      stopChildren(code && code > 0 ? code : 1);
    }
  });
  return child;
}

async function isPythonHealthy() {
  try {
    const response = await fetch(new URL("/health", aiServiceUrl), {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.status === "ok";
  } catch {
    return false;
  }
}

async function waitForPython(child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (shuttingDown || child.exitCode !== null) {
      throw new Error(
        "The Python AI service exited before it became ready. Check the Python startup output above."
      );
    }
    if (await isPythonHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "The Python AI service did not become healthy within 45 seconds. Install analytics_api requirements and check its startup output."
  );
}

async function main() {
  let pythonChild = null;

  if (isLocalPython) {
    if (await isPythonHealthy()) {
      console.log(`[ShopSense] Reusing Python AI service at ${aiServiceUrl}`);
    } else {
      console.log("[ShopSense] Starting the Python AI service...");
      const pythonCommand = getPythonCommand();
      pythonChild = startChild(
        pythonCommand.command,
        [...pythonCommand.args, "-m", "uvicorn", "analytics_api.main:app", "--host", "127.0.0.1", "--port", String(aiPort)],
        "Python AI service"
      );
      process.env.AI_SERVICE_URL = aiServiceUrl;
      await waitForPython(pythonChild);
      console.log(`[ShopSense] Python AI service is ready at ${aiServiceUrl}`);
    }
  } else {
    console.log(`[ShopSense] Using remote Python AI service at ${aiServiceUrl}`);
  }

  if (shuttingDown) return;
  const nodeArgs = watchServer ? ["--watch", serverPath] : [serverPath];
  startChild(process.execPath, nodeArgs, "ShopSense API");
}

process.once("SIGINT", () => stopChildren(0));
process.once("SIGTERM", () => stopChildren(0));

main().catch((error) => {
  console.error(`[ShopSense] Startup failed: ${error.message}`);
  stopChildren(1);
});
