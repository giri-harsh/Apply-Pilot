/** Splits job-description text into the sections SPEC 8.2 asks for. Pure text in, plain data out. */

export type SectionName = "responsibilities" | "preferred" | "required" | "other";

export type ParsedSections = {
  responsibilities: string[];
  required: string[];
  preferred: string[];
  /** True when at least one recognised heading was found. */
  foundHeadings: boolean;
};

// Order matters: "preferred qualifications" must win over the generic "qualifications".
const HEADING_RULES: { name: SectionName; re: RegExp }[] = [
  { name: "preferred", re: /^(preferred|desired|bonus|nice[- ]to[- ]haves?|good[- ]to[- ]haves?|plus(es)?|additional (skills|qualifications|experience))\b.*$/i },
  { name: "preferred", re: /^(it'?s a plus|extra credit)\b.*$/i },
  {
    name: "responsibilities",
    re: /^((key |core |main )?(responsibilities|duties)|what you(?:'|’)?ll (do|be doing|work on)|what you will (do|be doing|work on)|your (role|impact)|the role|in this role|day[- ]to[- ]day|about the role)\b.*$/i,
  },
  {
    name: "required",
    re: /^((minimum |basic |required |essential )?(qualifications|requirements|skills( and experience)?)|what we(?:'|’)?re looking for|what you(?:'|’)?ll bring|what you bring|who you are|you have|must[- ]haves?|about you|eligibility)\b.*$/i,
  },
  {
    name: "other",
    re: /^(benefits|perks|what we offer|about (us|the company|the team|[A-Z][\w&. ]{1,40})|who we are|equal opportunity|diversity|how to apply|application process|compensation|salary|our (mission|values|culture)|why join)\b.*$/i,
  },
];

const BULLET = /^\s*(?:[-*•·▪◦–—✓✔►»]|\d{1,2}[.)])\s+/;

/** A heading line is short, has no sentence punctuation, and matches a known pattern. */
export function classifyHeading(line: string): SectionName | null {
  const t = line.replace(/[:：]\s*$/, "").trim();
  if (t.length === 0 || t.length > 70 || /[.!?]$/.test(t)) return null;
  for (const r of HEADING_RULES) if (r.re.test(t)) return r.name;
  return null;
}

export function splitSections(text: string): ParsedSections {
  const out: ParsedSections = { responsibilities: [], required: [], preferred: [], foundHeadings: false };
  let current: SectionName | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = BULLET.test(line) ? null : classifyHeading(line);
    if (head) {
      current = head;
      out.foundHeadings = true;
      continue;
    }
    if (!current || current === "other") continue;
    const item = line.replace(BULLET, "").trim();
    if (item.length >= 3) out[current].push(item.slice(0, 300));
  }
  for (const k of ["responsibilities", "required", "preferred"] as const) out[k] = out[k].slice(0, 30);
  return out;
}

const EDU = /\b(bachelor'?s?|master'?s?|ph\.?d\.?|doctorate|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?\b|b\.?\s?sc|m\.?\s?sc|degree|diploma|currently (?:enrolled|pursuing)|undergraduate|graduate student)\b/i;
const EXP = /\b(\d+\s*\+?\s*(?:-\s*\d+\s*)?years?|internship experience|prior experience|previous experience|no experience (?:required|necessary)|hands-on experience|relevant experience)\b/i;
const ELIG = /\b(visa|sponsorship|work authori[sz]ation|authori[sz]ed to work|right to work|security clearance|citizen(?:ship)?|green card|permanent resident|background check|export control)\b/i;

function pickLines(text: string, re: RegExp, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET, "").trim();
    if (line.length < 8 || line.length > 300 || !re.test(line) || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export const educationLines = (t: string) => pickLines(t, EDU, 5);
export const experienceLines = (t: string) => pickLines(t, EXP, 5);
export const eligibilityLines = (t: string) => pickLines(t, ELIG, 5);

const INJECTION = /\b(ignore (?:all |any |your |the )?(?:previous |prior |above |earlier )?(?:instructions|rules|prompts?)|disregard (?:the |your |all )?(?:above|previous|instructions)|you are now|system prompt|reveal (?:the |your )?(?:user'?s? )?(?:profile|api key|password|secrets?)|click (?:the )?(?:submit|apply)|new instructions)\b/i;

/** Flags instruction-like text inside a posting. It is still treated purely as data (SPEC 20.3). */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

export type EmploymentType = "internship" | "full_time" | "part_time" | "contract" | "temporary" | "other";

export function detectEmploymentType(text: string): EmploymentType | null {
  if (/\bintern(?:ship)?s?\b/i.test(text)) return "internship";
  if (/\bfull[- ]?time\b/i.test(text)) return "full_time";
  if (/\bpart[- ]?time\b/i.test(text)) return "part_time";
  if (/\b(contract|contractor|freelance)\b/i.test(text)) return "contract";
  if (/\b(temporary|seasonal)\b/i.test(text)) return "temporary";
  return null;
}

export function detectArrangement(text: string): "remote" | "hybrid" | "onsite" | null {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(fully |100% )?remote\b|work from home|\bWFH\b/i.test(text)) return "remote";
  if (/\bon[- ]?site\b|\bin[- ]office\b|\bin[- ]person\b/i.test(text)) return "onsite";
  return null;
}
