import { emptyProfile, type UserProfile } from "../../src/shared/profile";

const at = "2026-01-01T00:00:00.000Z";
const prov = { source: "user_entered" as const, recordedAt: at };

/** A fictional applicant used only by tests. */
export function testProfile(): UserProfile {
  const p = emptyProfile();
  Object.assign(p.personal, {
    fullName: "Alex Example",
    firstName: "Alex",
    lastName: "Example",
    preferredName: "Lex",
    email: "alex@example.test",
    phone: "+91 98765 43210",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    postalCode: "411001",
    linkedinUrl: "https://www.linkedin.com/in/alex-example",
    githubUrl: "https://github.com/alex-example",
  });
  for (const k of ["fullName", "firstName", "lastName", "preferredName", "email", "phone", "city", "state", "country", "postalCode", "linkedinUrl", "githubUrl"]) {
    p.personal.provenance[k] = prov;
  }
  p.education.push({
    id: "edu-1",
    institution: "Example Institute of Technology",
    degree: "Bachelor of Technology",
    fieldOfStudy: "Computer Science",
    startDate: "2023-08",
    expectedGraduationDate: "2027-05",
    graduationDate: "",
    grade: "8.7",
    gradingScale: "10",
    coursework: [],
    distinctions: [],
    provenance: prov,
  });
  p.preferences.salaryExpectation = "Should never be auto-filled";
  p.preferences.workAuthorization = "Should never be auto-filled";
  return p;
}
