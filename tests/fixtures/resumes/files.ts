import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { ALEX_LINES, renderMd, renderTxt, type FixtureLine } from "./content";

export { ALEX_LINES, renderMd, renderTxt };

const enc = new TextEncoder();
export const txtBytes = (): Uint8Array => enc.encode(renderTxt());
export const mdBytes = (): Uint8Array => enc.encode(renderMd());

/** A real text PDF (standard Helvetica, text objects, one page for this content). */
export async function buildTextPdf(lines: FixtureLine[] = ALEX_LINES): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const margin = 54;
  let page = pdf.addPage([W, H]);
  let y = H - margin;
  for (const l of lines) {
    const size = l.kind === "name" ? 20 : l.kind === "heading" ? 12 : 10.5;
    const gap = l.kind === "heading" ? 8 : 0;
    y -= size * 1.35 + gap;
    if (y < margin) {
      page = pdf.addPage([W, H]);
      y = H - margin - size;
    }
    const font = l.kind === "name" || l.kind === "heading" ? bold : regular;
    const x = l.kind === "bullet" ? margin + 14 : margin;
    if (l.kind === "bullet") page.drawText("•", { x: margin + 2, y, size, font: regular, color: rgb(0, 0, 0) });
    page.drawText(l.kind === "heading" ? l.text.toUpperCase() : l.text, { x, y, size, font, color: rgb(0, 0, 0) });
    if (l.right) page.drawText(l.right, { x: W - margin - regular.widthOfTextAtSize(l.right, size), y, size, font: regular, color: rgb(0, 0, 0) });
  }
  return pdf.save();
}

/** A scanned-style PDF: the page holds only drawn rectangles (no text objects), as an image-only scan would have no text layer. */
export async function buildScannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, color: rgb(0.93, 0.93, 0.93), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  for (let i = 0; i < 24; i++) page.drawRectangle({ x: 60, y: 700 - i * 26, width: 300 + ((i * 37) % 180), height: 8, color: rgb(0.15, 0.15, 0.15) });
  return pdf.save();
}

/** Two-column PDF: left and right text runs share baselines, which a naive reader merges into one line. */
export async function buildTwoColumnPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const draw = (t: string, x: number, y: number, f = font) => page.drawText(t, { x, y, size: 10.5, font: f });
  draw("Alex Example", 54, 740, bold);
  draw("alex.example@example.test | Springfield, USA", 54, 724);
  draw("EXPERIENCE", 54, 690, bold);
  draw("SKILLS", 340, 690, bold);
  draw("Acme Labs - Data Science Intern", 54, 672);
  draw("Python and SQL for analysis", 340, 672);
  draw("Built SQL reports for weekly planning", 54, 656);
  draw("Machine learning with scikit-learn", 340, 656);
  return pdf.save();
}

/** A real DOCX built with the `docx` package: Heading 1 section titles and real bullet list paragraphs. */
export async function buildDocx(lines: FixtureLine[] = ALEX_LINES): Promise<Uint8Array> {
  const children = lines.map((l) => {
    if (l.kind === "heading") return new Paragraph({ text: l.text, heading: HeadingLevel.HEADING_1 });
    if (l.kind === "bullet") return new Paragraph({ text: l.text, numbering: { reference: "bullets", level: 0 } });
    const runs = [new TextRun({ text: l.text, bold: l.kind === "name", size: l.kind === "name" ? 40 : 21 })];
    if (l.right) {
      runs.push(new TextRun({ text: "\t" }), new TextRun({ text: l.right }));
    }
    return new Paragraph({
      children: runs,
      tabStops: l.right ? [{ type: TabStopType.RIGHT, position: 9000 }] : [],
      alignment: AlignmentType.LEFT,
    });
  });
  const doc = new Document({
    numbering: {
      config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT }] }],
    },
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

/** A DOCX whose body is empty. */
export async function buildEmptyDocx(): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: "" })] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
