import { MasterResumeSchema, type Fact, type MasterEntry, type MasterResume, type SkillGroup } from "@/resume/schema";

/**
 * Shared fictional fixtures (person: "Alex Example"; no real data). B2 / B3 / B4 / LEAD tests import these two builders:
 *   sampleMaster(): small and realistic.
 *   longMaster():   deliberately too long to fit one page at the readability floors.
 * Both return schema-valid MasterResume objects with stable factIds.
 */

const AT = "2026-01-01T00:00:00.000Z";
const prov = { source: "resume_import_approved" as const, recordedAt: AT, note: "approved resume import" };
const fact = (factId: string, text: string): Fact => ({ factId, text, provenance: prov, lowConfidence: false });

const entry = (e: {
  id: string;
  section: MasterEntry["section"];
  heading: string;
  sub?: string;
  dates?: string;
  location?: string;
  bullets?: string[];
  tech?: string[];
}): MasterEntry => ({
  entryId: e.id,
  section: e.section,
  heading: fact(`${e.id}_h`, e.heading),
  ...(e.sub ? { subheading: fact(`${e.id}_s`, e.sub) } : {}),
  dates: e.dates ?? "",
  location: e.location ?? "",
  bullets: (e.bullets ?? []).map((b, i) => fact(`${e.id}_b${i}`, b)),
  technologies: e.tech ?? [],
  links: [],
});

const group = (id: string, label: string, items: string[]): SkillGroup => ({
  groupId: id,
  label,
  items: items.map((t, i) => fact(`${id}_i${i}`, t)),
});

export function sampleMaster(): MasterResume {
  return MasterResumeSchema.parse({
    schemaVersion: 1,
    masterId: "m_sample_alex",
    contact: {
      name: fact("c_name", "Alex Example"),
      email: fact("c_email", "alex.example@example.test"),
      phone: fact("c_phone", "+1 555 010 0199"),
      location: fact("c_loc", "Springfield, USA"),
      links: [
        { label: "LinkedIn", url: "https://linkedin.com/in/alexexample", fact: fact("c_link0", "linkedin.com/in/alexexample") },
        { label: "GitHub", url: "https://github.com/alexexample", fact: fact("c_link1", "github.com/alexexample") },
      ],
    },
    summary: fact("sum", "Final-year computer science student focused on data analysis and machine learning."),
    entries: [
      entry({ id: "edu0", section: "education", heading: "Springfield Institute of Technology", sub: "B.Tech in Computer Science", dates: "2022 - 2026", bullets: ["CGPA: 8.7/10", "Relevant coursework: Machine Learning, Databases, Algorithms"] }),
      entry({
        id: "exp0",
        section: "experience",
        heading: "Acme Labs - Data Science Intern",
        dates: "Jun 2025 - Aug 2025",
        location: "Remote",
        bullets: ["Built SQL reports that the analytics team used for weekly planning", "Trained a churn prediction model in scikit-learn and documented the results"],
        tech: ["SQL", "scikit-learn"],
      }),
      entry({ id: "exp1", section: "experience", heading: "Bright Works - Research Assistant", dates: "Jan 2025 - Mar 2025", bullets: ["Cleaned and labelled a survey dataset of 2,000 responses"] }),
      entry({
        id: "prj0",
        section: "projects",
        heading: "Sales Forecaster",
        bullets: ["Forecast monthly sales with gradient boosting and a rolling validation split", "Wrote a small command line tool to run the forecast on new data"],
        tech: ["Python", "pandas", "scikit-learn"],
      }),
      entry({ id: "prj1", section: "projects", heading: "Resume Parser", bullets: ["Extracted sections from text resumes with simple rules and unit tests"], tech: ["TypeScript"] }),
      entry({ id: "prj2", section: "projects", heading: "Campus Event Finder", bullets: ["Built a search page for campus events using TypeScript and a JSON feed"], tech: ["TypeScript"] }),
      entry({ id: "cert0", section: "certifications", heading: "Google Data Analytics Certificate", dates: "2024" }),
    ],
    skillGroups: [
      group("sg_lang", "Languages", ["Python", "SQL", "TypeScript"]),
      group("sg_ml", "Machine learning", ["scikit-learn", "PyTorch (basics)", "pandas"]),
      group("sg_tools", "Tools", ["Git", "Docker", "Linux"]),
    ],
    achievements: [],
    confirmedAt: AT,
    importedFrom: { filename: "alex-example.pdf", format: "pdf", importedAt: AT },
  });
}

const VERBS = ["Built", "Designed", "Automated", "Analysed", "Implemented", "Evaluated", "Optimised", "Documented", "Migrated", "Reviewed"];
const OBJECTS = [
  "a data pipeline that loads daily exports into a reporting database and validates every row before publishing",
  "a model evaluation harness that compares candidate models on held-out data and writes a plain-language summary",
  "a dashboard for the operations team that shows weekly throughput, error rates and the slowest processing steps",
  "an internal command line tool that checks configuration files and reports mistakes with line numbers",
  "a regression test suite covering the main user flows, which cut manual checking time for every release",
  "a feature engineering workflow for tabular data with documented assumptions and reproducible random seeds",
];
const bulletText = (i: number, j: number) => `${VERBS[(i + j) % VERBS.length]} ${OBJECTS[(i * 3 + j) % OBJECTS.length]} (item ${i}.${j}).`;

/** Many entries and bullets: cannot fit one page at the readability floors (10 pt body, 0.5 in margins, 1.1 line height). */
export function longMaster(): MasterResume {
  const entries: MasterEntry[] = [];
  for (let i = 0; i < 2; i++)
    entries.push(entry({ id: `edu${i}`, section: "education", heading: `Fictional University ${i + 1}`, sub: i === 0 ? "B.Tech in Computer Science" : "Diploma in Data Analytics", dates: `${2016 + i * 4} - ${2020 + i * 4}`, bullets: [`CGPA: 8.${i + 3}/10`, "Relevant coursework: Algorithms, Databases, Machine Learning, Statistics, Operating Systems"] }));
  for (let i = 0; i < 6; i++)
    entries.push(
      entry({
        id: `exp${i}`,
        section: "experience",
        heading: `Example Company ${i + 1} - ${i % 2 ? "Software Engineer" : "Data Analyst"}`,
        dates: `${2019 + i} - ${2020 + i}`,
        location: "Springfield, USA",
        bullets: [0, 1, 2, 3, 4, 5].map((j) => bulletText(i, j)),
        tech: ["Python", "SQL", "TypeScript"],
      }),
    );
  for (let i = 0; i < 8; i++)
    entries.push(
      entry({
        id: `prj${i}`,
        section: "projects",
        heading: `Project ${String.fromCharCode(65 + i)} - Example Tool`,
        dates: `${2020 + (i % 5)}`,
        bullets: [0, 1, 2, 3, 4].map((j) => bulletText(i + 7, j)),
        tech: ["Python", "scikit-learn", "Docker"],
      }),
    );
  for (let i = 0; i < 6; i++) entries.push(entry({ id: `cert${i}`, section: "certifications", heading: `Example Certification ${i + 1}`, dates: `${2018 + i}` }));

  const skillGroups: SkillGroup[] = [0, 1, 2, 3, 4, 5].map((g) =>
    group(`sg${g}`, `Skill area ${g + 1}`, Array.from({ length: 10 }, (_, k) => `Skill ${g + 1}.${k + 1}`)),
  );
  return MasterResumeSchema.parse({
    schemaVersion: 1,
    masterId: "m_long_alex",
    contact: { name: fact("c_name", "Alex Example"), email: fact("c_email", "alex.example@example.test"), phone: fact("c_phone", "+1 555 010 0199"), location: fact("c_loc", "Springfield, USA"), links: [] },
    summary: fact("sum", "Engineer with several years of fictional experience across data, tooling and testing work, kept long on purpose for layout tests."),
    entries,
    skillGroups,
    achievements: Array.from({ length: 8 }, (_, i) => fact(`ach${i}`, `Fictional award number ${i + 1} for outstanding example work in a made-up competition.`)),
    confirmedAt: AT,
    importedFrom: { filename: "alex-long.docx", format: "docx", importedAt: AT },
  });
}
