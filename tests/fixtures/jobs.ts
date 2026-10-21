export type JobFixture = {
  file: string;
  title: string;
  company: string;
  sources: { title: string; company: string; description: string };
  mustContain: string[];
  mustNotContain: string[];
  required: string[];
  preferred: string[];
  location: string | null;
  employmentType: string | null;
  workArrangement: string | null;
  warnings?: RegExp[];
};

const DECOYS = ["DECOY_"];

/** What a correct extraction must produce for each synthetic job page. */
export const JOB_FIXTURES: JobFixture[] = [
  {
    file: "jsonld",
    title: "Machine Learning Intern",
    company: "Northwind Analytics",
    sources: { title: "json_ld", company: "json_ld", description: "json_ld" },
    mustContain: ["Northwind Analytics builds forecasting tools for retailers", "Train and evaluate NLP models using PyTorch", "Currently pursuing a Bachelor's or Master's degree in Computer Science"],
    mustNotContain: [...DECOYS, "We use cookies", "Data Entry Clerk"],
    required: ["Python", "SQL", "Machine Learning"],
    preferred: ["Docker", "AWS", "Hugging Face"],
    location: "Pune, Maharashtra, IN",
    employmentType: "internship",
    workArrangement: null,
  },
  {
    file: "no-jsonld",
    title: "Data Science Intern",
    company: "Contoso Labs",
    sources: { title: "heading", company: "page_selector", description: "main_content" },
    mustContain: ["Contoso Labs is looking for a Data Science Intern", "Clean and explore datasets with Pandas and NumPy", "Stipend, mentorship and flexible hours"],
    mustNotContain: [...DECOYS],
    required: ["Python", "SQL", "Machine Learning", "Statistics"],
    preferred: ["Apache Spark", "Git"],
    location: "Bengaluru, Karnataka (Hybrid)",
    employmentType: "internship",
    workArrangement: "hybrid",
  },
  {
    file: "noisy",
    title: "Data Analyst Intern",
    company: "Globex Corporation",
    sources: { title: "heading", company: "document_title", description: "main_content" },
    mustContain: ["Globex Corporation is a global manufacturer", "Write SQL queries against our warehouse", "Working knowledge of SQL and Excel"],
    mustNotContain: [...DECOYS, "Senior Plumber", "Truck Driver", "cookie policy", "50% off", "Cover letter", "Submit application"],
    required: ["SQL", "Excel"],
    preferred: ["Tableau", "Looker"],
    location: null,
    employmentType: "internship",
    workArrangement: null,
    warnings: [/Company inferred from the page title/],
  },
  {
    file: "adversarial-jd",
    title: "Backend Intern",
    company: "Initech",
    sources: { title: "heading", company: "page_selector", description: "main_content" },
    mustContain: ["Initech is hiring a Backend Intern", "Experience with Python and FastAPI"],
    mustNotContain: [...DECOYS, "HIDDEN_SKILL_TRAP", "HIDDEN_STYLE_TRAP"],
    required: ["Python", "FastAPI", "PostgreSQL"],
    preferred: ["Docker"],
    location: null,
    employmentType: "internship",
    workArrangement: null,
    warnings: [/instruction-like text/],
  },
  {
    file: "tabs-accordion",
    title: "Research Engineer Intern",
    company: "Umbrella Research",
    sources: { title: "heading", company: "page_selector", description: "main_content" },
    mustContain: ["Umbrella Research explores reinforcement learning", "Implement research prototypes in Python", "Solid Python and PyTorch experience"],
    mustNotContain: [...DECOYS, "HIDDEN_TAB_ONLY_PHRASE", "HIDDEN_BENEFITS_PHRASE", "HIDDEN_ACCORDION_ONLY_PHRASE"],
    required: ["Python", "PyTorch", "Reinforcement Learning"],
    preferred: [],
    location: null,
    employmentType: "internship",
    workArrangement: null,
  },
];
