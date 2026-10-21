import type { LabelSource } from "@/shared/form";
import { normalizeText, textOfIds, textWithoutControls } from "./dom";

export type LabelSignal = { source: LabelSource; text: string };

const GENERIC_NAME = /^(field|input|q|question|text|txt|fld|f|el|id|ctrl|control)?[-_.]?[0-9a-f]{0,12}$/i;

/** "first_name" / "firstName" / "applicant-email" -> "first name" ... or "" if it carries no words. */
export function humanizeIdentifier(raw: string): string {
  const s = raw.trim().replace(/[-_.\s]*\d+$/, "");
  if (s.length < 3 || GENERIC_NAME.test(s) || /^[0-9a-f-]{16,}$/i.test(s)) return "";
  return s
    .replace(/\[(\d+)\]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Visible text immediately before the control, used only when stronger signals are missing. */
export function nearbyText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; depth < 2 && node; depth++) {
    for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
      const t =
        sib.nodeType === 3
          ? normalizeText(sib.textContent)
          : sib.nodeType === 1
            ? textWithoutControls(sib as Element)
            : "";
      if (t && t.length <= 120) return t;
      if (t) return "";
    }
    node = node.parentElement;
    if (node && /^(FORM|BODY|FIELDSET)$/.test(node.tagName)) break;
  }
  return "";
}

function explicitLabelText(el: HTMLElement): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    return normalizeText(Array.from(labels).map((l) => textWithoutControls(l)).join(" "));
  }
  const id = el.getAttribute("id");
  if (id) {
    const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) return textWithoutControls(l);
  }
  const wrap = el.closest("label");
  return wrap ? textWithoutControls(wrap) : "";
}

export function legendOrGroupQuestion(el: Element): string {
  const group = el.closest("fieldset,[role=radiogroup],[role=group]");
  if (!group) return "";
  const doc = el.ownerDocument;
  const labelledBy = textOfIds(doc, group.getAttribute("aria-labelledby"));
  if (labelledBy) return labelledBy;
  const aria = normalizeText(group.getAttribute("aria-label"));
  if (aria) return aria;
  const legend = group.querySelector(":scope > legend");
  return legend ? textWithoutControls(legend) : "";
}

/** Collects label evidence in SPEC 9.4 priority order. Order of the returned array is priority order. */
export function collectLabelSignals(el: HTMLElement): LabelSignal[] {
  const doc = el.ownerDocument;
  const out: LabelSignal[] = [];
  const push = (source: LabelSource, text: string) => {
    const t = normalizeText(text);
    if (t) out.push({ source, text: t });
  };

  push("explicit_label", explicitLabelText(el));
  push("aria_labelledby", textOfIds(doc, el.getAttribute("aria-labelledby")));
  push("aria_label", el.getAttribute("aria-label") ?? "");

  const ac = (el.getAttribute("autocomplete") ?? "").trim().toLowerCase();
  if (ac && ac !== "on" && ac !== "off") push("name_or_id", `autocomplete:${ac.split(/\s+/).pop()}`);
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "email" || type === "tel") push("name_or_id", `inputtype:${type}`);
  const nameWords = humanizeIdentifier(el.getAttribute("name") ?? "") || humanizeIdentifier(el.id);
  // A bare "name" attribute is too generic to disagree with a more specific label such as "First name".
  if (nameWords && nameWords !== "name") push("name_or_id", nameWords);

  push("placeholder", el.getAttribute("placeholder") ?? "");
  push("nearby_text", nearbyText(el));
  push("legend", legendOrGroupQuestion(el));
  return out;
}

/** The label shown to the user: the highest-priority human-readable signal. */
export function primaryLabel(signals: LabelSignal[]): { label: string; source: LabelSource } {
  const readable = signals.find(
    (s) => !(s.source === "name_or_id" && /^(autocomplete|inputtype):/.test(s.text)),
  );
  return readable ? { label: readable.text, source: readable.source } : { label: "", source: "none" };
}

export function looksRequired(label: string): boolean {
  return /\*|\(required\)|\brequired\b/i.test(label);
}
