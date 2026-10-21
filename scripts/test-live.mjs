import { existsSync, readFileSync } from "node:fs";
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

const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const res = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.live.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, GEMINI_API_KEY: gemini, GROQ_API_KEY: groq },
});
process.exit(res.status ?? 1);
