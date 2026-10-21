import type { ControlKind, FormField } from "@/shared/form";
import { classifyField } from "../mapping/classify";
import { isEnabled, isReadOnly, isVisible, normalizeText, textWithoutControls } from "./dom";
import {
  collectLabelSignals,
  legendOrGroupQuestion,
  looksRequired,
  nearbyText,
  primaryLabel,
  type LabelSignal,
} from "./labels";

export type ObservedForm = {
  fields: FormField[];
  /** fieldId -> live element(s). Radio groups map to every radio in the group. DOM nodes never leave the content script. */
  targets: Map<string, HTMLElement[]>;
};

const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "password", "search"]);

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlKind(el: Control): ControlKind | null {
  if (el instanceof el.ownerDocument.defaultView!.HTMLSelectElement) return "select";
  if (el instanceof el.ownerDocument.defaultView!.HTMLTextAreaElement) return "textarea";
  const t = (el as HTMLInputElement).type.toLowerCase();
  if (SKIP_INPUT_TYPES.has(t)) return null;
  if (t === "radio") return "radio";
  if (t === "checkbox") return "checkbox";
  if (t === "file") return "file";
  return "text";
}

/** Stable-enough identity for "is this still the same field?" checks (SPEC 11.4). */
export function fingerprintOf(els: HTMLElement[], label: string): string {
  const first = els[0]!;
  const parts = [
    first.tagName.toLowerCase(),
    (first as HTMLInputElement).type ?? "",
    first.getAttribute("name") ?? "",
    first.id,
    String(els.length),
    label.toLowerCase().slice(0, 80),
  ];
  return parts.join("|");
}

function sectionOf(el: Element, headingBefore: string): string {
  const fs = el.closest("fieldset");
  const legend = fs?.querySelector(":scope > legend");
  const legendText = legend ? textWithoutControls(legend) : "";
  // Radio groups use the legend as their question; for section context prefer the heading above the fieldset.
  return headingBefore || legendText;
}

function optionLabelFor(el: HTMLInputElement): string {
  const labels = el.labels;
  if (labels && labels.length) return normalizeText(Array.from(labels).map((l) => textWithoutControls(l)).join(" "));
  const wrap = el.closest("label");
  return wrap ? textWithoutControls(wrap) : el.value;
}

export function observeForm(doc: Document): ObservedForm {
  const all = Array.from(doc.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,[role=heading],input,select,textarea"));
  const targets = new Map<string, HTMLElement[]>();
  const fields: FormField[] = [];
  const seenRadioGroups = new Map<string, HTMLInputElement[]>();
  const order: { el: HTMLElement; heading: string }[] = [];

  let heading = "";
  for (const el of all) {
    if (/^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading") {
      heading = textWithoutControls(el);
      continue;
    }
    const kind = controlKind(el as Control);
    if (!kind) continue;
    if (kind === "radio") {
      const r = el as HTMLInputElement;
      const key = `${r.form ? Array.from(doc.forms).indexOf(r.form) : -1}::${r.name || r.id}`;
      const existing = seenRadioGroups.get(key);
      if (existing && r.name) {
        existing.push(r);
        continue;
      }
      seenRadioGroups.set(key, [r]);
    }
    order.push({ el, heading });
  }

  let n = 0;
  for (const { el, heading: head } of order) {
    const kind = controlKind(el as Control)!;
    const fieldId = `field_${String(++n).padStart(3, "0")}`;
    const section = sectionOf(el, head);

    let els: HTMLElement[] = [el];
    let signals: LabelSignal[];
    let options: { value: string; label: string }[] = [];
    let currentValue: string;

    if (kind === "radio") {
      const first = el as HTMLInputElement;
      const group = first.name
        ? (seenRadioGroups.get(`${first.form ? Array.from(doc.forms).indexOf(first.form) : -1}::${first.name}`) ?? [first])
        : [first];
      els = group;
      const q = legendOrGroupQuestion(first);
      const near = nearbyText(first.closest("label") ?? first);
      signals = [];
      if (q) signals.push({ source: "legend", text: q });
      if (near) signals.push({ source: "nearby_text", text: near });
      options = group.map((r) => ({ value: r.value, label: optionLabelFor(r) }));
      currentValue = group.find((r) => r.checked)?.value ?? "";
    } else {
      signals = collectLabelSignals(el);
      if (kind === "select") {
        const sel = el as HTMLSelectElement;
        options = Array.from(sel.options).map((o) => ({ value: o.value, label: normalizeText(o.textContent) }));
        currentValue = sel.selectedOptions[0]?.value ?? "";
      } else if (kind === "checkbox") {
        currentValue = (el as HTMLInputElement).checked ? "true" : "false";
      } else if (kind === "file") {
        currentValue = (el as HTMLInputElement).files?.length ? "has-file" : "";
      } else {
        currentValue = (el as HTMLInputElement | HTMLTextAreaElement).value;
      }
    }

    // Section heading is context only; it never decides a field's type on its own.
    if (section) signals.push({ source: "section_heading", text: section });
    const { label, source } = primaryLabel(signals.filter((s) => s.source !== "section_heading"));
    const cls = classifyField(
      signals.filter((s) => s.source !== "section_heading"),
      kind,
      section,
    );

    const required =
      els.some((e) => (e as HTMLInputElement).required || e.getAttribute("aria-required") === "true") ||
      looksRequired(label);

    fields.push({
      fieldId,
      tagName: el.tagName.toLowerCase(),
      inputType: kind === "text" ? ((el as HTMLInputElement).type || "text").toLowerCase() : kind,
      control: kind,
      label,
      labelSource: source,
      signals: signals.filter((s) => s.source !== "section_heading"),
      name: el.getAttribute("name") ?? "",
      elementId: el.id,
      autocomplete: el.getAttribute("autocomplete") ?? "",
      placeholder: el.getAttribute("placeholder"),
      ariaLabel: el.getAttribute("aria-label"),
      required,
      visible: els.some((e) => isVisible(e)),
      enabled: els.every((e) => isEnabled(e) && !isReadOnly(e)),
      options,
      currentValue,
      sectionContext: section,
      semanticCandidates: cls.candidates,
      semanticType: cls.semanticType,
      confidence: cls.confidence,
      ambiguous: cls.ambiguous,
      ambiguityReason: cls.ambiguityReason,
      risk: cls.risk,
      fingerprint: fingerprintOf(els, label),
    });
    targets.set(fieldId, els);
  }

  markDuplicateAmbiguity(fields);
  return { fields, targets };
}

/**
 * Two applicant-identity fields with the same type, label and section cannot both be "the" answer
 * (the exception is a deliberate confirmation field such as "Confirm email").
 */
export function markDuplicateAmbiguity(fields: FormField[]): void {
  const groups = new Map<string, FormField[]>();
  for (const f of fields) {
    if (!f.visible || f.semanticType === "unknown" || f.semanticType === "open_ended") continue;
    const key = `${f.semanticType}|${f.label.toLowerCase()}|${f.sectionContext.toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const f of g) {
      f.ambiguous = true;
      f.ambiguityReason = f.ambiguityReason ?? `${g.length} fields share the label "${f.label}" in the same section`;
    }
  }
}
