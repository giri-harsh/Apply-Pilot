import { AlignmentType, BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, TabStopType, TextRun, type ParagraphChild } from "docx";
import type { ExportDocxFn } from "../contracts";
import type { LayoutConfig, TailoredLine, TailoredResume } from "../schema";
import { linkTarget, orderedSections, splitSkillLabel } from "../layout/model";

/**
 * DOCX export from the same structured content as the PDF (same section order, bullets, clickable links).
 *
 * IMPORTANT: the page count of a DOCX is NOT validated. Word, LibreOffice and Google Docs paginate differently and no
 * renderer runs here, so a one-page limit cannot be guaranteed for this file. Only the PDF is page-validated.
 * Callers must show `docxNotice()` next to any DOCX download and set FileRef.pageValidated=false.
 */
export function docxNotice(): string {
  return "page count not validated for DOCX";
}

const PAGE_TWIPS = { letter: { w: 12240, h: 15840 }, a4: { w: 11906, h: 16838 } } as const;
const FONT = "Calibri"; // not embedded: Word substitutes if missing. The PDF uses the embedded font.
const BULLET_REF = "applypilot-bullets";

/** Removes control / zero-width characters (invalid in WordprocessingML) and collapses whitespace. */
function clean(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out += " ";
    else if (cp < 0x20 || cp === 0x7f || cp === 0x200b || cp === 0xfeff) continue;
    else out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

export const exportDocx: ExportDocxFn = async (tailored: TailoredResume, config: LayoutConfig): Promise<Uint8Array> => {
  const page = PAGE_TWIPS[config.pageSize];
  const margin = Math.round(config.marginIn * 1440);
  const contentTwips = page.w - 2 * margin;
  const body = Math.round(config.bodyPt * 2);
  const line = Math.round(config.lineHeight * 240);
  const gapSection = Math.round(config.sectionGapPt * 20);
  const gapEntry = Math.round(config.entryGapPt * 20);

  const runFor = (l: Pick<TailoredLine, "text" | "url">, opts: { bold?: boolean; size?: number } = {}): ParagraphChild => {
    const text = clean(l.text);
    const url = linkTarget(l);
    const run = (extra: { color?: string; underline?: object } = {}) => new TextRun({ text, bold: opts.bold, size: opts.size ?? body, font: FONT, ...extra });
    return url ? new ExternalHyperlink({ link: url, children: [run({ color: "0B3A8C", underline: {} })] }) : run();
  };

  const children: Paragraph[] = [];
  for (const section of orderedSections(tailored, config)) {
    const lines = section.entries.flatMap((e) => e.lines);
    if (lines.length === 0) continue;
    if (section.key === "header") {
      for (const n of lines.filter((l) => l.role === "name")) {
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line }, children: [runFor({ text: n.text }, { bold: true, size: Math.round(config.namePt * 2) })] }));
      }
      const contacts = lines.filter((l) => l.role === "contact");
      if (contacts.length) {
        const kids: ParagraphChild[] = [];
        contacts.forEach((c, i) => {
          if (i > 0) kids.push(new TextRun({ text: " | ", size: body, font: FONT }));
          kids.push(runFor(c));
        });
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line }, children: kids }));
      }
      continue;
    }
    const titleLine = lines.find((l) => l.role === "section_title");
    children.push(
      new Paragraph({
        spacing: { before: gapSection, after: 40, line },
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "555555" } },
        children: [new TextRun({ text: clean(titleLine ? titleLine.text : section.title), bold: true, size: Math.round(config.headingPt * 2), font: FONT })],
      }),
    );
    for (const entry of section.entries) {
      let first = true;
      const ls = entry.lines.filter((l) => l.role !== "section_title");
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i]!;
        const before = first ? gapEntry : 0;
        first = false;
        const base = { spacing: { before, line } };
        switch (l.role) {
          case "entry_heading":
          case "entry_subheading": {
            const next = ls[i + 1];
            const kids: ParagraphChild[] = [runFor(l, { bold: l.role === "entry_heading" })];
            const hasMeta = next?.role === "entry_meta";
            if (hasMeta && next) {
              kids.push(new TextRun({ text: "\t", size: body, font: FONT }), runFor(next));
              i++;
            }
            children.push(new Paragraph({ ...base, keepNext: true, tabStops: [{ type: TabStopType.RIGHT, position: contentTwips }], children: kids }));
            break;
          }
          case "entry_meta":
            children.push(new Paragraph({ ...base, keepNext: true, children: [runFor(l)] }));
            break;
          case "bullet":
            children.push(new Paragraph({ ...base, numbering: { reference: BULLET_REF, level: 0 }, children: [runFor(l)] }));
            break;
          case "skills_row": {
            const sp = splitSkillLabel(clean(l.text));
            const kids: ParagraphChild[] = sp
              ? [new TextRun({ text: sp.label, bold: true, size: body, font: FONT }), runFor({ text: " " + sp.rest, url: l.url })]
              : [runFor(l)];
            children.push(new Paragraph({ ...base, children: kids }));
            break;
          }
          default:
            children.push(new Paragraph({ ...base, children: [runFor(l)] }));
        }
      }
    }
  }

  const indent = Math.round(config.bulletIndentPt * 20);
  const doc = new Document({
    creator: "ApplyPilot AI",
    title: "Resume",
    description: docxNotice(),
    styles: { default: { document: { run: { font: FONT, size: body } } } },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: indent, hanging: indent } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: page.w, height: page.h }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children }],
  });
  return Packer.pack(doc, "uint8array");
};
