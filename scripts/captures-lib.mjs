// Capture intake: re-scan redacted portal captures for anything that looks personal, and summarize the clean ones per portal.
// Pure functions (no file access) so the unit tests can feed them synthetic captures.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_QUERY = /\bhttps?:\/\/[^\s]*\?[^\s]*|\?[a-z_][a-z0-9_]*=[^\s]+/i;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;
const MAX_FREE_TEXT = 200;
// Bookkeeping strings that are identifiers by design.
const SKIP_KEYS = new Set(["captureId", "capturedAt", "extensionVersion"]);

/** Every leak-looking string in one capture: [{ path, kind }]. Values are never echoed back. */
export function leakFindings(capture) {
  const found = [];
  const walk = (v, path, key) => {
    if (typeof v === "string") {
      if (SKIP_KEYS.has(key)) return;
      if (EMAIL.test(v)) found.push({ path, kind: "email" });
      else if (URL_QUERY.test(v)) found.push({ path, kind: "url with query string" });
      else if (PHONE.test(v)) found.push({ path, kind: "phone-like number" });
      else if (v.length > MAX_FREE_TEXT) found.push({ path, kind: "long free text" });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, k);
  };
  walk(capture, "", "");
  return found;
}

const looksLikeCapture = (c) => c && typeof c === "object" && c.version === 1 && c.page && Array.isArray(c.fields);

/**
 * files: [{ name, json }]. Returns { clean: capture[], refused: [{ name, reason, findings }] }.
 * A file is refused whole when any capture in it fails the re-scan or is not a capture at all.
 */
export function screen(files) {
  const clean = [];
  const refused = [];
  for (const f of files) {
    const items = Array.isArray(f.json) ? f.json : [f.json];
    if (items.length === 0 || !items.every(looksLikeCapture)) {
      refused.push({ name: f.name, reason: "not a portal capture", findings: [] });
      continue;
    }
    const findings = items.flatMap((c) => leakFindings(c));
    if (findings.length > 0) refused.push({ name: f.name, reason: "failed redaction re-scan", findings });
    else clean.push(...items);
  }
  return { clean, refused };
}

const count = (arr, key) => {
  const m = new Map();
  for (const x of arr) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const list = (items, empty = "none") => (items.length ? items.join("\n") : `- ${empty}`);

function portalSection(host, caps) {
  const fields = caps.flatMap((c) => c.fields.filter((f) => f.visible).map((f) => ({ ...f, step: c.step, path: c.page.path })));
  const out = [`## ${host}`, ""];

  const gen = [...new Set(caps.map((c) => c.signals?.generator).filter(Boolean))];
  const scripts = [...new Set(caps.flatMap((c) => c.signals?.scriptHosts ?? []))];
  const prefixes = count(caps.flatMap((c) => c.signals?.classPrefixes ?? []), (p) => p.prefix).slice(0, 8).map(([p]) => p);
  const attrs = count(caps.flatMap((c) => c.signals?.dataAttributes ?? []), (a) => a.name).slice(0, 8).map(([a]) => a);
  out.push("**Fingerprint signals**", `- generator: ${gen.join(", ") || "none"}`, `- script hosts: ${scripts.join(", ") || "none"}`, `- class prefixes: ${prefixes.join(", ") || "none"}`, `- data attributes: ${attrs.join(", ") || "none"}`, "");

  out.push(`**Steps seen:** ${caps.length} capture(s)`);
  for (const c of caps) {
    const ind = c.stepIndicator ? ` (step ${c.stepIndicator.current}/${c.stepIndicator.total})` : "";
    out.push(`- ${c.step === null ? "manual" : `run step ${c.step}`}: ${cell(c.page.path)} - ${cell(c.page.title)}${ind}, ${c.fields.length} fields${c.isLastStep ? ", last step" : ""}${c.hasReviewSummary ? ", review summary" : ""}`);
  }
  out.push("");

  out.push("**Fields by type**", list(count(fields, (f) => f.semanticType).map(([t, n]) => `- ${t}: ${n}`)), "");
  const controls = count(fields, (f) => `${f.control}${f.widget && f.widget !== "none" ? `/${f.widget}` : ""}`);
  out.push("**Fields by control**", list(controls.map(([t, n]) => `- ${t}: ${n}`)), "");

  const unresolved = fields.filter((f) => f.semanticType === "unknown" || f.ambiguous);
  out.push(
    "**Unresolved or ambiguous fields** (label evidence)",
    list(unresolved.map((f) => `- "${cell(f.label)}" [${f.control}${f.required ? ", required" : ""}] type=${f.semanticType}${f.ambiguous ? ` ambiguous: ${cell(f.ambiguityReason)}` : ""}; signals: ${f.signals.map((s) => `${s.source}="${cell(s.text)}"`).join("; ") || "none"}; name=${cell(f.nameHint)} id=${cell(f.idHint)}`)),
    "",
  );

  const doubtful = fields.filter((f) => f.semanticType !== "unknown" && !f.ambiguous && f.confidence < 0.6);
  out.push(
    "**Possible mapper mistakes** (typed, but low confidence)",
    list(doubtful.map((f) => `- "${cell(f.label)}" -> ${f.semanticType} at ${f.confidence.toFixed(2)} (${f.labelSource})`)),
    "",
  );

  const buttons = new Map();
  for (const c of caps) for (const b of c.controls ?? []) buttons.set(`${b.role}|${b.text}`, b);
  out.push("**Buttons**", list([...buttons.values()].map((b) => `- "${cell(b.text)}" -> ${b.role}${b.reasons?.length ? ` (${b.reasons.map(cell).join("; ")})` : ""}`)), "");

  const uploads = fields.filter((f) => f.control === "file");
  out.push("**Uploads**", list(uploads.map((f) => `- "${cell(f.label)}" -> ${f.semanticType}, accept=${cell(f.accept) || "unset"}${f.required ? ", required" : ""}`)), "");

  const blockers = [...new Set(caps.flatMap((c) => (c.blockers ?? []).map((b) => b.type)))];
  const frames = caps.flatMap((c) => c.frames ?? []);
  const shadow = Math.max(0, ...caps.map((c) => c.shadowRoots ?? 0));
  out.push(
    "**Blockers and containers**",
    `- blockers: ${blockers.join(", ") || "none"}`,
    `- iframes: ${frames.length} (${frames.filter((f) => !f.accessible).length} not accessible, ${frames.filter((f) => f.visible).length} visible): ${[...new Set(frames.map((f) => f.origin))].join(", ") || "none"}`,
    `- open shadow roots: ${shadow}`,
    "",
  );

  const runs = caps.filter((c) => c.lastRun);
  out.push(
    "**Run report**",
    list(
      runs.map((c) => {
        const r = c.lastRun;
        const bad = r.results.filter((x) => x.required && !/^(verified|filled)/.test(x.outcome));
        return `- ${r.state}; steps ${r.steps.map((s) => `${s.index}:${s.outcome}(${s.verified} ok/${s.failed} failed/${s.requiredUnresolved} required open)`).join(", ") || "none"}${bad.length ? `; required not done: ${bad.map((x) => `"${cell(x.label)}" ${x.outcome}${x.reason ? ` (${cell(x.reason)})` : ""}`).join("; ")}` : ""}`;
      }),
      "no run report attached",
    ),
    "",
  );
  return out.join("\n");
}

/** SUMMARY.md text for the screened captures. */
export function summarize({ clean, refused }) {
  const byHost = new Map();
  for (const c of clean) byHost.set(c.page.host, [...(byHost.get(c.page.host) ?? []), c]);
  const head = ["# Capture summary", "", `${clean.length} capture(s) from ${byHost.size} portal(s). ${refused.length} file(s) refused.`, ""];
  if (refused.length) {
    head.push("## Refused (failed redaction, not summarized)", "");
    for (const r of refused) {
      const kinds = count(r.findings, (f) => f.kind).map(([k, n]) => `${k} x${n}`).join(", ");
      head.push(`- ${r.name}: ${r.reason}${kinds ? ` - ${kinds} (at ${r.findings.slice(0, 5).map((f) => f.path).join(", ")})` : ""}`);
    }
    head.push("");
  }
  return [head.join("\n"), ...[...byHost.entries()].map(([h, caps]) => portalSection(h, caps))].join("\n");
}
