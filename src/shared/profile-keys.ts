import type { ProfileKey, SemanticType } from "./form";

/** Deterministic semantic type -> profile key table shared by the content script (mapping) and the AI validator. */
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
