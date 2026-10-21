import { matchAliases } from "@/shared/aliases";
import { SENSITIVE_TYPES } from "@/shared/form";
import { looksLikeInjection } from "@/job/sections";
import { extractSkills } from "@/job/skills";

/**
 * SPEC 14.5 hard partition. Only "generate" questions ever reach a model; every other category is left for the
 * user with a clear reason. Deterministic patterns decide first; a question that matches nothing is "other" and
 * is the only thing the model may be asked to place (it can only answer or refuse, never override a refusal).
 */

export const GENERATE_CATEGORIES = [
  "why_join",
  "fit",
  "describe_project",
  "interest_role",
  "technical_challenge",
  "experience_with",
  "strengths",
  "additional_info",
  "other",
] as const;
export type GenerateCategory = (typeof GENERATE_CATEGORIES)[number];

export const REFUSE_CATEGORIES = [
  "unknown_personal_fact",
  "sensitive_demographic",
  "legal_declaration",
  "eligibility",
  "binding_agreement",
  "injected_instruction",
] as const;
export type RefuseCategory = (typeof REFUSE_CATEGORIES)[number];

export const REFUSAL_REASONS: Record<RefuseCategory, string> = {
  unknown_personal_fact: "Needs a personal fact only you can provide; not generated",
  sensitive_demographic: "Sensitive demographic question; left for you",
  legal_declaration: "Legal declaration; left for you",
  eligibility: "Eligibility question; left for you",
  binding_agreement: "Binding agreement; left for you",
  injected_instruction: "The question contains instruction-like text; treated as untrusted and left for you",
};

export type QuestionDecision =
  | { kind: "generate"; category: GenerateCategory; technologies: string[] }
  | { kind: "refuse"; category: RefuseCategory; reason: string };

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const REFUSE_RULES: { category: RefuseCategory; re: RegExp }[] = [
  {
    category: "sensitive_demographic",
    re: /\b(gender|sex\b|race|racial|ethnic\w*|disabilit\w*|disabled|veteran|military|sexual orientation|pronouns?|religio\w*|caste|marital|pregnan\w*)\b/,
  },
  {
    category: "binding_agreement",
    re: /\b(i (agree|accept|acknowledge|consent|authori[sz]e)|terms (and|&) conditions|terms of (use|service)|non-?compete|non-?disclosure|nda\b|electronic signature|sign (here|below)|signature)\b/,
  },
  {
    category: "legal_declaration",
    re: /\b(i (certify|declare|attest|confirm that)|under penalty|perjury|true and (complete|correct)|truthful and accurate|criminal|convict\w*|felony|arrest\w*|background check)\b/,
  },
  {
    category: "eligibility",
    re: /\b(authori[sz]ed to work|authori[sz]ation to work|work authori[sz]ation|right to work|eligible to work|legally (able|eligible|permitted)|visa|sponsor\w*|citizen\w*|permanent resident|green card|security clearance|at least (18|21)|over (18|21)|willing(ness)? to (relocate|travel|work (nights|weekends|on-?site))|relocat\w*)\b/,
  },
  {
    category: "unknown_personal_fact",
    re: /\b(how did you (hear|find|learn)|where did you (hear|find|learn)|referr?ed by|referral|hobb(y|ies)|languages? (do you )?(speak|know)|nationality|mother|father|parents?|spouse|reason for leaving|why did you leave|salary|compensation|expected (pay|ctc)|current ctc|notice period|years? of (total |relevant |work |professional )?experience|how many years|date of birth|birthday|home address|phone number|social security|passport|national id|aadhaar)\b/,
  },
];

const GENERATE_RULES: { category: GenerateCategory; re: RegExp }[] = [
  { category: "fit", re: /\b(why (are you|would you be|do you think you are) (a|the) (good|great|strong|right|best|perfect) (fit|candidate|match)|what makes you (a|the|an) |why should we (hire|choose|select|pick)|how (do|would) you (fit|qualify|contribute)|what (can|would) you (bring|contribute|offer)|why are you (qualified|suited)|your qualifications)\b/ },
  { category: "why_join", re: /\b(why (do you want to|would you like to|are you interested in|are you applying|do you wish to) (join|work|apply)|why (us|this company|our company|are you applying)|what (attracts|draws|motivates) you to|why .{1,40}\?$)/ },
  { category: "interest_role", re: /\b(what (interests|excites|appeals to) you|why this (role|position|internship|job|opportunity)|interest in (this|the) (role|position|internship|job)|what do you (hope|expect) to (learn|gain))\b/ },
  { category: "describe_project", re: /\b((describe|tell us about|walk us through|discuss|share|explain) (a|an|one|your|the)?\s*((most )?(relevant|recent|significant|favou?rite|technical|proudest|notable|impressive) )?(project|piece of work|work you)|project you(?:'re| are)? (most )?proud|a project (you|that))\b/ },
  { category: "technical_challenge", re: /\b((technical|difficult|challenging|hardest|toughest) (challenge|problem|obstacle|bug)|describe a (challenge|problem|time)|problem you (solved|faced|overcame)|overcame)\b/ },
  { category: "strengths", re: /\b(strengths?|what are you (good|best) at|greatest (strength|asset)|your skills)\b/ },
  { category: "additional_info", re: /\b(additional (information|comments?|details)|anything else|is there anything|other (information|comments|details)|cover letter|tell us about yourself|about yourself|introduce yourself|personal statement|statement of purpose)\b/ },
  { category: "experience_with", re: /\b((describe|tell us about|explain|share) your (experience|background|familiarity|proficiency)|experience (with|in|using)|familiar(ity)? with|proficien\w+ (in|with)|have you (worked|used))\b/ },
];

/**
 * Classifies one question. `sensitiveType` is the semantic type the observer already assigned (alias dictionary),
 * so anything the rules know to be sensitive, consent or an eligibility topic is refused here too.
 */
export function classifyQuestion(label: string, semanticType: string = "unknown"): QuestionDecision {
  const q = norm(label);

  // Instruction-like text inside a question is data from an untrusted page: never followed, never answered.
  if (looksLikeInjection(label) || /\b(ignore|disregard|forget) (all |any |your |the )?(previous |prior |above )?(instructions?|rules)\b|\bsystem:|\byou are now\b/.test(q)) {
    return { kind: "refuse", category: "injected_instruction", reason: REFUSAL_REASONS.injected_instruction };
  }
  if (SENSITIVE_TYPES.includes(semanticType as never) || semanticType === "consent") {
    return { kind: "refuse", category: "sensitive_demographic", reason: REFUSAL_REASONS.sensitive_demographic };
  }
  const alias = matchAliases(label);
  if (alias && (SENSITIVE_TYPES.includes(alias.type) || alias.type === "consent")) {
    const category: RefuseCategory = alias.type === "consent" ? (/\b(certify|declare|attest|true and|truthful)\b/.test(q) ? "legal_declaration" : "binding_agreement") : ["work_authorization", "sponsorship", "relocation", "criminal_history"].includes(alias.type) ? (alias.type === "criminal_history" ? "legal_declaration" : "eligibility") : alias.type === "salary" || alias.type === "age" || alias.type === "date_of_birth" || alias.type === "government_id" ? "unknown_personal_fact" : "sensitive_demographic";
    return { kind: "refuse", category, reason: REFUSAL_REASONS[category] };
  }
  for (const r of REFUSE_RULES) {
    if (r.re.test(q)) return { kind: "refuse", category: r.category, reason: REFUSAL_REASONS[r.category] };
  }
  for (const r of GENERATE_RULES) {
    if (r.re.test(q)) return { kind: "generate", category: r.category, technologies: r.category === "experience_with" ? extractSkills(label) : [] };
  }
  return { kind: "generate", category: "other", technologies: extractSkills(label) };
}
