import { build } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildManifest } from "./manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2e = process.argv.includes("--e2e");
const outDir = path.join(root, e2e ? "dist-e2e" : "dist");
const alias = { "@": path.join(root, "src") };

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const common = { configFile: false, logLevel: "warn", resolve: { alias } };

// 1. Popup and options pages (React, normal multi-page build).
await build({
  ...common,
  root: path.join(root, "src", "pages"),
  base: "./",
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: { popup: path.join(root, "src/pages/popup.html"), options: path.join(root, "src/pages/options.html"), offscreen: path.join(root, "src/pages/offscreen.html") } },
  },
});

// 2. Service worker and content script: each a single self-contained IIFE file (no chunk imports).
for (const [name, entry] of [["background", "src/background/index.ts"], ["content", "src/content/index.ts"]]) {
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: path.join(root, entry), formats: ["iife"], name: `applypilot_${name}`, fileName: () => `${name}.js` },
    },
  });
}

// 3. Assets the offscreen document loads at run time: the embedded PDF fonts (never imported, so they stay out of every
// bundle) and the pdf.js worker used to read generated PDFs back for validation.
cpSync(path.join(root, "assets", "fonts"), path.join(outDir, "assets", "fonts"), { recursive: true });
cpSync(path.join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"), path.join(outDir, "pdf.worker.mjs"));

writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(buildManifest({ e2e }), null, 2));
console.log(`Built ${e2e ? "e2e " : ""}extension -> ${path.relative(root, outDir)}`);
