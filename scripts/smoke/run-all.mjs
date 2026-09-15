#!/usr/bin/env node
// Runs every smoke script against a fresh API server.
//
// Each script gets its own server process on a free port, because rate
// limiters are in-memory and the scripts deliberately exhaust some of them.
// Every script runs once per API prefix (legacy unprefixed and /api/v1).
//
// Usage:
//   DATABASE_URL=postgresql://gym:gym@localhost:5432/gym_smoke npm run smoke
//
// Env:
//   DATABASE_URL          required; the database must be disposable — its name
//                         has to contain "smoke", "test" or "ci" unless
//                         SMOKE_ALLOW_ANY_DB=1
//   SMOKE_PREFIXES        comma-separated, default "legacy,v1"
//   SMOKE_ONLY            comma-separated script names, e.g. "feed,account"
//   SMOKE_SERVER          "tsx" (default, runs src/index.ts) or "dist" (node dist/index.js)
//   SMOKE_SERVER_LOG_LEVEL  server LOG_LEVEL, default "warn"
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SMOKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SMOKE_DIR, "..", "..");
const SCRIPTS = ["social", "feed", "sessions", "account"];
const PREFIXES = { legacy: "", v1: "/api/v1" };
const HEALTH_TIMEOUT_MS = 90_000;
const SCRIPT_TIMEOUT_MS = 5 * 60_000;

const fail = (message) => {
  console.error(`[smoke] ${message}`);
  process.exit(1);
};

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) fail("DATABASE_URL is required (use a disposable database, e.g. gym_smoke)");

let dbName = "";
try {
  dbName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  fail("DATABASE_URL is not a valid URL");
}
if (!/smoke|test|ci/i.test(dbName) && process.env.SMOKE_ALLOW_ANY_DB !== "1") {
  fail(
    `refusing to run against database "${dbName}" — smoke tests create users and data. ` +
      `Use a database whose name contains smoke/test/ci, or set SMOKE_ALLOW_ANY_DB=1.`,
  );
}

const selectedPrefixes = (process.env.SMOKE_PREFIXES ?? "legacy,v1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const p of selectedPrefixes) {
  if (!(p in PREFIXES)) fail(`unknown prefix "${p}" in SMOKE_PREFIXES (use legacy, v1)`);
}
const selectedScripts = process.env.SMOKE_ONLY
  ? process.env.SMOKE_ONLY.split(",").map((s) => s.trim()).filter(Boolean)
  : SCRIPTS;
for (const s of selectedScripts) {
  if (!SCRIPTS.includes(s)) fail(`unknown script "${s}" in SMOKE_ONLY (use ${SCRIPTS.join(", ")})`);
}

const serverMode = process.env.SMOKE_SERVER ?? "tsx";
const serverArgs =
  serverMode === "dist"
    ? [path.join(ROOT, "dist", "index.js")]
    : ["--import", "tsx", path.join(ROOT, "src", "index.ts")];
if (serverMode === "dist" && !fs.existsSync(serverArgs[0])) {
  fail("SMOKE_SERVER=dist but dist/index.js is missing — run `npm run build` first");
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startServer = async () => {
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, serverArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: process.env.SMOKE_SERVER_LOG_LEVEL ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => output.push(d));
  child.stderr.on("data", (d) => output.push(d));
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const res = await fetch(`${base}/ready`);
      if (res.ok) return { child, base, output, isExited: () => exited };
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  child.kill();
  const log = Buffer.concat(output).toString("utf8");
  throw new Error(
    `server did not become ready (${exited ? `exited ${JSON.stringify(exited)}` : "timeout"})\n${log}`,
  );
};

const stopServer = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });

const runScript = (name, base, prefix) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(SMOKE_DIR, `${name}.mjs`)], {
      cwd: ROOT,
      env: {
        ...process.env,
        BASE: base,
        API_PREFIX: prefix,
        DATABASE_URL: databaseUrl,
        SMOKE_BACKEND_DIR: ROOT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => out.push(d));
    const timer = setTimeout(() => child.kill("SIGKILL"), SCRIPT_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("utf8");
      resolve({
        code,
        text,
        ms: Date.now() - started,
        checks: (text.match(/^ok {3}/gm) ?? []).length,
        failures: (text.match(/^FAIL /gm) ?? []).length,
      });
    });
  });

const results = [];
for (const prefixName of selectedPrefixes) {
  for (const name of selectedScripts) {
    const label = `${name} [${prefixName}]`;
    let server;
    try {
      server = await startServer();
    } catch (err) {
      console.error(`[smoke] ${label}: ${err.message}`);
      results.push({ label, ok: false });
      continue;
    }
    const result = await runScript(name, server.base, PREFIXES[prefixName]);
    await stopServer(server.child);
    const ok = result.code === 0;
    results.push({ label, ok, ...result });
    console.log(
      `[smoke] ${ok ? "PASS" : "FAIL"} ${label} — ${result.checks} ok, ${result.failures} failed, ${(result.ms / 1000).toFixed(1)}s`,
    );
    if (!ok) {
      console.log(result.text);
      console.log(`[smoke] server output for ${label}:\n${Buffer.concat(server.output).toString("utf8")}`);
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n[smoke] ${results.length - failed.length}/${results.length} runs passed` +
    (failed.length ? ` — failed: ${failed.map((r) => r.label).join(", ")}` : ""),
);
process.exit(failed.length === 0 ? 0 : 1);
