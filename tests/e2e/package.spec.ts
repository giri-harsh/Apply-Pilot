import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

/** `pnpm package` produces the production archive: the production manifest, no source maps, no test hooks or keys. */
test("package: the zip holds the production build and nothing from the test build", () => {
  test.setTimeout(180_000);
  execFileSync(process.execPath, ["scripts/package.mjs"], { stdio: "pipe" });
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const zipPath = `release/applypilot-${pkg.version}.zip`;
  expect(fs.existsSync(zipPath)).toBe(true);
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const names = Object.keys(files);

  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  const prod = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
  expect(manifest).toEqual(prod);
  expect(manifest.version).toBe("0.1.0");
  expect([...manifest.permissions].sort()).toEqual(["activeTab", "offscreen", "scripting", "storage"]);
  expect([...manifest.host_permissions].sort()).toEqual(["https://api.groq.com/*", "https://generativelanguage.googleapis.com/*"]);
  expect(JSON.stringify(manifest)).not.toContain("127.0.0.1");
  expect(manifest.name).not.toMatch(/e2e/i);

  for (const must of ["background.js", "content.js", "popup.html", "options.html", "offscreen.html", "pdf.worker.mjs", "assets/fonts/SourceSans3-Regular.ttf"]) expect(names, must).toContain(must);
  expect(names.filter((n) => n.endsWith(".map"))).toEqual([]);
  expect(names.filter((n) => /^(tests|src|docs|node_modules|\.env)/.test(n))).toEqual([]);

  for (const n of names.filter((x) => /\.(js|mjs|html)$/.test(x))) {
    const text = strFromU8(files[n]!);
    expect(text, n).not.toMatch(/mock[_-]?provider|testmock|PW_EXPERIMENTAL|AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}|__uploads/i);
  }
});
