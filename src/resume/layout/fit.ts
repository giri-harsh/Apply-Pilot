import { LAYOUT_FLOORS, LayoutConfigSchema, type LayoutConfig, type TailoredLine, type TailoredResume } from "../schema";
import type { ShortenFn } from "../contracts";
import { buildBlocks, measureLayout, type MeasuredLayout } from "./measure";
import type { Measurer } from "./text";

/**
 * Fit loop (SPEC 7.5). Order, each step only while the document still exceeds the page limit:
 *   1. Shorten: ask the injected `shorten` for shorter wording of the least relevant over-long bullets. Only strictly
 *      shorter replacements for the requested lineIds are accepted.
 *   2. Tighten spacing/typography in fixed steps, never below LAYOUT_FLOORS (body 10pt, margin 0.5in, line height 1.1).
 *   3. Drop, by this explicit rule, never touching contact info, section titles, protected lines, onlyEvidence lines,
 *      the most relevant education entry's heading/meta lines, or the last remaining entry of any section:
 *        A. single bullet / skills rows, lowest `relevance` first (later in the document first on ties), always
 *           leaving each entry at least one content line;
 *        B. whole entries (only when none of their lines is protected), lowest max-relevance first.
 *   If it still does not fit, the smallest layout reached is returned with satisfiedLimit=false and a reason.
 */

export interface FitOutcome {
  resume: TailoredResume;
  config: LayoutConfig;
  measured: MeasuredLayout;
  droppedLineIds: string[];
  shortenedLineIds: string[];
  warnings: string[];
  satisfiedLimit: boolean;
}

const HARD_ROLES = new Set(["name", "contact", "section_title"]);
const CONTENT_ROLES = new Set(["bullet", "skills_row", "paragraph"]);

export function isHardLine(l: TailoredLine): boolean {
  return HARD_ROLES.has(l.role) || l.protected || l.onlyEvidenceForRequiredQualification;
}

export function clampConfig(c: LayoutConfig): LayoutConfig {
  return LayoutConfigSchema.parse({
    ...c,
    bodyPt: Math.max(LAYOUT_FLOORS.bodyPt, c.bodyPt),
    marginIn: Math.max(LAYOUT_FLOORS.marginIn, c.marginIn),
    lineHeight: Math.max(LAYOUT_FLOORS.lineHeight, c.lineHeight),
  });
}

/** Cumulative tightening steps; each only ever lowers a value, and the result is clamped to the floors. */
export function tighteningLadder(start: LayoutConfig): LayoutConfig[] {
  const steps: ((c: LayoutConfig) => Partial<LayoutConfig>)[] = [
    (c) => ({ sectionGapPt: Math.min(c.sectionGapPt, 8), entryGapPt: Math.min(c.entryGapPt, 4) }),
    (c) => ({ sectionGapPt: Math.min(c.sectionGapPt, 6), entryGapPt: Math.min(c.entryGapPt, 3) }),
    (c) => ({ lineHeight: Math.min(c.lineHeight, 1.15) }),
    (c) => ({ lineHeight: Math.min(c.lineHeight, LAYOUT_FLOORS.lineHeight) }),
    (c) => ({ marginIn: Math.min(c.marginIn, 0.6) }),
    (c) => ({ marginIn: Math.min(c.marginIn, LAYOUT_FLOORS.marginIn) }),
    (c) => ({ bodyPt: Math.min(c.bodyPt, 10.25) }),
    (c) => ({ bodyPt: Math.min(c.bodyPt, LAYOUT_FLOORS.bodyPt) }),
    (c) => ({ headingPt: Math.min(c.headingPt, 11), namePt: Math.min(c.namePt, 18), sectionGapPt: Math.min(c.sectionGapPt, 4), entryGapPt: Math.min(c.entryGapPt, 2), bulletIndentPt: Math.min(c.bulletIndentPt, 12) }),
  ];
  const out: LayoutConfig[] = [clampConfig(start)];
  for (const s of steps) {
    const prev = out[out.length - 1]!;
    const next = clampConfig({ ...prev, ...s(prev) });
    if (JSON.stringify(next) !== JSON.stringify(prev)) out.push(next);
  }
  return out;
}

function applyState(orig: TailoredResume, dropped: Set<string>, repl: Map<string, TailoredLine>): TailoredResume {
  return {
    ...orig,
    sections: orig.sections.map((s) => ({
      ...s,
      entries: s.entries
        .map((e) => ({ ...e, lines: e.lines.filter((l) => !dropped.has(l.lineId)).map((l) => repl.get(l.lineId) ?? l) }))
        .filter((e) => e.lines.length > 0),
    })),
  };
}

function topEducationEntryId(r: TailoredResume): string | null {
  let best: { id: string; score: number } | null = null;
  for (const s of r.sections) {
    if (s.key !== "education") continue;
    for (const e of s.entries) {
      const score = Math.max(...e.lines.filter((l) => l.role !== "section_title").map((l) => l.relevance), -1);
      if (!best || score > best.score) best = { id: e.entryId, score };
    }
  }
  return best?.id ?? null;
}

type Cand = { kind: "line"; lineId: string; rel: number; order: number } | { kind: "entry"; lineIds: string[]; rel: number; order: number };

function dropCandidates(r: TailoredResume, eduTop: string | null): { a: Cand[]; b: Cand[] } {
  const a: Cand[] = [];
  const b: Cand[] = [];
  let order = 0;
  for (const s of r.sections) {
    if (s.key === "header") continue;
    const liveEntries = s.entries.filter((e) => e.lines.some((l) => l.role !== "section_title"));
    for (const e of s.entries) {
      const content = e.lines.filter((l) => l.role !== "section_title");
      const isEdu = e.entryId === eduTop;
      const contentCount = content.filter((l) => CONTENT_ROLES.has(l.role)).length;
      for (const l of content) {
        order++;
        if ((l.role === "bullet" || l.role === "skills_row") && !isHardLine(l) && contentCount > 1) a.push({ kind: "line", lineId: l.lineId, rel: l.relevance, order });
      }
      if (content.length > 0 && !isEdu && liveEntries.length >= 2 && !content.some(isHardLine)) {
        b.push({ kind: "entry", lineIds: content.map((l) => l.lineId), rel: Math.max(...content.map((l) => l.relevance)), order });
      }
    }
  }
  const sort = (x: Cand, y: Cand) => x.rel - y.rel || y.order - x.order;
  return { a: a.sort(sort), b: b.sort(sort) };
}

function describeBlockers(r: TailoredResume, eduTop: string | null): string {
  let hard = 0;
  let lastEntries = 0;
  for (const s of r.sections) {
    if (s.key === "header") continue;
    const live = s.entries.filter((e) => e.lines.some((l) => l.role !== "section_title"));
    if (live.length === 1) lastEntries++;
    for (const e of s.entries) for (const l of e.lines) if ((l.protected || l.onlyEvidenceForRequiredQualification) && l.role !== "section_title") hard++;
  }
  const parts = [`${hard} protected or required-qualification line(s)`, "contact info and section titles", `${lastEntries} section(s) down to their last entry`];
  if (eduTop) parts.push("the most relevant education entry");
  return parts.join(", ");
}

export async function fitResume(
  original: TailoredResume,
  startConfig: LayoutConfig,
  m: Measurer,
  shorten: ShortenFn | undefined,
): Promise<FitOutcome> {
  const limit = startConfig.pageLimit;
  const label = limit === 1 ? "one-page" : `${limit}-page`;
  const warnings: string[] = [];
  const dropped = new Set<string>();
  const droppedOrder: string[] = [];
  const repl = new Map<string, TailoredLine>();
  const ladder = tighteningLadder(startConfig);
  const measureAt = (cfg: LayoutConfig) => measureLayout(applyState(original, dropped, repl), cfg, m);

  let config = ladder[0]!;
  let measured = measureAt(config);
  const done = (satisfied: boolean): FitOutcome => {
    const resume = applyState(original, dropped, repl);
    const shortenedLineIds = [...repl.keys()].filter((id) => !dropped.has(id));
    return { resume, config, measured, droppedLineIds: droppedOrder, shortenedLineIds, warnings, satisfiedLimit: satisfied };
  };
  if (measured.pageCount <= limit) return done(true);

  // ---- 1. shorten
  if (shorten) {
    const lead = config.bodyPt * config.lineHeight;
    const overflow = Math.max(0, measured.usedTotal - limit * measured.contentHeight);
    const reduceLines = Math.max(1, Math.ceil(overflow / lead));
    const info = buildBlocks(applyState(original, dropped, repl), config, m, new Map());
    const byId = new Map<string, TailoredLine>();
    for (const s of original.sections) for (const e of s.entries) for (const l of e.lines) byId.set(l.lineId, l);
    const scored = info.blocks
      .filter((b) => b.kind === "bullet" || b.kind === "paragraph")
      .map((b) => {
        const line = byId.get(b.lineIds[0] ?? "");
        const last = b.lines[b.lines.length - 1];
        const fill = last ? (last.segs.length ? (last.segs[last.segs.length - 1]!.x + last.segs[last.segs.length - 1]!.w) / (info.contentWidth - last.x) : 0) : 1;
        return { line, rows: b.lines.length, fill };
      })
      // Sole evidence for a required qualification is never reworded by the fit loop: a shorter wording could silently lose
      // the very keyword that made the line necessary (verifier finding 7).
      .filter((x): x is { line: TailoredLine; rows: number; fill: number } => !!x.line && x.rows >= 2 && !x.line.onlyEvidenceForRequiredQualification);
    const cheap = scored.filter((x) => x.fill < 0.4).sort((x, y) => x.line.relevance - y.line.relevance);
    const rest = scored.filter((x) => x.fill >= 0.4).sort((x, y) => x.line.relevance - y.line.relevance);
    const cands = [...cheap, ...rest].slice(0, 12).map((x) => x.line);
    if (cands.length > 0) {
      try {
        const out = await shorten(cands.map((l) => ({ ...l })), { reduceLines, reason: `${label} limit exceeded by about ${reduceLines} line(s)` });
        const allowed = new Map(cands.map((l) => [l.lineId, l]));
        let ignored = 0;
        for (const r of Array.isArray(out) ? out : []) {
          const o = allowed.get(r?.lineId);
          const t = typeof r?.text === "string" ? r.text.trim() : "";
          if (!o || !t || t.length >= o.text.length || repl.has(o.lineId)) {
            ignored++;
            continue;
          }
          repl.set(o.lineId, { ...o, text: t, origin: "rewritten", masterText: o.masterText ?? (o.origin === "master" ? o.text : undefined) });
        }
        if (ignored > 0) warnings.push(`Ignored ${ignored} shortened replacement(s) that were not strictly shorter or did not match a requested line.`);
        if (repl.size > 0) warnings.push(`Shortened ${repl.size} line(s) to fit the ${label} limit.`);
      } catch (e) {
        warnings.push(`Shortening was unavailable: ${e instanceof Error ? e.message.slice(0, 120) : "error"}.`);
      }
    }
    measured = measureAt(config);
    if (measured.pageCount <= limit) return done(true);
  }

  // ---- 2. tighten
  let fitIdx = -1;
  for (let i = 0; i < ladder.length; i++) {
    const mm = measureAt(ladder[i]!);
    if (mm.pageCount <= limit) {
      fitIdx = i;
      measured = mm;
      break;
    }
  }
  if (fitIdx >= 0) {
    config = ladder[fitIdx]!;
    if (fitIdx > 0) warnings.push(describeTightening(ladder[0]!, config));
    return done(true);
  }
  config = ladder[ladder.length - 1]!;
  measured = measureAt(config);
  if (ladder.length > 1) warnings.push(describeTightening(ladder[0]!, config));

  // ---- 3. drop
  const eduTop = topEducationEntryId(original);
  while (measured.pageCount > limit) {
    const cur = applyState(original, dropped, repl);
    const { a, b } = dropCandidates(cur, eduTop);
    const pick = a[0] ?? b[0];
    if (!pick) break;
    const ids = pick.kind === "line" ? [pick.lineId] : pick.lineIds;
    for (const id of ids) {
      dropped.add(id);
      droppedOrder.push(id);
    }
    measured = measureAt(config);
  }
  if (droppedOrder.length > 0) warnings.push(`Dropped ${droppedOrder.length} low-relevance line(s) (lowest relevance first; bullets before whole entries).`);

  if (measured.pageCount <= limit) {
    // Relax: use the loosest spacing that still fits with the lines already dropped.
    for (let i = 0; i < ladder.length; i++) {
      const mm = measureAt(ladder[i]!);
      if (mm.pageCount <= limit) {
        config = ladder[i]!;
        measured = mm;
        break;
      }
    }
    return done(true);
  }

  const reason = describeBlockers(applyState(original, dropped, repl), eduTop);
  warnings.push(
    `${label} constraint not met cleanly: needs ${measured.pageCount} page(s) at the tightest allowed layout (body ${config.bodyPt}pt, margins ${config.marginIn}in, line height ${config.lineHeight}). Could not drop: ${reason}.`,
  );
  return done(false);
}

function describeTightening(from: LayoutConfig, to: LayoutConfig): string {
  const keys = ["bodyPt", "headingPt", "namePt", "marginIn", "lineHeight", "sectionGapPt", "entryGapPt", "bulletIndentPt"] as const;
  const ch = keys.filter((k) => from[k] !== to[k]).map((k) => `${k} ${from[k]} -> ${to[k]}`);
  return `Tightened spacing within readable floors: ${ch.join(", ")}.`;
}
