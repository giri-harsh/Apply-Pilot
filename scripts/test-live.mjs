import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Reads GEMINI_API_KEY / GROQ_API_KEY from .env (never committed) or the environment.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
const fromFile = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const gemini = process.env.GEMINI_API_KEY || fromFile.GEMINI_API_KEY || "";
const groq = process.env.GROQ_API_KEY || fromFile.GROQ_API_KEY || "";

if (!gemini && !groq) {
  console.log("SKIPPED: no keys (set GEMINI_API_KEY and/or GROQ_API_KEY in .env to run the live suite)");
  process.exit(0);
}

// `pnpm test:live -- name` hands us a literal "--" before the filter; vitest would then treat the filter as a path after
// the options end and run everything. Drop it so the filter works.
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
// A fresh call counter for every invocation (see tests/live/cap.ts). LIVE_MAX_CALLS (default 2) is the hard cap.
mkdirSync(path.join(root, "test-results"), { recursive: true });
writeFileSync(path.join(root, "test-results", "live-calls.count"), "0");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const res = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.live.config.ts", ...args], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, GEMINI_API_KEY: gemini, GROQ_API_KEY: groq, LIVE_MAX_CALLS: process.env.LIVE_MAX_CALLS ?? "2" },
});
process.exit(res.status ?? 1);
