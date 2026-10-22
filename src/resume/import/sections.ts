import type { SectionKey } from "../schema";
import { WIDE_GAP, type ExtractedLine } from "./extract";

export type RawSectionKey = SectionKey | "contact" | "unknown";
export type RawSection = {
  key: RawSectionKey;
  heading: string;
  /** 0..1. Below 0.6 the section is "uncertain": its facts are flagged and the confirm UI shows it first. */
  confidence: number;
  lines: string[];
  /** Same known heading seen more than once: the order is ambiguous. */
  duplicate: boolean;
};

const SYNONYMS: Record<SectionKey, string[]> = {
  summary: ["summary", "professional summary", "career summary", "profile", "professional profile", "objective", "career objective", "about me", "about"],
  education: ["education", "academic background", "academics", "educational qualifications", "academic qualifications", "education and training", "education and certifications"],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "relevant experience",
    "industry experience",
    "employment",
    "employment history",
    "work history",
    "internships",
    "internship experience",
    "internship",
    "career history",
  ],
  projects: ["projects", "academic projects", "personal projects", "selected projects", "key projects", "technical projects", "side projects", "project experience", "relevant projects"],
  skills: ["skills", "technical skills", "key skills", "core skills", "core competencies", "skills and tools", "tools and technologies", "technologies", "skills and technologies", "technical proficiencies"],
  certifications: [
    "certifications",
    "certification",
    "licenses and certifications",
    "licences and certifications",
    "licenses",
    "certificates",
    "certifications and courses",
    "courses and certifications",
    "courses",
    "training",
  ],
  achievements: ["achievements", "accomplishments", "awards", "honors", "honours", "awards and honors", "awards and honours", "honors and awards", "honours and awards", "achievements and awards", "extracurricular activities"],
};

const EXACT = new Map<string, SectionKey>();
for (const [key, list] of Object.entries(SYNONYMS) as [SectionKey, string[]][]) for (const s of list) EXACT.set(s, key);

const FUZZY: [RegExp, SectionKey][] = [
  [/\bexperience\b|\bemployment\b/, "experience"],
  [/\bprojects?\b/, "projects"],
  [/\beducation\b|\bacademic/, "education"],
  [/\bskills?\b|\btechnologies\b|\bcompetenc/, "skills"],
  [/\bcertif|\blicen[cs]es?\b/, "certifications"],
  [/\bachievements?\b|\bawards?\b|\bhonou?rs\b/, "achievements"],
  [/\bsummary\b|\bobjective\b|\bprofile\b/, "summary"],
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function classifyHeading(text: string): { key: SectionKey; confidence: number } | null {
  const n = normalize(text);
  if (!n) return null;
  const exact = EXACT.get(n);
  if (exact) return { key: exact, confidence: 0.95 };
  if (n.split(" ").length <= 4) for (const [re, key] of FUZZY) if (re.test(n)) return { key, confidence: 0.75 };
  return null;
}

const isCaps = (s: string) => /[A-Z]{3}/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s);
const cleanHeading = (s: string) => s.replace(/[:–—-]+\s*$/, "").replace(/^[\s_=*#-]+|[\s_=*#-]+$/g, "").trim();

/** Splits the line stream into a contact preamble and headed sections. Nothing is dropped; unplaceable sections get key "unknown". */
export function splitSections(lines: ExtractedLine[]): RawSection[] {
  type Head = { index: number; heading: string; key: RawSectionKey; confidence: number };
  const heads: Head[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.text.startsWith("- ")) continue;
    const bare = cleanHeading(line.text);
    if (!bare || bare.length > 60 || line.text.includes(WIDE_GAP) || /[@|]/.test(bare)) continue;
    const hasValueAfterColon = /:\s*\S/.test(line.text);
    if (hasValueAfterColon) continue;
    const cls = classifyHeading(bare);
    const exactName = EXACT.has(normalize(bare));
    const knownSeen = heads.some((h) => h.key !== "unknown");
    if (cls && (exactName || line.heading || isCaps(bare) || line.text.trimEnd().endsWith(":")) && (i > 0 || exactName)) {
      heads.push({ index: i, heading: bare, key: cls.key, confidence: line.heading || exactName || isCaps(bare) ? cls.confidence : Math.min(cls.confidence, 0.75) });
    } else if (i > 0 && (line.heading || (knownSeen && isCaps(bare) && bare.split(" ").length <= 4 && !/\d/.test(bare)))) {
      heads.push({ index: i, heading: bare, key: "unknown", confidence: 0.3 });
    }
  }

  const out: RawSection[] = [];
  const firstHead = heads[0]?.index ?? lines.length;
  const pre = lines.slice(0, firstHead).map((l) => l.text);
  if (heads.length === 0) {
    // No headings at all: keep a short contact block and the rest as an unknown section.
    // Contact = the name line plus everything up to the last of the first four lines that carries an email, phone or link.
    let n = Math.min(pre.length, 1);
    for (let i = 1; i < Math.min(pre.length, 4); i++) if (/@|https?:\/\/|www\.|linkedin\.com|github\.com|\+?\d[\d\s().-]{7,}\d/i.test(pre[i]!)) n = i + 1;
    const contact = pre.slice(0, n);
    const rest = pre.slice(n);
    if (contact.length) out.push({ key: "contact", heading: "Contact", confidence: 0.5, lines: contact, duplicate: false });
    if (rest.length) out.push({ key: "unknown", heading: "", confidence: 0.2, lines: rest, duplicate: false });
    return out;
  }
  if (pre.length) out.push({ key: "contact", heading: "Contact", confidence: 0.9, lines: pre, duplicate: false });

  const seen = new Set<string>();
  heads.forEach((h, idx) => {
    const end = heads[idx + 1]?.index ?? lines.length;
    const body = lines.slice(h.index + 1, end).map((l) => l.text);
    const duplicate = h.key !== "unknown" && seen.has(h.key);
    seen.add(h.key);
    out.push({ key: h.key, heading: h.heading, confidence: duplicate ? Math.min(h.confidence, 0.5) : h.confidence, lines: body, duplicate });
  });
  return out;
}
