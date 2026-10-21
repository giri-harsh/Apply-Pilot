import {
  SENSITIVE_TYPES,
  type AgentAction,
  type FieldResult,
  type FormField,
  type ProfileKey,
  type SemanticType,
} from "@/shared/form";
import type { UserProfile } from "@/shared/profile";
import type { PlannedFill } from "@/shared/messages";
import { normalizeForMatch } from "@/shared/aliases";
import { TYPE_TO_PROFILE_KEY } from "@/shared/profile-keys";

/** Minimum confidence at which a deterministic match is applied automatically (SPEC 17.2, configurable later). */
export const FILL_CONFIDENCE_THRESHOLD = 0.8;

export { TYPE_TO_PROFILE_KEY };

function latestEducation(p: UserProfile) {
  const key = (e: UserProfile["education"][number]) => e.graduationDate || e.expectedGraduationDate || e.startDate || "";
  return [...p.education].sort((a, b) => key(b).localeCompare(key(a)))[0];
}

/** Reads a verified profile value. Returns "" when the profile does not hold it; never guesses. */
export function readProfileValue(profile: UserProfile, key: ProfileKey): string {
  const per = profile.personal;
  switch (key) {
    case "personal.fullName":
      if (per.fullName) return per.fullName;
      return per.firstName && per.lastName ? `${per.firstName} ${per.lastName}` : "";
    case "personal.firstName":
      return per.firstName;
    case "personal.lastName":
      return per.lastName;
    case "personal.preferredName":
      return per.preferredName;
    case "personal.email":
      return per.email;
    case "personal.phone":
      return per.phone;
    case "personal.city":
      return per.city;
    case "personal.state":
      return per.state;
    case "personal.country":
      return per.country;
    case "personal.postalCode":
      return per.postalCode;
    case "personal.address":
      return per.address;
    case "personal.linkedinUrl":
      return per.linkedinUrl;
    case "personal.githubUrl":
      return per.githubUrl;
    case "personal.portfolioUrl":
      return per.portfolioUrl;
    case "education.institution":
      return latestEducation(profile)?.institution ?? "";
    case "education.degree":
      return latestEducation(profile)?.degree ?? "";
    case "education.fieldOfStudy":
      return latestEducation(profile)?.fieldOfStudy ?? "";
    case "education.graduationYear": {
      const e = latestEducation(profile);
      return (e?.graduationDate || e?.expectedGraduationDate || "").slice(0, 4);
    }
    case "education.grade":
      return latestEducation(profile)?.grade ?? "";
    case "experience.currentEmployer":
      return profile.experience.find((x) => x.current)?.employer ?? "";
    case "experience.currentTitle":
      return profile.experience.find((x) => x.current)?.position ?? "";
    case "preferences.availabilityDate":
      return profile.preferences.availabilityDate;
    case "preferences.noticePeriod":
      return profile.preferences.noticePeriod;
  }
}

export type MapResult = { plan: PlannedFill[]; skipped: FieldResult[] };

function skip(f: FormField, outcome: FieldResult["outcome"], reason: string): FieldResult {
  return {
    fieldId: f.fieldId,
    label: f.label,
    outcome,
    required: f.required,
    reason,
    semanticType: f.semanticType,
    ...(f.aiMapped ? { aiMapped: true } : {}),
  };
}

function pickOption(f: FormField, value: string): string | null {
  const want = normalizeForMatch(value);
  if (!want) return null;
  const exact = f.options.filter((o) => normalizeForMatch(o.value) === want || normalizeForMatch(o.label) === want);
  if (exact.length === 1) return exact[0]!.value;
  return null;
}

/** Date inputs need YYYY-MM-DD; we never reformat a partial date into a guessed one (SPEC 12.6). */
function dateOk(f: FormField, value: string): boolean {
  if (f.inputType === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (f.inputType === "month") return /^\d{4}-\d{2}/.test(value);
  return true;
}

type PlanOptions = { minConfidence: number; allowConflictAmbiguity: boolean; mappingConfidence?: number };

/**
 * One field -> either a planned action or a reported skip. Shared by the deterministic pass and the
 * AI-assisted pass so both are held to exactly the same policy.
 */
function planField(f: FormField, profile: UserProfile, opts: PlanOptions): { plan?: PlannedFill; skipped?: FieldResult } {
  if (!f.visible) return {}; // hidden controls (including honeypots) are never touched or counted
  if (SENSITIVE_TYPES.includes(f.semanticType)) return { skipped: skip(f, "skipped_sensitive", "Sensitive or eligibility question; answer it yourself") };
  if (f.semanticType === "consent") return { skipped: skip(f, "skipped_consent", "Consent or declaration; ApplyPilot never accepts these") };
  if (f.semanticType === "third_party_contact") return { skipped: skip(f, "skipped_third_party", "Belongs to a reference or contact, not the applicant") };
  if (f.ambiguous && !opts.allowConflictAmbiguity) return { skipped: skip(f, "ambiguous", f.ambiguityReason ?? "Ambiguous field") };
  if (!f.enabled) return { skipped: skip(f, "unresolved", "Field is disabled or read-only") };
  if (f.control === "file") return { skipped: skip(f, "unresolved", "File uploads are not supported yet") };
  if (f.widget === "combobox") return { skipped: skip(f, "unresolved", "Custom dropdown / autocomplete needs a selection, which is not supported yet") };
  if (f.control === "checkbox" || f.control === "radio") return { skipped: skip(f, "unresolved", "No profile value maps to a checkbox or radio group yet") };
  const key = TYPE_TO_PROFILE_KEY[f.semanticType];
  if (!key) return { skipped: skip(f, "unresolved", "No deterministic profile mapping for this field") };
  if (f.confidence < opts.minConfidence) return { skipped: skip(f, "unresolved", "Low-confidence field interpretation") };
  const value = readProfileValue(profile, key);
  if (!value) return { skipped: skip(f, "unresolved", "Profile has no value for this field") };
  if (f.currentValue.trim() !== "" && f.control !== "select") {
    return f.currentValue.trim() === value
      ? { skipped: skip(f, "already_correct", "Field already holds the profile value") }
      : { skipped: skip(f, "unresolved", "Field already has a different value; not overwritten") };
  }

  let action: AgentAction;
  if (f.control === "select") {
    const opt = pickOption(f, value);
    if (opt === null) return { skipped: skip(f, "unresolved", "No option exactly matches the profile value") };
    if (f.currentValue === opt) return { skipped: skip(f, "already_correct", "Option already selected") };
    action = { type: "select_option", fieldId: f.fieldId, optionValue: opt };
  } else {
    if (!dateOk(f, value)) return { skipped: skip(f, "unresolved", "Profile date is not in the format this field requires") };
    action = { type: "fill_text", fieldId: f.fieldId, value };
  }
  return {
    plan: {
      fieldId: f.fieldId,
      action,
      semanticType: f.semanticType,
      label: f.label,
      required: f.required,
      ...(f.aiMapped ? { aiMapped: true } : {}),
      confidence: { identification: f.confidence, mapping: opts.mappingConfidence ?? f.confidence },
    },
  };
}

/**
 * Deterministic mapping: field -> profile value -> constrained AgentAction.
 * No network, no AI. Everything that is not a confident, safe match is reported as skipped with a reason.
 */
export function mapFields(fields: FormField[], profile: UserProfile): MapResult {
  const plan: PlannedFill[] = [];
  const skipped: FieldResult[] = [];
  for (const f of fields) {
    const r = planField(f, profile, { minConfidence: FILL_CONFIDENCE_THRESHOLD, allowConflictAmbiguity: false });
    if (r.plan) plan.push(r.plan);
    if (r.skipped) skipped.push(r.skipped);
  }
  return { plan, skipped };
}

export type AiMappingInput = { fieldId: string; semanticType: SemanticType; profileKey: ProfileKey; confidence: number };

/**
 * Turns validated AI hints into plans. The semantic type is adopted at moderate risk and flagged `aiMapped`,
 * then the field goes through exactly the same checks as a deterministic one. Policy runs again here, so a
 * sensitive type or mismatched key is dropped even if an upstream check were bypassed.
 */
export function mapAiMappings(fields: FormField[], mappings: AiMappingInput[], profile: UserProfile): MapResult {
  const plan: PlannedFill[] = [];
  const skipped: FieldResult[] = [];
  const byId = new Map(fields.map((f) => [f.fieldId, f]));
  for (const m of mappings) {
    const f = byId.get(m.fieldId);
    if (!f || !f.visible) continue;
    if (SENSITIVE_TYPES.includes(m.semanticType) || m.semanticType === "consent" || TYPE_TO_PROFILE_KEY[m.semanticType] !== m.profileKey) continue;
    if (f.semanticType === "consent" || SENSITIVE_TYPES.includes(f.semanticType) || f.semanticType === "third_party_contact") continue;
    f.semanticType = m.semanticType;
    f.risk = "moderate";
    f.aiMapped = true;
    f.ambiguous = false;
    f.ambiguityReason = null;
    f.semanticCandidates = [m.semanticType];
    const r = planField(f, profile, { minConfidence: 0, allowConflictAmbiguity: true, mappingConfidence: Math.min(m.confidence, 0.99) });
    if (r.plan) plan.push(r.plan);
    if (r.skipped) skipped.push(r.skipped);
  }
  return { plan, skipped };
}
