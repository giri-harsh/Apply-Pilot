import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Opt-in suite that talks to the real Gemini / Groq APIs. Never part of `pnpm test` or `pnpm test:e2e`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/live/**/*.live.ts"], environment: "node", globals: true, testTimeout: 60_000 },
});
