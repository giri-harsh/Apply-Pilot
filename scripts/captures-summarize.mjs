import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screen, summarize } from "./captures-lib.mjs";

// `pnpm captures:summarize`: reads captures/*.json (exports from Settings > Diagnostics) and writes captures/SUMMARY.md.
// Files that fail the redaction re-scan are listed and never summarized. captures/ is git-ignored (README.md excepted).
const dir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "captures");

const README = `# captures/

Drop exported portal captures here (Popup > Capture this page, then Settings > Diagnostics > Export).
Everything in this folder except this file is git-ignored. Then run \`pnpm captures:summarize\` to write SUMMARY.md.
`;

if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
if (!existsSync(path.join(dir, "README.md"))) writeFileSync(path.join(dir, "README.md"), README);

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.log("captures/ has no .json files; nothing to summarize.");
  process.exit(0);
}
const loaded = files.map((name) => {
  try {
    return { name, json: JSON.parse(readFileSync(path.join(dir, name), "utf8")) };
  } catch {
    return { name, json: null };
  }
});
const result = screen(loaded);
writeFileSync(path.join(dir, "SUMMARY.md"), summarize(result));
console.log(`captures/SUMMARY.md: ${result.clean.length} capture(s) summarized, ${result.refused.length} file(s) refused.`);
for (const r of result.refused) console.log(`  refused ${r.name}: ${r.reason}`);
