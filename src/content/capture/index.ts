import { maskText } from "@/diagnostics/redact";
import type { PortalCapture } from "@/diagnostics/schema";
import { detectBlockers } from "../blockers";
import { classifyControls } from "../navigation/classify";
import { isVisible } from "../observer/dom";
import { observeForm } from "../observer/observe";

/**
 * Read-only structural snapshot of the current page step (portal capture for adapter development). It is built from an
 * allowlist: labels, types, roles, counts and class/attribute NAMES. It never reads a field's current value, the profile,
 * a file name, or any free text beyond labels, buttons and headings, and all of that is masked and truncated. The service
 * worker additionally scrubs every string the user's profile holds before anything is stored.
 */

const top = <T extends string>(m: Map<T, number>, n: number, min: number) =>
  [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

export function capturePage(doc: Document, href: string, meta: { captureId: string; now: Date; version: string; step: number | null }): Omit<PortalCapture, "lastRun"> {
  let host = "";
  let path = "";
  try {
    const u = new URL(href);
    host = u.hostname; // no query string, no fragment, no credentials
    path = u.pathname;
  } catch {
    /* an unparsable address is simply left empty */
  }

  // ---- fingerprint signals (names only)
  const classes = new Map<string, number>();
  const dataAttrs = new Map<string, number>();
  const hosts = new Set<string>();
  let shadowRoots = 0;
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if ((el as Element).shadowRoot) shadowRoots++;
    for (const c of Array.from(el.classList)) {
      const prefix = c.split(/[-_]/)[0] ?? "";
      if (prefix.length >= 3 && prefix.length <= 30 && /^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) classes.set(prefix, (classes.get(prefix) ?? 0) + 1);
    }
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-")) dataAttrs.set(a.name.slice(0, 60), (dataAttrs.get(a.name.slice(0, 60)) ?? 0) + 1);
  }
  for (const sc of Array.from(doc.querySelectorAll("script[src]"))) {
    try {
      hosts.add(new URL(sc.getAttribute("src") ?? "", href).hostname);
    } catch {
      /* ignore */
    }
  }

  // ---- fields (no currentValue is read)
  const { fields } = observeForm(doc);
  const capFields = fields.map((f, i) => ({
    index: i,
    label: maskText(f.label),
    labelSource: f.labelSource,
    signals: f.signals.slice(0, 4).map((s) => ({ source: s.source, text: maskText(s.text) })),
    control: f.control,
    inputType: f.inputType,
    required: f.required,
    enabled: f.enabled,
    visible: f.visible,
    section: maskText(f.sectionContext),
    options: f.options.slice(0, 20).map((o) => maskText(o.label, 80)),
    optionCount: f.options.length,
    ambiguous: f.ambiguous,
    ambiguityReason: f.ambiguityReason ? maskText(f.ambiguityReason) : null,
    risk: f.risk,
    semanticType: f.semanticType,
    confidence: Math.round(f.confidence * 100) / 100,
    widget: f.widget,
    accept: f.accept.slice(0, 100),
    nameHint: maskText(f.name, 80),
    idHint: maskText(f.elementId, 80),
  }));

  // ---- controls, indicators, frames, blockers
  const { report } = classifyControls(doc);
  const blockers = detectBlockers(doc);
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3"))
    .filter((h) => isVisible(h))
    .slice(0, 10)
    .map((h) => maskText(h.textContent, 120))
    .filter(Boolean);

  const generator = doc.querySelector('meta[name="generator" i]')?.getAttribute("content") ?? null;
  return {
    version: 1,
    captureId: meta.captureId,
    capturedAt: meta.now.toISOString(),
    extensionVersion: meta.version,
    step: meta.step,
    page: { host: host.slice(0, 120), path: maskText(path, 200), title: maskText(doc.title) },
    signals: {
      generator: generator ? maskText(generator, 100) : null,
      scriptHosts: [...hosts].sort().slice(0, 30),
      classPrefixes: top(classes, 20, 2).map(([prefix, count]) => ({ prefix, count })),
      dataAttributes: top(dataAttrs, 30, 1).map(([name, count]) => ({ name, count })),
    },
    headings,
    fields: capFields,
    controls: report.controls.slice(0, 60).map((c) => ({ text: maskText(c.text, 80), role: c.role, reasons: c.reasons.slice(0, 4).map((r) => maskText(r, 120)) })),
    stepIndicator: report.stepIndicator,
    hasReviewSummary: report.hasReviewSummary,
    isLastStep: report.isLastStep,
    frames: blockers.frames.slice(0, 30).map((f) => ({ ...f, origin: f.origin.slice(0, 120) })),
    shadowRoots,
    blockers: blockers.blockers.map((b) => ({ type: b.type })),
  };
}
