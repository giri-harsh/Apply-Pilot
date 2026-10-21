import type { SemanticType } from "@/shared/form";

export type AliasRule = { type: SemanticType; exact?: string[]; patterns?: RegExp[] };

/**
 * Semantic alias dictionary. Order matters: sensitive and consent rules come first so that
 * e.g. "Do you require visa sponsorship?" can never be read as a plain text field.
 * Input is normalized lowercase text (see normalizeForMatch).
 */
export const ALIAS_RULES: AliasRule[] = [
  // ---- sensitive / eligibility: recognised only so they can be flagged ----
  { type: "sponsorship", patterns: [/\bsponsor/, /\bvisa\b/, /\bimmigration\b/] },
  {
    type: "work_authorization",
    patterns: [
      /\bauthori[sz](ed|ation)\b.*\bwork\b/,
      /\bwork\b.*\bauthori[sz]/,
      /\bright to work\b/,
      /\b(legally|eligible) .*\bwork\b/,
      /\bwork permit\b/,
      /\bcitizen/,
    ],
  },
  { type: "disability", patterns: [/\bdisabilit/, /\bdisabled\b/] },
  { type: "veteran_status", patterns: [/\bveteran/, /\bmilitary\b/] },
  { type: "race_ethnicity", patterns: [/\brace\b/, /\bracial\b/, /\bethnic/, /\bhispanic\b/, /\blatino\b/] },
  { type: "gender", patterns: [/\bgender\b/, /\bsex\b/, /\bpronoun/, /\bsexual orientation\b/, /\btransgender\b/] },
  { type: "criminal_history", patterns: [/\bconvict/, /\bcriminal\b/, /\bfelony\b/, /\barrest/, /\bbackground check\b/] },
  {
    type: "salary",
    patterns: [/\bsalary\b/, /\bcompensation\b/, /\bctc\b/, /\bpay (expectation|rate)/, /\bexpected (pay|wage)/, /\bremuneration\b/],
  },
  { type: "date_of_birth", patterns: [/\bdate of birth\b/, /\bdob\b/, /\bbirth ?date\b/, /\bbirthday\b/] },
  { type: "age", exact: ["age", "your age"], patterns: [/\b(at least|over|above) (18|21)\b/, /\b(18|21) years\b/] },
  { type: "relocation", patterns: [/\brelocat/] },

  // ---- consent / declarations ----
  {
    type: "consent",
    patterns: [
      /\bi (agree|accept|certify|acknowledge|consent|confirm|declare|understand|attest|authori[sz]e)\b/,
      /\bterms\b/,
      /\bprivacy (policy|notice)\b/,
      /\bdeclaration\b/,
      /\bconsent\b/,
      /\bcertify\b/,
    ],
  },

  // ---- uploads ----
  { type: "cover_letter_upload", patterns: [/\bcover letter\b/] },
  { type: "resume_upload", patterns: [/\b(resume|cv|curriculum vitae)\b/] },

  // ---- identity ----
  { type: "email", patterns: [/\be-?mail\b/, /^inputtype:email$/, /^autocomplete:email$/] },
  {
    type: "phone",
    patterns: [/\b(phone|mobile|telephone|cell(ular)?|contact number)\b/, /^inputtype:tel$/, /^autocomplete:tel/],
  },
  { type: "first_name", patterns: [/\b(first|given|fore) ?name\b/, /^autocomplete:given-name$/] },
  { type: "last_name", patterns: [/\b(last|family|sur) ?name\b/, /^autocomplete:family-name$/] },
  { type: "preferred_name", patterns: [/\b(preferred|nick) ?name\b/, /\bgoes by\b/, /^autocomplete:nickname$/] },
  {
    type: "full_name",
    exact: ["name", "your name", "full name", "legal name", "applicant name", "candidate name", "complete name"],
    patterns: [/\b(full|legal|complete) name\b/, /\bapplicant'?s? name\b/, /^autocomplete:name$/],
  },

  // ---- address ----
  { type: "postal_code", patterns: [/\b(zip|postal|post) ?(code)?\b/, /\bpincode\b/, /^autocomplete:postal-code$/] },
  { type: "city", exact: ["city", "town"], patterns: [/\bcity\b/, /\btown\b/, /^autocomplete:address-level2$/] },
  { type: "country", patterns: [/\bcountry\b/, /^autocomplete:country/] },
  { type: "state", patterns: [/\b(state|province|region)\b/, /^autocomplete:address-level1$/] },
  {
    type: "address_line",
    patterns: [/\b(street )?address( line)?( ?[12])?\b/, /\bstreet\b/, /^autocomplete:(street-address|address-line)/],
  },

  // ---- links ----
  { type: "linkedin", patterns: [/\blinkedin\b/] },
  { type: "github", patterns: [/\bgithub\b/] },
  { type: "portfolio", patterns: [/\bportfolio\b/, /\bpersonal (web ?site|site|page)\b/, /\bwebsite\b/, /\bhomepage\b/] },

  // ---- education ----
  { type: "gpa", patterns: [/\bc?gpa\b/, /\bgrade point\b/] },
  {
    type: "graduation_year",
    patterns: [/\bgraduat\w*\b.*\b(year|date)\b/, /\b(year|date)\b.*\bgraduat/, /\bgrad(uation)? year\b/, /\bexpected graduation\b/],
  },
  { type: "field_of_study", patterns: [/\bmajor\b/, /\bfield of study\b/, /\bdiscipline\b/, /\bspeciali[sz]ation\b/, /\bcourse of study\b/] },
  { type: "degree", patterns: [/\bdegree\b/, /\bqualification level\b/] },
  { type: "institution", patterns: [/\b(college|university|school|institution|institute)\b/] },

  // ---- professional ----
  { type: "current_employer", patterns: [/\b(current|present|most recent) (employer|company|organi[sz]ation)\b/] },
  { type: "current_title", patterns: [/\b(current|present|most recent) (job )?(title|position|role)\b/] },
  { type: "notice_period", patterns: [/\bnotice period\b/] },
  { type: "availability_date", patterns: [/\bavailab(le|ility)\b/, /\bearliest start\b/, /\bwhen can you start\b/] },

  // ---- open-ended ----
  {
    type: "open_ended",
    patterns: [
      /\bwhy\b/,
      /\bdescribe\b/,
      /\btell us\b/,
      /\bexplain\b/,
      /\bwhat (interests|motivates|excites)\b/,
      /\bcover letter\b/,
      /\badditional (information|comments?)\b/,
      /\banything else\b/,
      /\babout yourself\b/,
      /\bstrengths?\b/,
    ],
  },
];

/** Section headings that mean the fields belong to someone other than the applicant. */
export const THIRD_PARTY_SECTION =
  /\b(reference|referee|recommender|emergency|guardian|spouse|parent|next of kin|supervisor|manager)\b/i;

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*:?()[\]{}"`.,;!]/g, " ")
    .replace(/\b(required|optional|mandatory)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchAliases(text: string): { type: SemanticType; exact: boolean } | null {
  const t = normalizeForMatch(text);
  if (!t) return null;
  for (const rule of ALIAS_RULES) {
    if (rule.exact?.includes(t)) return { type: rule.type, exact: true };
  }
  for (const rule of ALIAS_RULES) {
    if (rule.patterns?.some((p) => p.test(t))) return { type: rule.type, exact: false };
  }
  return null;
}
