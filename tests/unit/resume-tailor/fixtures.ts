import { JobContextSchema, type JobContext } from "@/job/schema";
import { MasterResumeSchema, type MasterResume, type ResumeVariant } from "@/resume/schema";

/** Recursively freezes a value so any write attempt on the master throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const prov = { source: "resume_import_approved" as const, recordedAt: "2026-01-01T00:00:00.000Z" };
const fact = (factId: string, text: string) => ({ factId, text, provenance: prov, lowConfidence: false });

/** Fictional applicant: employment (internship), a deployed project, an academic project, a prototype, a certificate. */
export function masterFixture(): MasterResume {
  return MasterResumeSchema.parse({
    schemaVersion: 1,
    masterId: "master_1",
    contact: {
      name: fact("c_name", "Alex Example"),
      email: fact("c_email", "alex@example.test"),
      phone: fact("c_phone", "+91 90000 00000"),
      location: fact("c_loc", "Pune, India"),
      links: [{ label: "GitHub", url: "https://github.com/alex-example", fact: fact("c_gh", "github.com/alex-example") }],
    },
    summary: fact("s_sum", "Computer science student focused on machine learning and data analysis."),
    entries: [
      {
        entryId: "edu1", section: "education", heading: fact("edu1_h", "B.Tech in Computer Science, Example Institute of Technology"), subheading: fact("edu1_s", "Expected graduation 2027"),
        dates: "2023 - 2027", location: "Pune", bullets: [fact("edu1_b1", "Coursework in statistics, machine learning and databases")], technologies: [], links: [],
      },
      {
        entryId: "exp1", section: "experience", heading: fact("exp1_h", "Data Intern, Acme Labs"), dates: "Jun 2025 - Aug 2025", location: "Remote",
        bullets: [
          fact("exp1_b1", "Wrote SQL reports in Python for the analytics team, cutting weekly reporting time by 4 hours"),
          fact("exp1_b2", "Automated a weekly sales report with Python and SQL, saving 4 hours per week"),
        ],
        technologies: ["Python", "SQL"], links: [],
      },
      {
        entryId: "proj1", section: "projects", heading: fact("proj1_h", "Sales Forecaster"), dates: "2025",
        bullets: [
          fact("proj1_b1", "Built a forecasting model in PyTorch that reduced forecast error by 18%"),
          fact("proj1_b2", "Deployed the model as a public Streamlit demo for retail data"),
        ],
        technologies: ["Python", "PyTorch", "Streamlit"],
        links: [{ label: "Live demo", url: "https://forecaster.example.test", factId: "proj1_l1" }],
      },
      {
        entryId: "proj2", section: "projects", heading: fact("proj2_h", "Resume Parser"), subheading: fact("proj2_s", "Course project"), dates: "2024",
        bullets: [
          fact("proj2_b1", "Extracted fields from 500 sample resumes using spaCy rules"),
          fact("proj2_b2", "Wrote the parsing rules and evaluation scripts in Python"),
        ],
        technologies: ["Python", "spaCy"], links: [],
      },
      {
        entryId: "proj3", section: "projects", heading: fact("proj3_h", "Notes Assistant"), dates: "2025",
        bullets: [fact("proj3_b1", "Prototyped a question answering assistant over personal notes with LangChain")],
        technologies: ["LangChain"], links: [],
      },
      { entryId: "cert1", section: "certifications", heading: fact("cert1_h", "Google Data Analytics Certificate"), dates: "2025", bullets: [], technologies: [], links: [] },
    ],
    skillGroups: [
      { groupId: "g_lang", label: "Languages", items: [fact("sk_py", "Python"), fact("sk_sql", "SQL"), fact("sk_java", "Java")] },
      { groupId: "g_ml", label: "Machine learning", items: [fact("sk_pt", "PyTorch"), fact("sk_sk", "scikit-learn")] },
      { groupId: "g_tools", label: "Tools", items: [fact("sk_git", "Git")] },
    ],
    achievements: [fact("ach1", "Finalist in the university hackathon")],
    confirmedAt: "2026-01-02T00:00:00.000Z",
  });
}

export function jobFixture(over: Partial<JobContext> = {}): JobContext {
  return JobContextSchema.parse({
    jobTitle: "Machine Learning Intern", company: "Northwind Analytics", jobUrl: "https://jobs.example.test/ml",
    descriptionText: "Northwind Analytics builds forecasting tools for retailers. Requirements: Python, SQL and PyTorch. Preferred: Docker.",
    requiredQualifications: [], preferredQualifications: [], responsibilities: ["Train and evaluate forecasting models"],
    requiredSkills: ["Python", "SQL", "PyTorch"], preferredSkills: ["Docker"], educationRequirements: [], experienceRequirements: [],
    location: null, employmentType: "internship", workArrangement: null, relevantKeywords: ["forecasting", "stakeholder communication"], eligibilityNotes: [],
    sourceConfidence: 0.9, sources: { title: "heading", company: "heading", description: "main_content" }, extractionWarnings: [], ...over,
  });
}

export function variantFixture(over: Partial<ResumeVariant> = {}): ResumeVariant {
  return {
    variantId: "ml", name: "ML", roleKeywords: ["machine learning"], sectionOrder: ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"],
    entryOrder: ["edu1", "exp1", "proj1", "proj2", "proj3", "cert1"], pinnedFactIds: [], excludedFactIds: [], skillGroupOrder: [],
    limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 4 }, ...over,
  };
}
