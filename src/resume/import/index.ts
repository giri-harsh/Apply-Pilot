import type { ConfirmImportFn, ParseResumeFn } from "../contracts";
import { MasterResumeSchema, ParsedResumeSchema, type Fact, type MasterEntry, type MasterResume, type ParsedResume, type ParsedSection } from "../schema";
import { buildContribution, buildContact, isColumnMerge, LOW_CONFIDENCE_BELOW, type Contribution } from "./build";
import { extractDocx, extractPdf, extractPlain, type ExtractDeps, type ExtractedLine } from "./extract";
import { hash12 } from "./ids";
import { splitSections } from "./sections";

export { buildContribution } from "./build";
export type { ExtractDeps } from "./extract";

/** Extension pages only (options / offscreen). Never import this module from the service worker. */
export const DEFAULT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const NO_TEXT_PDF_WARNING = "No extractable text in this PDF. OCR is not supported yet.";
const MIN_PDF_CHARS = 20;

export type ParseOptions = { maxBytes?: number; now?: Date } & ExtractDeps;

type Format = ParsedResume["format"];

function detectFormat(name: string, bytes: Uint8Array): Format | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt" || ext === "text") return "txt";
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "docx";
  return null;
}

const empty = (filename: string, format: Format, warnings: string[]): ParsedResume => ({ filename, format, hasExtractableText: false, sourceText: "", sections: [], draft: null, warnings });

export async function parseResumeFile(file: { name: string; bytes: Uint8Array }, options: ParseOptions = {}): Promise<ParsedResume> {
  const filename = file.name.trim().slice(0, 200) || "resume";
  const maxBytes = options.maxBytes ?? DEFAULT_IMPORT_MAX_BYTES;
  const format = detectFormat(filename, file.bytes);
  if (!format) return empty(filename, "txt", ["Unsupported file type. Choose a PDF, DOCX, TXT or Markdown file."]);
  if (file.bytes.byteLength > maxBytes) {
    const mb = (n: number) => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
    return empty(filename, format, [`This file is ${mb(file.bytes.byteLength)}, over the ${mb(maxBytes)} import limit. Nothing was read.`]);
  }

  const warnings: string[] = [];
  let lines: ExtractedLine[];
  try {
    if (format === "pdf") lines = await extractPdf(file.bytes, options);
    else if (format === "docx") {
      const r = await extractDocx(file.bytes, options);
      lines = r.lines;
      if (r.hasTable) warnings.push("This document contains a table or columns; the reading order may be wrong, so check every section.");
    } else lines = extractPlain(new TextDecoder("utf-8").decode(file.bytes), format === "md");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return empty(filename, format, [`Could not read this ${format.toUpperCase()} file (${msg.slice(0, 120)}).`]);
  }

  const sourceText = lines.map((l) => l.text).join("\n").slice(0, 200000);
  const chars = sourceText.replace(/\s/g, "").length;
  if (format === "pdf" ? chars < MIN_PDF_CHARS : chars === 0) {
    return empty(filename, format, [format === "pdf" ? NO_TEXT_PDF_WARNING : "No extractable text in this file."]);
  }

  // ---- sections
  const raw = splitSections(lines);
  const sections: ParsedSection[] = raw.map((s) => {
    const body = s.lines.filter((l) => l.trim() !== "");
    let confidence = s.confidence;
    if (s.key === "contact") confidence = body.some((l) => /@/.test(l) || /\d{7,}/.test(l.replace(/\D/g, ""))) ? Math.max(confidence, 0.9) : Math.min(confidence, 0.55);
    if (s.key !== "contact" && body.length === 0) confidence = Math.min(confidence, 0.4);
    const merged = body.filter(isColumnMerge).length;
    if (s.key !== "contact" && s.key !== "skills" && body.length >= 3 && merged / body.length >= 0.3) confidence = Math.min(confidence, 0.5);
    return { key: s.key, heading: s.heading.slice(0, 120), confidence, sourceText: body.join("\n").slice(0, 20000) };
  });
  raw.forEach((s, i) => {
    if (s.key === "unknown") warnings.push(`Section "${s.heading || "(no heading)"}" could not be placed. Its text is kept but not imported until you assign it.`);
    else if (s.duplicate) warnings.push(`Section "${s.heading}" appears more than once; the order is ambiguous, so its items are flagged.`);
    else if (sections[i]!.confidence < LOW_CONFIDENCE_BELOW && s.key !== "contact") warnings.push(`Section "${s.heading}" was parsed with low confidence; check it carefully.`);
  });

  const nowIso = (options.now ?? new Date()).toISOString();
  const draft = assembleDraft(sections, { filename, format, nowIso, sourceText }, warnings);
  const result: ParsedResume = { filename, format, hasExtractableText: true, sourceText, sections, draft, warnings: warnings.map((w) => w.slice(0, 300)).slice(0, 30) };
  const check = ParsedResumeSchema.safeParse(result);
  if (!check.success) {
    return { ...result, draft: null, sections: sections.slice(0, 40), warnings: [...result.warnings, "The file was read but could not be turned into a reviewable draft."].slice(0, 30) };
  }
  return check.data;
}

function assembleDraft(
  sections: ParsedSection[],
  meta: { filename: string; format: Format; nowIso: string; sourceText: string },
  warnings: string[],
): NonNullable<ParsedResume["draft"]> {
  const ctx = { filename: meta.filename, nowIso: meta.nowIso };
  const parts: Contribution[] = [];
  let contact: Contribution["contact"];
  let summary: Fact | undefined;
  sections.forEach((s, i) => {
    if (s.key === "unknown") return;
    const c = buildContribution({ key: s.key, confidence: s.confidence, sourceText: s.sourceText }, i, ctx);
    warnings.push(...c.warnings);
    if (c.contact && !contact) contact = c.contact;
    if (c.summary) {
      if (summary) warnings.push("A second summary section was found; only the first is in the draft (the second stays in the source text).");
      else summary = c.summary;
    }
    parts.push(c);
  });
  if (!contact) {
    const built = buildContact([], 0, ctx);
    contact = built.contact;
    warnings.push(...built.warnings);
  }
  let entries: MasterEntry[] = parts.flatMap((p) => p.entries);
  let skillGroups = parts.flatMap((p) => p.skillGroups);
  let achievements = parts.flatMap((p) => p.achievements);
  if (entries.length > 120) {
    warnings.push("More than 120 entries were found; only the first 120 are in the draft.");
    entries = entries.slice(0, 120);
  }
  if (skillGroups.length > 20) {
    warnings.push("More than 20 skill groups were found; only the first 20 are in the draft.");
    skillGroups = skillGroups.slice(0, 20);
  }
  if (achievements.length > 30) {
    warnings.push("More than 30 achievements were found; only the first 30 are in the draft.");
    achievements = achievements.slice(0, 30);
  }
  return {
    schemaVersion: 1,
    masterId: `m_${hash12(meta.sourceText)}`,
    contact: contact!,
    ...(summary ? { summary } : {}),
    entries,
    skillGroups,
    achievements,
    importedFrom: { filename: meta.filename, format: meta.format, importedAt: meta.nowIso },
  };
}

export const parseResume: ParseResumeFn = (file, options) => parseResumeFile(file, options);

/**
 * Pure. Turns the user-confirmed draft into the master: every fact is marked "resume_import_approved" with the
 * confirmation time. The UI calls this only after the user clicks Confirm; nothing here is ever automatic.
 */
export const confirmImport: ConfirmImportFn = (draft, now): MasterResume => {
  const at = now.toISOString();
  const approve = (f: Fact): Fact => ({ ...f, provenance: { source: "resume_import_approved", recordedAt: at, note: "approved resume import" } });
  const master = {
    ...draft,
    contact: {
      ...draft.contact,
      name: approve(draft.contact.name),
      ...(draft.contact.email ? { email: approve(draft.contact.email) } : {}),
      ...(draft.contact.phone ? { phone: approve(draft.contact.phone) } : {}),
      ...(draft.contact.location ? { location: approve(draft.contact.location) } : {}),
      links: draft.contact.links.map((l) => ({ ...l, fact: approve(l.fact) })),
    },
    ...(draft.summary ? { summary: approve(draft.summary) } : {}),
    entries: draft.entries.map((e) => ({
      ...e,
      heading: approve(e.heading),
      ...(e.subheading ? { subheading: approve(e.subheading) } : {}),
      bullets: e.bullets.map(approve),
    })),
    skillGroups: draft.skillGroups.map((g) => ({ ...g, items: g.items.map(approve) })),
    achievements: draft.achievements.map(approve),
    confirmedAt: at,
  };
  return MasterResumeSchema.parse(master);
};
