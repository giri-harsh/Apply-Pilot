import { emptyProfile, type UserProfile } from "../../src/shared/profile";

const at = "2026-01-01T00:00:00.000Z";
const prov = { source: "user_entered" as const, recordedAt: at };

/** testProfile plus skills, two projects (one deployed), one employment record: enough evidence to write answers. */
export function richProfile(): UserProfile {
  const p = testProfile();
  const skill = (id: string, name: string) => ({ id, name, category: "programming_languages" as const, proficiency: "" as const, evidence: "", lastVerified: "", provenance: prov });
  p.skills.push(skill("s1", "Python"), skill("s2", "SQL"), skill("s3", "PyTorch"), skill("s4", "Docker"));
  const project = (id: string, name: string, over: Partial<UserProfile["projects"][number]>) => ({
    id, name, description: "", problem: "", architecture: "", technologies: [], contribution: "", achievements: [], metrics: [],
    repoUrl: "", liveUrl: "", startDate: "", endDate: "", concepts: [], evidence: [], provenance: prov, ...over,
  });
  p.projects.push(
    project("pr1", "Sales Forecaster", {
      description: "Forecasts weekly retail sales from historical data",
      contribution: "Built the training pipeline and the evaluation harness",
      technologies: ["Python", "PyTorch"],
      metrics: [{ text: "Reduced forecast error by 18%", source: "README benchmark" }],
      repoUrl: "https://github.com/alex-example/sales-forecaster",
    }),
    project("pr2", "Resume Parser", {
      description: "Extracts structured fields from resumes",
      contribution: "Wrote the parsing rules and the web API",
      technologies: ["Python", "spaCy", "Docker"],
      metrics: [{ text: "Parsed 500 sample resumes", source: "test set" }],
      liveUrl: "https://resume-parser.example.test",
    }),
  );
  p.experience.push({
    id: "ex1", employer: "Acme Labs", position: "Data Intern", employmentType: "internship", startDate: "2025-06", endDate: "2025-08", current: false,
    responsibilities: ["Wrote SQL reports for the analytics team"], achievements: ["Automated a weekly report, saving 4 hours per week"],
    technologies: ["Python", "SQL"], metrics: [], evidence: [], provenance: prov,
  });
  return p;
}

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
