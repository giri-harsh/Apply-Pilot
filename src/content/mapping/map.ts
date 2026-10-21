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
import { normalizeForMatch } from "./aliases";

/** Minimum confidence at which a deterministic match is applied automatically (SPEC 17.2, configurable later). */
export const FILL_CONFIDENCE_THRESHOLD = 0.8;

export const TYPE_TO_PROFILE_KEY: Partial<Record<SemanticType, ProfileKey>> = {
  full_name: "personal.fullName",
  first_name: "personal.firstName",
  last_name: "personal.lastName",
  preferred_name: "personal.preferredName",
  email: "personal.email",
  phone: "personal.phone",
  city: "personal.city",
  state: "personal.state",
  country: "personal.country",
  postal_code: "personal.postalCode",
  address_line: "personal.address",
  linkedin: "personal.linkedinUrl",
  github: "personal.githubUrl",
  portfolio: "personal.portfolioUrl",
  institution: "education.institution",
  degree: "education.degree",
  field_of_study: "education.fieldOfStudy",
  graduation_year: "education.graduationYear",
  gpa: "education.grade",
  current_employer: "experience.currentEmployer",
  current_title: "experience.currentTitle",
  availability_date: "preferences.availabilityDate",
  notice_period: "preferences.noticePeriod",
};

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

/**
 * Deterministic mapping: field -> profile value -> constrained AgentAction.
 * No network, no AI. Everything that is not a confident, safe match is reported as skipped with a reason.
 */
export function mapFields(fields: FormField[], profile: UserProfile): MapResult {
  const plan: PlannedFill[] = [];
  const skipped: FieldResult[] = [];

  for (const f of fields) {
    if (!f.visible) continue; // hidden controls (including honeypots) are never touched or counted

    if (SENSITIVE_TYPES.includes(f.semanticType)) {
      skipped.push(skip(f, "skipped_sensitive", "Sensitive or eligibility question; answer it yourself"));
      continue;
    }
    if (f.semanticType === "consent") {
      skipped.push(skip(f, "skipped_consent", "Consent or declaration; ApplyPilot never accepts these"));
      continue;
    }
    if (f.semanticType === "third_party_contact") {
      skipped.push(skip(f, "skipped_third_party", "Belongs to a reference or contact, not the applicant"));
      continue;
    }
    if (f.ambiguous) {
      skipped.push(skip(f, "ambiguous", f.ambiguityReason ?? "Ambiguous field"));
      continue;
    }
    if (!f.enabled) {
      skipped.push(skip(f, "unresolved", "Field is disabled or read-only"));
      continue;
    }
    if (f.control === "file") {
      skipped.push(skip(f, "unresolved", "File uploads are not supported yet"));
      continue;
    }
    if (f.control === "checkbox" || f.control === "radio") {
      skipped.push(skip(f, "unresolved", "No profile value maps to a checkbox or radio group yet"));
      continue;
    }
    const key = TYPE_TO_PROFILE_KEY[f.semanticType];
    if (!key) {
      skipped.push(skip(f, "unresolved", "No deterministic profile mapping for this field"));
      continue;
    }
    if (f.confidence < FILL_CONFIDENCE_THRESHOLD) {
      skipped.push(skip(f, "unresolved", "Low-confidence field interpretation"));
      continue;
    }
    const value = readProfileValue(profile, key);
    if (!value) {
      skipped.push(skip(f, "unresolved", "Profile has no value for this field"));
      continue;
    }
    if (f.currentValue.trim() !== "" && f.control !== "select") {
      if (f.currentValue.trim() === value) {
        skipped.push(skip(f, "already_correct", "Field already holds the profile value"));
      } else {
        skipped.push(skip(f, "unresolved", "Field already has a different value; not overwritten"));
      }
      continue;
    }

    let action: AgentAction;
    if (f.control === "select") {
      const opt = pickOption(f, value);
      if (opt === null) {
        skipped.push(skip(f, "unresolved", "No option exactly matches the profile value"));
        continue;
      }
      if (f.currentValue === opt) {
        skipped.push(skip(f, "already_correct", "Option already selected"));
        continue;
      }
      action = { type: "select_option", fieldId: f.fieldId, optionValue: opt };
    } else {
      if (!dateOk(f, value)) {
        skipped.push(skip(f, "unresolved", "Profile date is not in the format this field requires"));
        continue;
      }
      action = { type: "fill_text", fieldId: f.fieldId, value };
    }
    plan.push({ fieldId: f.fieldId, action, semanticType: f.semanticType, label: f.label, required: f.required });
  }
  return { plan, skipped };
}
