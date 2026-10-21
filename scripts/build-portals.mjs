import { build } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Bundles the React-controlled synthetic portal (React is already a project dependency).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  configFile: false,
  logLevel: "warn",
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path.join(root, "dist-portals"),
    emptyOutDir: true,
    lib: {
      entry: path.join(root, "tests/synthetic-portals/react-src/react-form.tsx"),
      formats: ["iife"],
      name: "reactForm",
      fileName: () => "react-form.js",
    },
  },
});
console.log("Built synthetic portals -> dist-portals");
