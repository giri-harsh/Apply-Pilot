import { looksLikeInjection } from "@/job/sections";
import { canonicalSkill, extractSkills } from "@/job/skills";
import type { EvidenceBundle, EvidenceItem } from "./evidence";
import { extractNumbers, numberSet } from "./numbers";

/**
 * SPEC 14 / 25.5 grounding validator: deterministic, and the core of answer generation. An answer is accepted only
 * if every figure, technology, organisation, employment claim, deployment claim and link in it is backed by the
 * evidence the model was given and cited. The model's own `claims[]` are checked too, but the scan of the answer text
 * is the safety net, so an uncooperative model cannot talk its way past it.
 */

export type ClaimType = "metric" | "technology" | "employer" | "institution" | "employment" | "deployment" | "other";
export type AnswerClaim = { type: ClaimType; text: string; evidenceId: string };

export type ViolationRule =
  | "empty_answer"
  | "no_evidence_cited"
  | "unknown_evidence_id"
  | "unsupported_number"
  | "unsupported_technology"
  | "unknown_organisation"
  | "employment_from_project"
  | "unsupported_production"
  | "forbidden_link_or_contact"
  | "injected_instruction"
  | "unsupported_claim";

export type Violation = { rule: ViolationRule; detail: string };

export type GroundingInput = {
  answer: string;
  evidenceIds: string[];
  claims: AnswerClaim[];
  /** The evidence ids that were actually sent for this question. */
  sentIds: string[];
  bundle: EvidenceBundle;
  questionText: string;
};

const EMPLOYMENT = /\b(worked (as|at|for)|my (role|job|position|internship|employment|tenure) (as|at|with)|employed (at|by|as)|full[- ]time (role|job|position|employee|work)|part[- ]time (role|job|position)|(professional|industry|work|internship|employment) experience|interned (at|with)|during my (internship|employment|time at|tenure)|as an? (intern|engineer|developer|analyst|researcher|associate) (at|with|for))\b/i;
const PRODUCTION = /\b(in production|production[- ](grade|ready|system|systems|environment|deployment|scale|workload|use)|deployed (to|in|on|into) production|live users|real users|paying (customers|users)|serving (users|customers)|at scale|millions? of (users|requests))\b|\bdeployed\b/i;
const ASSISTANT_TALK = /\b(as an ai( language model)?|i (cannot|can't|am unable to) (comply|help|assist)|system prompt|ignore (all |the )?previous)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_RE = /(?:https?:\/\/[^\s)>"']+|www\.[^\s)>"']+|\b[\w-]+\.(?:com|org|net|io|dev|ai|co|in|app|me|xyz)\b(?:\/[^\s)>"']*)?)/gi;
const ORG_SUFFIX = String.raw`(?:University|Institute|College|School|Labs?|Laboratories|Inc\.?|Ltd\.?|LLC|Corp\.?|Corporation|Technologies|Systems|Solutions|Analytics|Group|Company|Co\.)`;
const COMMON = new Set(["i", "we", "the", "my", "our", "this", "that", "it", "a", "an", "their", "your", "you", "they", "he", "she", "them", "us", "scale", "home", "work", "school", "university", "college"]);

const lower = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const urlKey = (u: string) => lower(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/.,;:]+$/, "");

/** Organisation-like names in the text: "University of X", "X Labs", and a capitalised name after at/for/with/from. */
export function findOrgMentions(text: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().replace(/[.,;:]+$/, "");
    if (t.length >= 2) out.add(t);
  };
  for (const m of text.matchAll(new RegExp(String.raw`\b([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,4}\s+${ORG_SUFFIX})`, "g"))) add(m[1]!);
  for (const m of text.matchAll(/\bUniversity of ([A-Z]\w+(?:\s+[A-Z]\w+)*)/g)) add(`University of ${m[1]}`);
  for (const m of text.matchAll(/\b(?:at|for|with|from|joined|@)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})/g)) add(m[1]!);
  return [...out];
}

function orgAllowed(mention: string, allowed: string[]): boolean {
  const m = lower(mention);
  if (COMMON.has(m)) return true;
  if (extractSkills(mention).length > 0) return true; // "with Python", "at AWS" are technologies, checked elsewhere
  return allowed.some((a) => {
    const x = lower(a);
    return x === m || x.includes(m) || m.includes(x);
  });
}

function cited(ids: string[], bundle: EvidenceBundle): EvidenceItem[] {
  return ids.map((id) => bundle.items.get(id)).filter((i): i is EvidenceItem => Boolean(i));
}

export function validateGrounding(input: GroundingInput): Violation[] {
  const { answer, evidenceIds, claims, sentIds, bundle, questionText } = input;
  const v: Violation[] = [];
  const add = (rule: ViolationRule, detail: string) => {
    if (!v.some((x) => x.rule === rule && x.detail === detail)) v.push({ rule, detail });
  };

  if (answer.trim().length < 10) add("empty_answer", "The answer is empty or too short");

  const sent = new Set(sentIds);
  for (const id of evidenceIds) if (!sent.has(id)) add("unknown_evidence_id", `Cited evidence "${id}" was not provided for this question`);
  const valid = evidenceIds.filter((id) => sent.has(id));
  if (valid.length === 0) add("no_evidence_cited", "No provided evidence was cited");
  const items = cited(valid, bundle);

  // 1. Numbers: every figure must appear in the cited evidence. Figures that merely echo the question are not claims.
  const allowedNumbers = new Set<number>();
  for (const it of items) for (const n of numberSet(it.text)) allowedNumbers.add(n);
  const questionNumbers = numberSet(questionText);
  for (const n of extractNumbers(answer)) {
    if (!allowedNumbers.has(n.value) && !questionNumbers.has(n.value)) add("unsupported_number", `The figure "${n.raw}" is not in the cited evidence`);
  }

  // 2. Technologies: only the user's recorded skills or the cited items' technologies.
  const allowedTech = new Set<string>([...bundle.profileSkills]);
  for (const it of items) for (const t of it.technologies) allowedTech.add(t);
  // Link text is checked as a link, not as a technology ("github.com/..." must not count as mentioning Git).
  const prose = answer.replace(EMAIL, " ").replace(URL_RE, " ");
  for (const t of extractSkills(prose)) {
    if (!allowedTech.has(canonicalSkill(t))) add("unsupported_technology", `"${t}" is not in the profile's skills or the cited evidence`);
  }

  // 3. Organisations and institutions.
  for (const mention of findOrgMentions(prose)) {
    if (!orgAllowed(mention, bundle.allowedOrgs)) add("unknown_organisation", `"${mention}" is not an employer, institution, project or the target company from the profile`);
  }

  // 4. Employment vs project.
  if (EMPLOYMENT.test(answer) && !items.some((i) => i.employment)) {
    add("employment_from_project", "The answer describes employment, but the cited evidence is not an employment record");
  }

  // 5. Deployment / production.
  if (PRODUCTION.test(answer)) {
    // If the answer names specific projects, each of those must be deployed: citing some other deployed
    // project does not make a different project "production".
    const named = items.filter((i) => i.kind === "project" && lower(answer).includes(lower(i.title.replace(/^Project:\s*/, ""))));
    const ok = named.length > 0 ? named.every((i) => i.deployed) : items.some((i) => i.deployed);
    if (!ok) add("unsupported_production", "The answer claims production or deployment that the cited evidence does not support");
  }

  // 6. Links, contact details and instructions.
  for (const m of answer.matchAll(EMAIL)) add("forbidden_link_or_contact", `Contact detail "${m[0]}" must not appear in an answer`);
  const allowedUrls = new Set(bundle.allowedUrls.map(urlKey));
  for (const m of answer.replace(EMAIL, " ").matchAll(URL_RE)) {
    if (!allowedUrls.has(urlKey(m[0]))) add("forbidden_link_or_contact", `The link "${m[0]}" is not one of the user's recorded links`);
  }
  if (looksLikeInjection(answer) || ASSISTANT_TALK.test(answer)) add("injected_instruction", "The answer contains instruction-like or assistant-style text");

  // 7. The model's own claims must hold as well.
  for (const c of claims) {
    if (!sent.has(c.evidenceId)) {
      add("unknown_evidence_id", `Claim "${c.text}" cites "${c.evidenceId}", which was not provided`);
      continue;
    }
    const it = bundle.items.get(c.evidenceId);
    if (!it) continue;
    const ok =
      c.type === "metric" ? extractNumbers(c.text).every((n) => numberSet(it.text).has(n.value))
      : c.type === "technology" ? it.technologies.includes(canonicalSkill(c.text)) || bundle.profileSkills.has(canonicalSkill(c.text))
      : c.type === "employer" || c.type === "institution" ? orgAllowed(c.text, bundle.allowedOrgs)
      : c.type === "employment" ? it.employment
      : c.type === "deployment" ? it.deployed
      : true;
    if (!ok) add("unsupported_claim", `The ${c.type} claim "${c.text}" is not supported by ${c.evidenceId}`);
  }
  return v;
}
