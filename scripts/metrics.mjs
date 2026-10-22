import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm metrics`: builds the test extension and portals, runs the deterministic synthetic suite (AI off) and writes
// docs/METRICS.md from the measured numbers. Nothing is rounded up; targets are shown next to the real values.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
const out = path.join(root, "test-results", "metrics.json");
if (existsSync(out)) rmSync(out);

for (const script of ["scripts/build.mjs", "scripts/build-portals.mjs"]) {
  const r = spawnSync(process.execPath, [path.join(root, script), ...(script.endsWith("build.mjs") ? ["--e2e"] : [])], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const pw = run("pnpm", ["exec", "playwright", "test", "--config", "playwright.metrics.config.ts"]);
if (!existsSync(out)) {
  console.error("metrics.json was not produced; the measurement run failed");
  process.exit(pw.status || 1);
}

const m = JSON.parse(readFileSync(out, "utf8"));
const git = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();
const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
const verdict = (n, d, target) => (d === 0 ? "n/a" : n / d >= target ? "meets target" : "BELOW target");
const dirty = git(["status", "--porcelain"]) !== "";
const md = [
  "# Metrics (SPEC 25.5)",
  "",
  `Measured ${new Date().toISOString().slice(0, 10)} on commit \`${git(["rev-parse", "--short", "HEAD"])}\`${dirty ? " (working tree had uncommitted changes)" : ""} by \`pnpm metrics\`.`,
  "Deterministic synthetic suite only (AI off, no network). These are engineering targets measured on our own fixtures, not a claim about real portals, which are measured separately.",
  "",
  "| Metric | Correct / total | Result | Target | |",
  "|---|---|---|---|---|",
  `| Autofill correctness (end state right: right value, or left alone) | ${m.autofill.correct} / ${m.autofill.total} | ${pct(m.autofill.correct, m.autofill.total)} | 98% | ${verdict(m.autofill.correct, m.autofill.total, 0.98)} |`,
  `| Standard-control handling (end state right AND the report agrees) | ${m.controls.handled} / ${m.controls.total} | ${pct(m.controls.handled, m.controls.total)} | 95% | ${verdict(m.controls.handled, m.controls.total, 0.95)} |`,
  "",
  `${m.controls.excludedUnmatchable} expectation(s) are excluded from the control-handling metric because they have no unique \`<label for>\` on the page (duplicate sections, radios and checkboxes without a label element, hidden fields), so a report row cannot be matched to them independently; they still count in the autofill correctness metric. The suite is small (${m.autofill.total} hand-written expectations over ${m.fixtures.length} fixtures): treat the percentages as a regression gate, not as a statistic.`,
  "",
  `Fixtures: ${m.fixtures.join(", ")}. Every expectation is written by hand per field (the value a person would enter, or "left alone" for sensitive, ambiguous, unknown, disabled and hidden fields); none is derived from our own output.`,
  "",
  "## Failing expectations",
  "",
  m.failing.length === 0
    ? "None in this run."
    : ["| Fixture | Field | Wanted | Got | End state | Report |", "|---|---|---|---|---|---|", ...m.failing.map((f) => `| ${f.portal} | ${f.label} | ${f.want || "(left alone)"} | ${f.got || "(empty)"} | ${f.endStateOk ? "ok" : "WRONG"} | ${f.reportOk ? "ok" : `disagrees (${f.reportOutcome})`} |`)].join("\n"),
  "",
  "## Run time (no AI)",
  "",
  `Median of ${m.runsPerFixture} runs per fixture, from the run record's own clock (click to final state, including settle waits and navigation checks).`,
  "",
  "| Fixture | Median run time |",
  "|---|---|",
  ...Object.entries(m.medianRunMs).map(([k, v]) => `| ${k} | ${v} ms |`),
  "",
].join("\n");
writeFileSync(path.join(root, "docs", "METRICS.md"), md);
console.log("Wrote docs/METRICS.md");
