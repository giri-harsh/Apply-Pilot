import { probe, probeMentions } from "../tailor/terms";
import type { MasterEntry, MasterResume, ResumeVariant, SectionKey } from "../schema";
import { ENTRY_SECTIONS } from "./apply";

/**
 * The starter variants (SPEC 7.2). Each one is a RULE: role keywords, a section order, limits, and an order over the
 * master's own entryIds / skill groupIds that favours entries and skills matching the role. No fact text is ever
 * copied, so editing a fact in the master changes every variant at once.
 */

type Spec = {
  variantId: string;
  name: string;
  roleKeywords: string[];
  sectionOrder: SectionKey[];
  limits: ResumeVariant["limits"];
};

const SPECS: Spec[] = [
  {
    variantId: "ai-ml-engineer",
    name: "AI/ML Engineer",
    roleKeywords: ["machine learning", "ml engineer", "ai engineer", "artificial intelligence", "deep learning", "computer vision", "natural language processing", "pytorch", "tensorflow", "mlops"],
    sectionOrder: ["summary", "education", "projects", "experience", "skills", "certifications", "achievements"],
    limits: { maxProjects: 4, maxExperience: 3, maxBulletsPerEntry: 4 },
  },
  {
    variantId: "data-scientist",
    name: "Data Scientist",
    roleKeywords: ["data scientist", "data science", "statistics", "machine learning", "feature engineering", "a/b testing", "time series", "pandas", "scikit-learn"],
    sectionOrder: ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"],
    limits: { maxProjects: 4, maxExperience: 3, maxBulletsPerEntry: 4 },
  },
  {
    variantId: "software-engineer",
    name: "Software Engineer",
    roleKeywords: ["software engineer", "software developer", "backend", "frontend", "full stack", "full-stack", "web developer", "rest apis", "microservices", "ci/cd"],
    sectionOrder: ["education", "experience", "projects", "skills", "certifications", "achievements", "summary"],
    limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 4 },
  },
  {
    variantId: "generative-ai-engineer",
    name: "Generative AI Engineer",
    roleKeywords: ["generative ai", "genai", "llm", "large language models", "rag", "prompt engineering", "langchain", "ai agents", "vector databases", "fine-tuning"],
    sectionOrder: ["summary", "education", "projects", "experience", "skills", "certifications", "achievements"],
    limits: { maxProjects: 4, maxExperience: 2, maxBulletsPerEntry: 4 },
  },
  {
    variantId: "research-internship",
    name: "Research Internship",
    roleKeywords: ["research", "research intern", "research assistant", "publication", "thesis", "deep learning", "statistics", "natural language processing"],
    sectionOrder: ["summary", "education", "projects", "experience", "achievements", "skills", "certifications"],
    limits: { maxProjects: 4, maxExperience: 2, maxBulletsPerEntry: 3 },
  },
  {
    variantId: "data-analyst",
    name: "Data Analyst",
    roleKeywords: ["data analyst", "data analysis", "business analyst", "sql", "tableau", "power bi", "excel", "data visualization", "dashboards", "etl"],
    sectionOrder: ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"],
    limits: { maxProjects: 3, maxExperience: 3, maxBulletsPerEntry: 4 },
  },
];

export const DEFAULT_VARIANT_IDS = SPECS.map((s) => s.variantId);

const entryText = (e: MasterEntry): string => [e.heading.text, e.subheading?.text ?? "", ...e.bullets.map((b) => b.text), e.technologies.join(" , ")].join(" \n ");
const hitCount = (text: string, keywords: string[]): number => {
  const p = probe(text);
  return keywords.filter((k) => probeMentions(p, k)).length;
};

/** The default variants for this master. Ids are stable ("ai-ml-engineer"...), so saving one twice replaces it. */
export function defaultVariants(master: MasterResume): ResumeVariant[] {
  return SPECS.map((spec) => {
    const entryOrder: string[] = [];
    for (const section of ENTRY_SECTIONS) {
      const inSection = master.entries.filter((e) => e.section === section);
      const ranked = inSection
        .map((e, i) => ({ e, i, hits: section === "education" ? 0 : hitCount(entryText(e), spec.roleKeywords) }))
        .sort((a, b) => b.hits - a.hits || a.i - b.i);
      entryOrder.push(...ranked.map((r) => r.e.entryId));
    }
    const skillGroupOrder = master.skillGroups
      .map((g, i) => ({ g, i, hits: hitCount([g.label, ...g.items.map((it) => it.text)].join(" , "), spec.roleKeywords) }))
      .sort((a, b) => b.hits - a.hits || a.i - b.i)
      .map((x) => x.g.groupId);
    return {
      variantId: spec.variantId,
      name: spec.name,
      roleKeywords: [...spec.roleKeywords],
      sectionOrder: [...spec.sectionOrder],
      entryOrder,
      pinnedFactIds: [],
      excludedFactIds: [],
      skillGroupOrder,
      limits: { ...spec.limits },
    };
  });
}
