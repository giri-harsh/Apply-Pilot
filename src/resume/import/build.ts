import type { Fact, MasterEntry, SectionKey, SkillGroup } from "../schema";
import { WIDE_GAP } from "./extract";
import { stableId } from "./ids";

export type BuildCtx = { filename: string; nowIso: string };
export type Contact = {
  name: Fact;
  email?: Fact;
  phone?: Fact;
  location?: Fact;
  links: { label: string; url: string; fact: Fact }[];
};
export type Contribution = {
  contact?: Contact;
  summary?: Fact;
  entries: MasterEntry[];
  skillGroups: SkillGroup[];
  achievements: Fact[];
  warnings: string[];
};
export type SectionInput = { key: SectionKey | "contact"; confidence: number; sourceText: string };

export const UNTITLED = "(untitled entry)";
export const LOW_CONFIDENCE_BELOW = 0.6;

const MAX_FACT = 600;
const MAX_SOURCE = 1200;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const stripBullet = (s: string) => s.replace(/^-\s+/, "");
const isBullet = (s: string) => s.startsWith("- ");

// ------------------------------------------------------------------ facts

type FactMeta = { id: string; low: boolean; source: string[] };

function mkFact(text: string, meta: FactMeta, ctx: BuildCtx): Fact {
  const clean = squash(text);
  const truncated = clean.length > MAX_FACT;
  const source = meta.source.join("\n").trim();
  return {
    factId: meta.id,
    text: truncated ? clean.slice(0, MAX_FACT).trim() : clean,
    provenance: { source: "resume_import_approved", recordedAt: ctx.nowIso, note: `parsed from ${ctx.filename}; not yet confirmed`.slice(0, 500) },
    sourceText: (source || clean).slice(0, MAX_SOURCE),
    lowConfidence: meta.low || truncated,
  };
}

const factId = (pos: string, text: string) => stableId("f", pos, squash(text));

// ------------------------------------------------------------------ dates and meta lines

const D = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(?:19|20)\d{2}`;
const RANGE_SRC = String.raw`(?:expected\s+)?${D}(?:\s*(?:-|–|—|to)\s*(?:${D}|present|current|ongoing|now))?`;
const RANGE_FULL = new RegExp(String.raw`^\(?${RANGE_SRC}\)?$`, "i");
const RANGE_TRAILING = new RegExp(String.raw`(?:^|[\s|,(])(\(?${RANGE_SRC}\)?)\s*$`, "i");

const TECH_LINE = /^(?:tech(?:nologies)?(?:\s+stack)?|tools?(?:\s+used)?|built\s+with|stack|libraries)\s*[:-]\s*(.+)$/i;

/** Splits one line into text parts, keeping order. Column gaps and pipes both separate parts. */
const partsOf = (line: string) => line.split(new RegExp(`${WIDE_GAP}\\s*|\\s+\\|\\s+|\\s*\\u2022\\s+`)).map((p) => p.trim()).filter(Boolean);

type Parsed = { title: string; dates: string; extras: string[]; suspect: boolean };

/** Pulls a date range and side parts out of a heading / meta line. */
export function splitDates(line: string): Parsed {
  const parts = partsOf(line);
  let dates = "";
  const rest: string[] = [];
  for (const p of parts) {
    if (!dates && RANGE_FULL.test(p)) dates = p.replace(/^\(|\)$/g, "");
    else rest.push(p);
  }
  if (!dates && rest.length) {
    const last = rest[rest.length - 1]!;
    const m = RANGE_TRAILING.exec(last);
    if (m && m[1]) {
      dates = m[1].replace(/^\(|\)$/g, "").trim();
      rest[rest.length - 1] = last.slice(0, m.index === 0 && !/^[\s|,(]/.test(last) ? 0 : m.index).trim().replace(/[,|(\s]+$/, "");
      if (!rest[rest.length - 1]) rest.pop();
    }
  }
  const [title = "", ...extras] = rest;
  // Column merge: a wide gap followed by something that is neither a date nor a short place name.
  const gapParts = line.split(WIDE_GAP).map((p) => p.trim()).filter(Boolean);
  const suspect = gapParts.length > 1 && gapParts.slice(1).some((p) => !RANGE_FULL.test(p) && !(p.length <= 40 && !/[.!?;]$/.test(p) && p.split(" ").length <= 5));
  return { title, dates, extras, suspect };
}

/** True for a line that looks like two columns merged into one (a wide gap not explained by right-aligned dates / a place). */
export function isColumnMerge(line: string): boolean {
  if (!line.includes(WIDE_GAP)) return false;
  return isBullet(line) || splitDates(line).suspect;
}

const isDateOnly =(line: string) => partsOf(line).every((p) => RANGE_FULL.test(p));
const hasDate = (line: string) => RANGE_TRAILING.test(line) || partsOf(line).some((p) => RANGE_FULL.test(p));
const looksLikePlace = (s: string) => /^[A-Za-z][A-Za-z .'-]*(?:,\s*[A-Za-z][A-Za-z .'-]*)*$/.test(s) && s.length <= 60;

/** A short non-bullet line directly under an entry heading that carries dates / place / tech rather than a title. */
const isMeta = (line: string) => TECH_LINE.test(line) || isDateOnly(line) || (hasDate(line) && line.length <= 90 && partsOf(line).length > 1);

// ------------------------------------------------------------------ entries

type Group = { head: string[]; bullets: string[][]; orphan: boolean };

function groupLines(lines: string[]): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  const lastBullet = () => cur?.bullets[cur.bullets.length - 1];
  for (const line of lines) {
    if (isBullet(line)) {
      if (!cur) {
        cur = { head: [], bullets: [], orphan: true };
        groups.push(cur);
      }
      cur.bullets.push([line]);
      continue;
    }
    const lb = lastBullet();
    const continuation = (b: string[] | undefined) => !!b && (/^[a-z(]/.test(line) || /[,(&]$|\b(?:and|with|or|of|to|in|for)$/i.test(b[b.length - 1]!));
    if (cur && cur.bullets.length > 0 && continuation(lb)) {
      lb!.push(line);
      continue;
    }
    if (cur && cur.bullets.length === 0 && cur.head.length > 0) {
      const titles = cur.head.filter((h) => !isMeta(h)).length;
      if (line.length > 90 && !isMeta(line)) {
        cur.bullets.push([line]); // a long descriptive line under a heading is the entry's description
        continue;
      }
      if (isMeta(line) || titles < 2) {
        cur.head.push(line);
        continue;
      }
    }
    cur = { head: [line], bullets: [], orphan: false };
    groups.push(cur);
  }
  return groups;
}

const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s|,;)]+|\b(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s|,;)]+/gi;
const withScheme = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function buildEntry(section: SectionKey, g: Group, ei: number, pos: string, lowBase: boolean, ctx: BuildCtx): MasterEntry {
  const ep = `${pos}e${ei}`;
  const extraBullets: { text: string; source: string; low: boolean }[] = [];
  let dates = "";
  let location = "";
  const technologies: string[] = [];
  const links: MasterEntry["links"] = [];
  const titles: { text: string; source: string; low: boolean }[] = [];

  g.head.forEach((line, i) => {
    const tech = TECH_LINE.exec(line);
    if (tech) {
      for (const t of splitList(tech[1] ?? "")) if (technologies.length < 40) technologies.push(t.slice(0, 60));
      return;
    }
    const urls = line.match(URL_IN_TEXT) ?? [];
    for (const u of urls) if (links.length < 6) links.push({ label: "link", url: withScheme(u).slice(0, 500), factId: stableId("f", `${ep}l${links.length}`, u) });
    const sp = splitDates(line);
    if (sp.dates && !dates) dates = sp.dates.slice(0, 80);
    // A later line that starts with its dates ("Jun 2025 - Aug 2025 | Remote") is a meta line: nothing in it is a title.
    const dateFirst = i > 0 && RANGE_FULL.test(partsOf(line)[0] ?? "");
    const title = dateFirst ? "" : sp.title;
    const extras = dateFirst ? [sp.title, ...sp.extras].filter(Boolean) : sp.extras;
    for (const x of extras) {
      if (!location && looksLikePlace(x)) location = x.slice(0, 120);
      else extraBullets.push({ text: x, source: line, low: sp.suspect || lowBase });
    }
    if (title) titles.push({ text: title, source: line, low: sp.suspect || lowBase });
  });

  const heading = titles[0];
  const sub = titles[1];
  // Third and later title lines are kept as extra facts, never dropped.
  for (const t of titles.slice(2)) extraBullets.push(t);

  const headFact = mkFact(heading?.text ?? UNTITLED, { id: factId(`${ep}h`, heading?.text ?? UNTITLED), low: !heading || heading.low || g.orphan, source: heading ? [heading.source] : [] }, ctx);
  const subFact = sub ? mkFact(sub.text, { id: factId(`${ep}s`, sub.text), low: sub.low, source: [sub.source] }, ctx) : undefined;

  const bullets: Fact[] = [];
  const addBullet = (text: string, source: string[], low: boolean) => {
    if (bullets.length >= 30) return;
    bullets.push(mkFact(text, { id: factId(`${ep}b${bullets.length}`, text), low, source }, ctx));
  };
  for (const x of extraBullets) addBullet(x.text, [x.source], x.low);
  for (const b of g.bullets) {
    const text = squash(b.map(stripBullet).join(" "));
    const suspect = b.some((l) => l.includes(WIDE_GAP));
    addBullet(text, b, lowBase || suspect);
  }

  return {
    entryId: stableId("e", `${pos}e${ei}`, headFact.text),
    section,
    heading: headFact,
    ...(subFact ? { subheading: subFact } : {}),
    dates,
    location,
    bullets,
    technologies,
    links,
  };
}

function buildEntries(section: SectionKey, lines: string[], pos: string, lowBase: boolean, ctx: BuildCtx): { entries: MasterEntry[]; warnings: string[] } {
  const groups = groupLines(lines);
  const warnings: string[] = [];
  let entries = groups.map((g, i) => buildEntry(section, g, i, pos, lowBase, ctx));
  if (entries.length > 120) {
    warnings.push(`Only the first 120 ${section} entries were imported.`);
    entries = entries.slice(0, 120);
  }
  return { entries, warnings };
}

/** Certifications: every line is its own record (wrapped continuation lines are joined). */
function buildCertifications(lines: string[], pos: string, lowBase: boolean, ctx: BuildCtx): MasterEntry[] {
  const items: string[][] = [];
  for (const line of lines) {
    const prev = items[items.length - 1];
    if (prev && !isBullet(line) && /^[a-z(]/.test(line)) prev.push(line);
    else items.push([line]);
  }
  return items.map((item, i) => {
    const raw = squash(item.map(stripBullet).join(" "));
    const sp = splitDates(raw.replace(new RegExp(`\\s{2,}`, "g"), "   "));
    const title = [sp.title, ...sp.extras].filter(Boolean).join(" - ") || raw;
    const ep = `${pos}e${i}`;
    return {
      entryId: stableId("e", ep, title),
      section: "certifications" as const,
      heading: mkFact(title, { id: factId(`${ep}h`, title), low: lowBase || sp.suspect, source: item }, ctx),
      dates: sp.dates.slice(0, 80),
      location: "",
      bullets: [],
      technologies: [],
      links: [],
    };
  });
}

// ------------------------------------------------------------------ skills

function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === ";" || ch === "|" || ch === "•")) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.flatMap((x) => x.split(WIDE_GAP)).map((x) => squash(x).replace(/[.\s]+$/, "")).filter(Boolean);
}

function buildSkills(lines: string[], pos: string, lowBase: boolean, ctx: BuildCtx): { groups: SkillGroup[]; warnings: string[] } {
  type Raw = { label: string; text: string; source: string[]; suspect: boolean };
  const raws: Raw[] = [];
  let pendingLabel: string | null = null;
  for (const line of lines) {
    const body = stripBullet(line);
    const m = /^([^:]{1,50}):\s*(.*)$/.exec(body);
    if (m && !/^https?$/i.test(m[1]!)) {
      const label = squash(m[1]!);
      const rest = m[2] ?? "";
      if (rest === "") {
        pendingLabel = label;
        continue;
      }
      raws.push({ label, text: rest, source: [line], suspect: false });
      pendingLabel = null;
      continue;
    }
    const prev = raws[raws.length - 1];
    if (pendingLabel) {
      raws.push({ label: pendingLabel, text: body, source: [line], suspect: false });
      pendingLabel = null;
    } else if (prev && !isBullet(line) && (/^[a-z]/.test(body) || /[,;]$/.test(prev.text))) {
      prev.text += ` ${body}`;
      prev.source.push(line);
    } else raws.push({ label: "Skills", text: body, source: [line], suspect: false });
  }
  const warnings: string[] = [];
  const groups: SkillGroup[] = [];
  for (const [gi, r] of raws.entries()) {
    if (groups.length >= 20) {
      warnings.push("Only the first 20 skill groups were imported.");
      break;
    }
    let items = splitList(r.text);
    if (items.length > 60) {
      warnings.push(`Skill group "${r.label}" had more than 60 items; only the first 60 were imported.`);
      items = items.slice(0, 60);
    }
    const low = lowBase;
    const gp = `${pos}g${gi}`;
    groups.push({
      groupId: stableId("g", gp, r.label),
      label: r.label.slice(0, 80),
      items: items.map((it, ii) => mkFact(it, { id: factId(`${gp}i${ii}`, it), low, source: r.source }, ctx)),
    });
  }
  return { groups, warnings };
}

// ------------------------------------------------------------------ single-fact sections

function buildSummary(lines: string[], pos: string, lowBase: boolean, ctx: BuildCtx): Fact | undefined {
  const text = squash(lines.map(stripBullet).join(" "));
  if (!text) return undefined;
  return mkFact(text, { id: factId(`${pos}s`, text), low: lowBase || lines.some((l) => l.includes(WIDE_GAP)), source: lines }, ctx);
}

function buildAchievements(lines: string[], pos: string, lowBase: boolean, ctx: BuildCtx): Fact[] {
  const items: string[][] = [];
  for (const line of lines) {
    const prev = items[items.length - 1];
    if (prev && !isBullet(line) && /^[a-z(]/.test(line)) prev.push(line);
    else items.push([line]);
  }
  return items.slice(0, 30).map((item, i) => {
    const text = squash(item.map(stripBullet).join(" "));
    return mkFact(text, { id: factId(`${pos}a${i}`, text), low: lowBase || item.some((l) => l.includes(WIDE_GAP)), source: item }, ctx);
  });
}

// ------------------------------------------------------------------ contact

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d[\d\s.-]{6,16}\d/;
const CONTACT_URL = /(?:https?:\/\/|www\.)[^\s|,;]+|\b(?:linkedin\.com|github\.com|gitlab\.com|kaggle\.com|medium\.com|behance\.net)\/?[^\s|,;]*|\b[a-z0-9-]+\.(?:dev|io|me|app)\b\/?[^\s|,;]*/gi;

function linkLabel(url: string): string {
  const host = /(?:https?:\/\/)?(?:www\.)?([^/\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? "link";
  if (host.includes("linkedin")) return "LinkedIn";
  if (host.includes("github")) return "GitHub";
  return host.slice(0, 60);
}

export function buildContact(lines: string[], confidence: number, ctx: BuildCtx): { contact: Contact; warnings: string[] } {
  const low = confidence < LOW_CONFIDENCE_BELOW;
  const warnings: string[] = [];
  const hasUrl = new RegExp(CONTACT_URL.source, "i");
  const first = lines.findIndex((l) => !EMAIL.test(l) && !hasUrl.test(l) && !isBullet(l));
  const nameLine = first >= 0 ? lines[first]! : "";
  const nameParts = nameLine.split(WIDE_GAP).map((p) => p.trim()).filter(Boolean);
  const nameText = squash(nameParts[0] ?? "");
  const rest = [...nameParts.slice(1), ...lines.filter((_, i) => i !== first)];

  const nameOdd = !nameText || /\d|@/.test(nameText) || nameText.split(" ").length > 6 || nameText.length > 60;
  const name = mkFact(nameText, { id: factId("c.name", nameText), low: low || nameOdd, source: nameLine ? [nameLine] : [] }, ctx);
  if (!nameText) warnings.push("Could not find your name in the file.");

  let emailText = "";
  let phoneText = "";
  const links: Contact["links"] = [];
  const leftovers: string[] = [];
  for (const line of rest) {
    let work = line;
    const em = EMAIL.exec(work);
    if (em && !emailText) emailText = em[0];
    if (em) work = work.replace(em[0], " ");
    const urls = work.match(CONTACT_URL) ?? [];
    for (const u of urls) {
      work = work.replace(u, " ");
      if (links.length < 8 && !links.some((l) => l.fact.text === u)) {
        links.push({ label: linkLabel(u), url: withScheme(u).slice(0, 500), fact: mkFact(u, { id: factId("c.link", u), low, source: [line] }, ctx) });
      }
    }
    const ph = PHONE.exec(work);
    if (ph) {
      const digits = ph[0].replace(/\D/g, "").length;
      if (digits >= 8 && digits <= 15 && !phoneText && !RANGE_FULL.test(ph[0].trim())) {
        phoneText = ph[0].trim();
        work = work.replace(ph[0], " ");
      }
    }
    for (const seg of work.split(/\s*[|•·]\s*|\s{3,}/)) {
      const s = squash(seg).replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "");
      if (s) leftovers.push(s);
    }
  }
  const locText = leftovers.find((s) => s.length <= 60 && /[A-Za-z]{2,}/.test(s) && !/@/.test(s));
  const src = (re: RegExp | string) => lines.filter((l) => (typeof re === "string" ? l.includes(re) : re.test(l)));
  const contact: Contact = {
    name,
    ...(emailText ? { email: mkFact(emailText, { id: factId("c.email", emailText), low, source: src(emailText) }, ctx) } : {}),
    ...(phoneText ? { phone: mkFact(phoneText, { id: factId("c.phone", phoneText), low, source: src(phoneText) }, ctx) } : {}),
    ...(locText ? { location: mkFact(locText, { id: factId("c.loc", locText), low: low || !looksLikePlace(locText), source: src(locText) }, ctx) } : {}),
    links,
  };
  if (!emailText) warnings.push("No email address was found in the contact block.");
  return { contact, warnings };
}

// ------------------------------------------------------------------ dispatcher

export function buildContribution(section: SectionInput, position: number, ctx: BuildCtx): Contribution {
  const lines = section.sourceText.split("\n").filter((l) => l.trim() !== "");
  const lowBase = section.confidence < LOW_CONFIDENCE_BELOW;
  const pos = `${section.key}${position}`;
  const empty: Contribution = { entries: [], skillGroups: [], achievements: [], warnings: [] };
  switch (section.key) {
    case "contact": {
      const { contact, warnings } = buildContact(lines, section.confidence, ctx);
      return { ...empty, contact, warnings };
    }
    case "summary": {
      const summary = buildSummary(lines, pos, lowBase, ctx);
      return { ...empty, ...(summary ? { summary } : {}) };
    }
    case "skills": {
      const { groups, warnings } = buildSkills(lines, pos, lowBase, ctx);
      return { ...empty, skillGroups: groups, warnings };
    }
    case "achievements":
      return { ...empty, achievements: buildAchievements(lines, pos, lowBase, ctx) };
    case "certifications":
      return { ...empty, entries: buildCertifications(lines, pos, lowBase, ctx) };
    default: {
      const { entries, warnings } = buildEntries(section.key, lines, pos, lowBase, ctx);
      return { ...empty, entries, warnings };
    }
  }
}
