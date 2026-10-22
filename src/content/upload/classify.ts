import type { ClassifyFileInputFn } from "@/resume/contracts";
import type { FormField } from "@/shared/form";
import type { UploadClassification } from "@/resume/schema";

/**
 * Decides what a file input is for. The resume must never reach a field that is not clearly a resume field, so the
 * rule is: exactly one meaning is clear -> that meaning; both or neither -> "ambiguous" (skipped and reported).
 * Page text is evidence only; text that tries to instruct the agent makes the field ambiguous.
 */

type Kind = "resume" | "cover_letter" | "other";

const RESUME = /\b(resume|cv|curriculum vitae?)\b/;
const COVER = /\b(cover (letter|note)s?|covering (letter|note)s?|motivation(al)? letters?|letters? of (interest|motivation|intent)|application letters?)\b/;
const OTHER =
  /\b(transcripts?|portfolios?|certificates?|certifications?|passports?|photos?|photographs?|pictures?|headshots?|avatars?|id proof|id card|id document|photo id|government id|national id|identity (proof|card|document)|proof of (identity|address|age|residence)|references?|recommendations?|work samples?|writing samples?|code samples?|samples? of (work|writing)|mark ?sheets?|diplomas?|degree (certificate|copy)|visa|licen[cs]e|pay ?slips?|salary slips?|bank statements?|signature|logo)\b/;
const INJECTION = /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|earlier|all|any)\b|\bsystem prompt\b|\bas an? (ai|assistant|agent)\b|\binstructions? (above|below|override)/;

function norm(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.[\]/\\:()*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function kindsIn(text: string): Set<Kind> {
  const out = new Set<Kind>();
  if (RESUME.test(text)) out.add("resume");
  if (COVER.test(text)) out.add("cover_letter");
  if (OTHER.test(text)) out.add("other");
  return out;
}

export type Detailed = { classification: UploadClassification; reason: string; /** The evidence came from the field's own label/name, not only its surroundings. */ direct: boolean };

function strongTexts(f: FormField): string[] {
  const t: string[] = [];
  for (const s of f.signals) {
    if (s.source === "explicit_label" || s.source === "aria_labelledby" || s.source === "aria_label" || s.source === "legend") t.push(s.text);
  }
  t.push(f.ariaLabel ?? "");
  return t.map(norm).filter(Boolean);
}
function weakTexts(f: FormField): string[] {
  const t: string[] = [f.name, f.elementId, f.placeholder ?? ""];
  for (const s of f.signals) if (s.source === "name_or_id" || s.source === "placeholder") t.push(s.text);
  return t.map(norm).filter(Boolean);
}
function nearbyTexts(f: FormField): string[] {
  return f.signals.filter((s) => s.source === "nearby_text").map((s) => norm(s.text)).filter(Boolean);
}

const NAMES: Record<Kind, string> = { resume: "resume", cover_letter: "cover letter", other: "another document" };

function decide(tier: string, texts: string[]): Detailed | null {
  const union = new Set<Kind>();
  for (const t of texts) for (const k of kindsIn(t)) union.add(k);
  if (union.size === 0) return null;
  if (union.size > 1) {
    return { classification: "ambiguous", reason: `Mentions both ${[...union].map((k) => NAMES[k]).join(" and ")} (${tier}); skipped`, direct: true };
  }
  const k = [...union][0]!;
  return { classification: k, reason: `${tier} says ${NAMES[k]}`, direct: tier === "label" || tier === "name or id" };
}

export function classifyDetailed(field: FormField): Detailed {
  const strong = strongTexts(field);
  const weak = weakTexts(field);
  if ([...strong, ...weak, ...nearbyTexts(field)].some((t) => INJECTION.test(t))) {
    return { classification: "ambiguous", reason: "Label contains instruction-like text; treated as ambiguous", direct: false };
  }
  // Label and attributes are each other's cross-check: they must not point at different documents.
  const own = decide("label", strong);
  const attr = decide("name or id", weak);
  if (own && attr) {
    if (own.classification === attr.classification) return own;
    return { classification: "ambiguous", reason: `Label says ${own.classification.replace("_", " ")} but name/id says ${attr.classification.replace("_", " ")}`, direct: false };
  }
  if (own) return own;
  if (attr) return attr;
  const near = decide("nearby text", nearbyTexts(field));
  if (near) return { ...near, direct: false };
  const section = decide("section heading", [norm(field.sectionContext)].filter(Boolean));
  if (section) return { ...section, direct: false };
  return { classification: "ambiguous", reason: "No clear sign of which document this field wants", direct: false };
}

/** Single field in isolation. Use `classifyFileInputs` for a form: it also resolves duplicates. */
export const classifyFileInput: ClassifyFileInputFn = (field) => {
  const d = classifyDetailed(field);
  return { classification: d.classification, reason: d.reason };
};

/**
 * Classifies every file input of a form together. When several inputs claim the same document, only one clearly
 * primary input (the single one with explicit wording in its own label/name, else the single required one) keeps the
 * classification; the rest become ambiguous. If no input is clearly primary, all of them become ambiguous.
 */
export function classifyFileInputs(fields: FormField[]): Map<string, { classification: UploadClassification; reason: string }> {
  const files = fields.filter((f) => f.control === "file");
  const out = new Map<string, { classification: UploadClassification; reason: string }>();
  const detailed = new Map(files.map((f) => [f.fieldId, classifyDetailed(f)]));
  for (const f of files) out.set(f.fieldId, { classification: detailed.get(f.fieldId)!.classification, reason: detailed.get(f.fieldId)!.reason });

  for (const kind of ["resume", "cover_letter"] as const) {
    const cands = files.filter((f) => detailed.get(f.fieldId)!.classification === kind);
    if (cands.length < 2) continue;
    const explicit = cands.filter((f) => detailed.get(f.fieldId)!.direct);
    const required = cands.filter((f) => f.required);
    let primary: FormField | null = null;
    let why = "";
    if (explicit.length === 1) {
      primary = explicit[0]!;
      why = "the only input with explicit wording";
    } else if (required.length === 1) {
      primary = required[0]!;
      why = "the only required input";
    }
    for (const f of cands) {
      if (primary && f.fieldId === primary.fieldId) {
        out.set(f.fieldId, { classification: kind, reason: `${detailed.get(f.fieldId)!.reason}; ${cands.length} inputs look like the ${NAMES[kind]}, this is ${why}` });
      } else {
        out.set(f.fieldId, {
          classification: "ambiguous",
          reason: primary
            ? `Another input is the primary ${NAMES[kind]} field; this one is not guessed`
            : `${cands.length} inputs look like the ${NAMES[kind]} and none is clearly primary`,
        });
      }
    }
  }
  return out;
}

/** The kind of document a file is, from the harness naming convention (see `kindFromFilename` in transfer.ts). */
export type FileKind = "resume" | "cover_letter";
