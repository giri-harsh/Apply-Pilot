/**
 * Local skills dictionary with synonyms (SPEC 8.2 / 13.2: no AI needed for this).
 * `names` are matched case-insensitively with word-ish boundaries; the first name is the canonical label.
 */

export type SkillCategory = "language" | "ml" | "library" | "data" | "database" | "web" | "cloud" | "devops" | "tool" | "genai";

type SkillDef = {
  names: string[];
  category: SkillCategory;
  /** Regex sources for ambiguous tokens such as Go or R (always case-sensitive). */
  patterns?: string[];
  /** Common English words that are only skills when capitalised (React, Spring...). */
  caseSensitive?: boolean;
  /** Ambiguous words (Swift, Express, Spring) that only count inside a skills-like context. */
  contextual?: string[];
  /** Do not match `names` on their own; only the contextual forms count. */
  onlyContextual?: boolean;
};

const S = (category: SkillCategory, ...names: string[]): SkillDef => ({ names, category });
const X = (category: SkillCategory, canonical: string, ...contextual: string[]): SkillDef => ({ names: [canonical], category, caseSensitive: true, contextual, onlyContextual: true });
const C = (category: SkillCategory, ...names: string[]): SkillDef => ({ names, category, caseSensitive: true });

export const SKILLS: SkillDef[] = [
  // languages
  S("language", "Python"),
  S("language", "Java"),
  S("language", "JavaScript", "JS", "ECMAScript"),
  S("language", "TypeScript", "TS"),
  S("language", "C++", "CPP"),
  S("language", "C#", "CSharp"),
  S("language", "SQL"),
  S("language", "Scala"),
  S("language", "Kotlin"),
  X("language", "Swift", "Swift"),
  C("language", "Rust"),
  S("language", "MATLAB"),
  S("language", "Bash", "Shell scripting"),
  S("language", "PHP"),
  X("language", "Ruby", "Ruby"),
  { names: ["Go"], category: "language", patterns: ["\\bGolang\\b", "\\bGo\\b(?=\\s*(?:programming|language|/))", "(?<=,\\s)Go(?=\\s*(?:[,.)]|$))", "(?<=\\b(?:Python|Java|Rust|C\\+\\+|Scala)\\s(?:and|or)\\s)Go\\b"] },
  { names: ["R"], category: "language", patterns: ["\\bR\\b(?=\\s*(?:programming|language|studio))", "(?<=,\\s)R(?=\\s*(?:[,.)]|$))", "(?<=\\b(?:Python|SQL|SAS|MATLAB)\\s(?:and|or)\\s)R\\b", "(?<=\\b(?:Python|SQL|SAS|MATLAB)/)R\\b"] },
  // ml
  S("ml", "Machine Learning", "ML"),
  S("ml", "Deep Learning", "DL"),
  S("ml", "Natural Language Processing", "NLP"),
  S("ml", "Computer Vision", "CV"),
  S("ml", "Reinforcement Learning"),
  S("ml", "Time Series", "Time-series forecasting"),
  S("ml", "Statistics", "Statistical modeling", "Statistical analysis"),
  S("ml", "Feature Engineering"),
  S("ml", "A/B Testing", "AB testing", "Experimentation"),
  S("ml", "MLOps"),
  S("ml", "Recommender Systems", "Recommendation systems"),
  S("ml", "Data Science"),
  // genai
  S("genai", "Generative AI", "GenAI", "Gen AI"),
  S("genai", "Large Language Models", "LLMs", "LLM"),
  S("genai", "RAG", "Retrieval-Augmented Generation", "Retrieval Augmented Generation"),
  S("genai", "Prompt Engineering"),
  S("genai", "AI Agents", "Agentic AI", "Agentic workflows", "LLM agents"),
  S("genai", "Vector Databases", "Vector database", "Vector search"),
  S("genai", "Fine-tuning", "Finetuning", "Fine tuning", "LoRA"),
  // libraries
  S("library", "PyTorch", "torch"),
  S("library", "TensorFlow"),
  S("library", "Keras"),
  S("library", "scikit-learn", "sklearn", "scikit learn"),
  S("library", "Pandas"),
  S("library", "NumPy"),
  S("library", "SciPy"),
  S("library", "Hugging Face", "HuggingFace", "Transformers library"),
  S("library", "LangChain"),
  S("library", "LlamaIndex"),
  S("library", "XGBoost"),
  S("library", "LightGBM"),
  S("library", "OpenCV"),
  S("library", "spaCy"),
  S("library", "NLTK"),
  S("library", "Matplotlib"),
  S("library", "Seaborn"),
  S("library", "Jupyter"),
  // data
  S("data", "Apache Spark", "Spark", "PySpark"),
  S("data", "Hadoop"),
  S("data", "Airflow", "Apache Airflow"),
  S("data", "Kafka", "Apache Kafka"),
  S("data", "dbt"),
  S("data", "Tableau"),
  S("data", "Power BI", "PowerBI"),
  S("data", "Excel", "Microsoft Excel"),
  S("data", "ETL", "ELT"),
  S("data", "Data Visualization", "Data visualisation"),
  S("data", "Data Analysis", "Data analytics"),
  C("data", "Looker"),
  // databases
  S("database", "PostgreSQL", "Postgres"),
  S("database", "MySQL"),
  S("database", "MongoDB"),
  S("database", "Redis"),
  S("database", "SQLite"),
  S("database", "Elasticsearch"),
  S("database", "Snowflake"),
  S("database", "BigQuery"),
  S("database", "DynamoDB"),
  S("database", "Pinecone"),
  S("database", "FAISS"),
  // web / backend
  C("web", "React", "React.js", "ReactJS"),
  C("web", "Next.js", "NextJS"),
  C("web", "Node.js", "NodeJS", "Node"),
  S("web", "Django"),
  S("web", "Flask"),
  S("web", "FastAPI"),
  { names: ["Spring Boot"], category: "web", caseSensitive: true, contextual: ["Spring"] },
  { names: ["Express.js"], category: "web", caseSensitive: true, contextual: ["Express"] },
  C("web", "Angular"),
  C("web", "Vue", "Vue.js"),
  S("web", "HTML/CSS", "HTML", "CSS"),
  S("web", "REST APIs", "REST API", "RESTful", "REST"),
  S("web", "GraphQL"),
  S("web", "Microservices"),
  S("web", "Tailwind CSS", "Tailwind"),
  // cloud & devops
  S("cloud", "AWS", "Amazon Web Services", "SageMaker"),
  S("cloud", "GCP", "Google Cloud", "Vertex AI"),
  S("cloud", "Azure"),
  S("devops", "Docker"),
  S("devops", "Kubernetes", "k8s"),
  S("devops", "Terraform"),
  S("devops", "CI/CD", "Continuous integration"),
  S("devops", "Linux"),
  S("devops", "GitHub Actions"),
  // tools
  S("tool", "Git", "GitHub", "GitLab", "version control"),
  S("tool", "Agile", "Scrum"),
  S("tool", "Jira"),
  S("tool", "Figma"),
  S("tool", "Unit testing", "pytest", "Jest", "Test automation"),
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
const bound = (n: string) =>
  `(?<![A-Za-z0-9_])${escape(n).replace(/\\-/g, "[-\\s]?").replace(/\s+/g, "\\s+")}(?![A-Za-z0-9_])`;
const isCapsToken = (n: string) => /^[A-Z][A-Z0-9/+#]{1,5}$/.test(n);

type Compiled = { canonical: string; ci: RegExp | null; cs: RegExp | null };

function compile(): Compiled[] {
  return SKILLS.map((d) => {
    const csParts: string[] = [...(d.patterns ?? [])];
    const ciParts: string[] = [];
    if (!d.patterns && !d.onlyContextual) {
      for (const n of d.names) (d.caseSensitive || isCapsToken(n) ? csParts : ciParts).push(bound(n));
    }
    for (const n of d.contextual ?? []) {
      const w = escape(n);
      // Preceded by list punctuation / a typical preposition, or followed by list punctuation / "programming"...
      csParts.push(`(?<=(?:[,/&(:]|\\b(?:and|or|with|using|in|of|including|like|plus)\\b)\\s*)${w}(?![A-Za-z0-9_])`);
      csParts.push(`(?<![A-Za-z0-9_])${w}(?=\\s*(?:[,/)&;]|programming|language|framework|developer|\\.js))`);
    }
    return {
      canonical: d.names[0]!,
      ci: ciParts.length ? new RegExp(ciParts.join("|"), "i") : null,
      cs: csParts.length ? new RegExp(csParts.join("|")) : null,
    };
  });
}

let compiled: Compiled[] | null = null;

/** Canonical skill names found in `text`, in dictionary order. */
export function extractSkills(text: string): string[] {
  compiled ??= compile();
  return compiled.filter((c) => c.ci?.test(text) || c.cs?.test(text)).map((c) => c.canonical);
}

const normalizeKey = (s: string) => s.toLowerCase().replace(/[-\s.]+/g, "");
const bySynonym = new Map<string, string>();
for (const d of SKILLS) for (const n of d.names) bySynonym.set(normalizeKey(n), d.names[0]!);

/** Maps a user-written skill ("sklearn", "Postgres", "PyTorch") to the dictionary's canonical name, else a normalized form. */
export function canonicalSkill(name: string): string {
  return bySynonym.get(normalizeKey(name)) ?? name.trim().toLowerCase();
}
