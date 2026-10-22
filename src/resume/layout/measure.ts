import type { LayoutConfig, TailoredLine, TailoredResume, TailoredSection } from "../schema";
import { linkTarget, orderedSections, splitSkillLabel } from "./model";
import { sanitize, wrapRuns, type Measurer, type Run, type Seg, type Unsupported } from "./text";

/**
 * Pure, deterministic layout: tailored resume + config + font metrics -> positioned lines per page.
 * The page count produced here IS the engine's measured page count; rendering only draws what was placed.
 */

export const PAGE_SIZES = { letter: { w: 612, h: 792 }, a4: { w: 595.28, h: 841.89 } } as const;
export const META_GAP = 12;
const TITLE_RULE_PAD = 3;

export interface LineBox {
  segs: Seg[];
  size: number;
  /** Line box height (size * lineHeight). */
  lead: number;
  /** x of the line's left edge relative to the content left edge (bullet text indent, centering). */
  x: number;
  /** Optional right-aligned text on the same line (entry dates). */
  right?: Seg;
  /** Bullet marker drawn at x - markerOffset. */
  marker?: string;
}

export interface Block {
  kind: "name" | "contact" | "title" | "heading" | "subheading" | "meta" | "bullet" | "skills" | "paragraph";
  lines: LineBox[];
  spaceBefore: number;
  keepWithNext: boolean;
  /** Horizontal rule under the last line (section titles). */
  rule: boolean;
  padAfter: number;
}

export interface PlacedLine extends LineBox {
  /** Distance from the top of the content area to the top of this line box. */
  top: number;
  /** Rule under this line, when present. */
  rule: boolean;
}

export interface MeasuredLayout {
  pages: PlacedLine[][];
  pageCount: number;
  /** Total used height over all pages (points); used to estimate the overflow in lines. */
  usedTotal: number;
  contentWidth: number;
  contentHeight: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  /** Unsupported code points (replaced with "?") and how often. */
  unsupported: Unsupported;
  /** Each block's lines as placed, keyed by the originating lineIds (for diagnostics and tests). */
  blockInfo: { kind: Block["kind"]; lineIds: string[]; page: number }[];
  bulletChar: string;
}

export interface BuiltBlock extends Block {
  lineIds: string[];
}

function boxHeight(b: Block): number {
  return b.lines.reduce((s, l) => s + l.lead, 0) + b.padAfter;
}

export function buildBlocks(resume: TailoredResume, config: LayoutConfig, m: Measurer, unsupported: Unsupported): { blocks: BuiltBlock[]; bulletChar: string; contentWidth: number } {
  const size = PAGE_SIZES[config.pageSize];
  const margin = config.marginIn * 72;
  const cw = size.w - 2 * margin - 0.01;
  const lhBody = config.bodyPt * config.lineHeight;
  const bulletChar = m.has(0x2022) ? "•" : "-";
  const blocks: BuiltBlock[] = [];
  const san = (t: string) => sanitize(t, m, unsupported);

  const simpleLines = (runs: Run[], sz: number, first: number, rest: number, lead: number, x: number, center: boolean): LineBox[] =>
    wrapRuns(runs, sz, first, rest, m).map((wl) => ({ segs: wl.segs, size: sz, lead, x: center ? Math.max(0, (cw - wl.width) / 2) : x }));

  const linkRun = (line: TailoredLine, bold: boolean): Run => ({ text: san(line.text), bold, url: linkTarget(line) });

  for (const section of orderedSections(resume, config)) {
    const lines = section.entries.flatMap((e) => e.lines);
    if (lines.length === 0) continue;
    if (section.key === "header") {
      pushHeader(section);
      continue;
    }
    const titleLine = lines.find((l) => l.role === "section_title");
    const titleText = san(titleLine ? titleLine.text : section.title);
    blocks.push({
      kind: "title",
      lines: simpleLines([{ text: titleText, bold: true }], config.headingPt, cw, cw, config.headingPt * config.lineHeight, 0, false),
      spaceBefore: config.sectionGapPt,
      keepWithNext: true,
      rule: true,
      padAfter: TITLE_RULE_PAD,
      lineIds: titleLine ? [titleLine.lineId] : [],
    });
    for (const entry of section.entries) {
      let entryStart = true;
      let prev: BuiltBlock | null = null;
      for (const line of entry.lines) {
        if (line.role === "section_title") continue;
        const spaceBefore = entryStart ? config.entryGapPt : 0;
        let block: BuiltBlock;
        switch (line.role) {
          case "entry_heading":
          case "entry_subheading": {
            const bold = line.role === "entry_heading";
            block = {
              kind: bold ? "heading" : "subheading",
              lines: simpleLines([linkRun(line, bold)], config.bodyPt, cw, cw, lhBody, 0, false),
              spaceBefore,
              keepWithNext: true,
              rule: false,
              padAfter: 0,
              lineIds: [line.lineId],
            };
            break;
          }
          case "entry_meta": {
            const text = san(line.text);
            const w = m.width(text, false, config.bodyPt);
            const host = prev && (prev.kind === "heading" || prev.kind === "subheading") && prev.lines.length === 1 && !prev.lines[0]!.right ? prev : null;
            const hostLine = host?.lines[0];
            const lastSeg = hostLine?.segs.at(-1);
            const hostEnd = hostLine ? hostLine.x + (lastSeg ? lastSeg.x + lastSeg.w : 0) : 0;
            if (host && hostLine && hostEnd + META_GAP + w <= cw) {
              hostLine.right = { text, x: cw - w, w, bold: false, url: linkTarget(line) };
              host.lineIds.push(line.lineId);
              continue;
            }
            block = {
              kind: "meta",
              lines: simpleLines([linkRun(line, false)], config.bodyPt, cw, cw, lhBody, 0, false),
              spaceBefore,
              keepWithNext: true,
              rule: false,
              padAfter: 0,
              lineIds: [line.lineId],
            };
            break;
          }
          case "bullet": {
            const indent = config.bulletIndentPt;
            block = {
              kind: "bullet",
              lines: simpleLines([linkRun(line, false)], config.bodyPt, cw - indent, cw - indent, lhBody, indent, false).map((l, i) => (i === 0 ? { ...l, marker: bulletChar } : l)),
              spaceBefore,
              keepWithNext: false,
              rule: false,
              padAfter: 0,
              lineIds: [line.lineId],
            };
            break;
          }
          case "skills_row": {
            const text = san(line.text);
            const sp = splitSkillLabel(text);
            const runs: Run[] = sp ? [{ text: sp.label, bold: true }, { text: sp.rest }] : [{ text }];
            block = { kind: "skills", lines: simpleLines(runs, config.bodyPt, cw, cw, lhBody, 0, false), spaceBefore, keepWithNext: false, rule: false, padAfter: 0, lineIds: [line.lineId] };
            break;
          }
          default: {
            // paragraph, and any stray name/contact line outside the header
            block = { kind: "paragraph", lines: simpleLines([linkRun(line, false)], config.bodyPt, cw, cw, lhBody, 0, false), spaceBefore, keepWithNext: false, rule: false, padAfter: 0, lineIds: [line.lineId] };
          }
        }
        blocks.push(block);
        prev = block;
        entryStart = false;
      }
    }
  }
  return { blocks, bulletChar, contentWidth: cw };

  function pushHeader(section: TailoredSection) {
    const lines = section.entries.flatMap((e) => e.lines);
    const names = lines.filter((l) => l.role === "name");
    for (const n of names) {
      blocks.push({
        kind: "name",
        lines: simpleLines([{ text: san(n.text), bold: true }], config.namePt, cw, cw, config.namePt * config.lineHeight, 0, true),
        spaceBefore: 0,
        keepWithNext: true,
        rule: false,
        padAfter: 0,
        lineIds: [n.lineId],
      });
    }
    const contacts = lines.filter((l) => l.role === "contact");
    if (contacts.length > 0) {
      const runs: Run[] = [];
      contacts.forEach((c, i) => {
        if (i > 0) runs.push({ text: " | " });
        runs.push(linkRun(c, false));
      });
      blocks.push({
        kind: "contact",
        lines: simpleLines(runs, config.bodyPt, cw, cw, lhBody, 0, true),
        spaceBefore: 1,
        keepWithNext: false,
        rule: false,
        padAfter: 0,
        lineIds: contacts.map((c) => c.lineId),
      });
    }
    for (const l of lines.filter((x) => x.role !== "name" && x.role !== "contact")) {
      blocks.push({ kind: "paragraph", lines: simpleLines([linkRun(l, false)], config.bodyPt, cw, cw, lhBody, 0, false), spaceBefore: 2, keepWithNext: false, rule: false, padAfter: 0, lineIds: [l.lineId] });
    }
  }
}

export function measureLayout(resume: TailoredResume, config: LayoutConfig, m: Measurer): MeasuredLayout {
  const size = PAGE_SIZES[config.pageSize];
  const margin = config.marginIn * 72;
  const contentHeight = size.h - 2 * margin;
  const unsupported: Unsupported = new Map();
  const { blocks, bulletChar, contentWidth } = buildBlocks(resume, config, m, unsupported);

  const pages: PlacedLine[][] = [[]];
  const blockInfo: MeasuredLayout["blockInfo"] = [];
  let used = 0;
  let usedTotal = 0;

  const newPage = () => {
    usedTotal += used;
    pages.push([]);
    used = 0;
  };
  const place = (b: BuiltBlock, atTop: boolean) => {
    if (!atTop) used += b.spaceBefore;
    const page = pages[pages.length - 1]!;
    b.lines.forEach((l, i) => {
      page.push({ ...l, top: used, rule: b.rule && i === b.lines.length - 1 });
      used += l.lead;
    });
    used += b.padAfter;
    blockInfo.push({ kind: b.kind, lineIds: b.lineIds, page: pages.length });
  };
  /** Place a block taller than a page by splitting it between lines. */
  const placeSplit = (b: BuiltBlock) => {
    let first = true;
    for (const l of b.lines) {
      if (used + l.lead > contentHeight + 1e-6 && used > 0) newPage();
      if (first && used > 0) used += b.spaceBefore;
      first = false;
      pages[pages.length - 1]!.push({ ...l, top: used, rule: false });
      used += l.lead;
    }
    blockInfo.push({ kind: b.kind, lineIds: b.lineIds, page: pages.length });
  };

  let i = 0;
  while (i < blocks.length) {
    // A group is a run of blocks chained by keepWithNext plus the block that ends the chain.
    let j = i;
    while (j < blocks.length - 1 && blocks[j]!.keepWithNext) j++;
    const group = blocks.slice(i, j + 1);
    const groupHeight = (atTop: boolean) => group.reduce((s, b, k) => s + (k === 0 && atTop ? 0 : b.spaceBefore) + boxHeight(b), 0);
    if (used === 0 && pages[pages.length - 1]!.length === 0) {
      // fresh page
      if (groupHeight(true) <= contentHeight + 1e-6) {
        group.forEach((b, k) => place(b, k === 0));
      } else {
        // The chain itself is taller than a page: keep-with-next cannot hold, place block by block.
        for (const b of group) {
          if (boxHeight(b) > contentHeight + 1e-6) {
            placeSplit(b);
          } else {
            if (used > 0 && used + b.spaceBefore + boxHeight(b) > contentHeight + 1e-6) newPage();
            place(b, used === 0);
          }
        }
      }
    } else if (used + groupHeight(false) <= contentHeight + 1e-6) {
      group.forEach((b) => place(b, false));
    } else {
      newPage();
      continue; // retry the same group on the fresh page
    }
    i = j + 1;
  }
  usedTotal += used;
  return { pages, pageCount: pages.length, usedTotal, contentWidth, contentHeight, pageWidth: size.w, pageHeight: size.h, margin, unsupported, blockInfo, bulletChar };
}
