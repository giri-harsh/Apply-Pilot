import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

// `pnpm package`: builds the PRODUCTION extension (never the e2e variant), checks it, and zips dist/ to
// release/applypilot-<version>.zip. Source maps and anything that is not part of the built extension are left out.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = path.join(root, "dist");
const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
  process.exit(1);
}
if (JSON.stringify(manifest).includes("127.0.0.1") || /\(e2e\)/.test(manifest.name)) {
  console.error("refusing to package a test build (loopback host or e2e name in the manifest)");
  process.exit(1);
}

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!name.endsWith(".map")) files[path.relative(dist, p).split(path.sep).join("/")] = new Uint8Array(readFileSync(p));
  }
};
walk(dist);

mkdirSync(path.join(root, "release"), { recursive: true });
const out = path.join(root, "release", `applypilot-${pkg.version}.zip`);
// Fixed timestamps keep the archive reproducible for identical input.
writeFileSync(out, zipSync(files, { level: 9, mtime: new Date("2026-01-01T00:00:00Z") }));
console.log(`Packaged ${Object.keys(files).length} files -> ${path.relative(root, out)} (${Math.round(statSync(out).size / 1024)} KB)`);
