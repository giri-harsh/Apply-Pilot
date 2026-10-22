/** Fictional person "Alex Example". All data is invented. One source of truth rendered into TXT, MD, PDF and DOCX. */
export type FixtureLine = {
  text: string;
  /** Right-aligned part of the same line (dates). Rendered as a column gap / tab. */
  right?: string;
  kind: "name" | "contact" | "heading" | "text" | "bullet";
};

const L = (kind: FixtureLine["kind"], text: string, right?: string): FixtureLine => ({ kind, text, ...(right ? { right } : {}) });

export const ALEX_LINES: FixtureLine[] = [
  L("name", "Alex Example"),
  L("contact", "alex.example@example.test | +1 555 010 0199 | Springfield, USA"),
  L("contact", "linkedin.com/in/alexexample | github.com/alexexample"),
  L("heading", "Summary"),
  L("text", "Final-year computer science student focused on data analysis and machine learning."),
  L("heading", "Education"),
  L("text", "Springfield Institute of Technology", "2022 - 2026"),
  L("text", "B.Tech in Computer Science | CGPA: 8.7/10"),
  L("bullet", "Relevant coursework: Machine Learning, Databases, Algorithms"),
  L("heading", "Work Experience"),
  L("text", "Acme Labs - Data Science Intern", "Jun 2025 - Aug 2025"),
  L("bullet", "Built SQL reports that the analytics team used for weekly planning"),
  L("bullet", "Trained a churn prediction model in scikit-learn and documented the results"),
  L("text", "Bright Works - Research Assistant", "Jan 2025 - Mar 2025"),
  L("bullet", "Cleaned and labelled a survey dataset of 2,000 responses"),
  L("heading", "Academic Projects"),
  L("text", "Sales Forecaster"),
  L("text", "Technologies: Python, pandas, scikit-learn"),
  L("bullet", "Forecast monthly sales with gradient boosting and a rolling validation split"),
  L("bullet", "Wrote a small command line tool to run the forecast on new data"),
  L("text", "Resume Parser"),
  L("bullet", "Extracted sections from text resumes with simple rules and unit tests"),
  L("text", "Campus Event Finder"),
  L("bullet", "Built a search page for campus events using TypeScript and a JSON feed"),
  L("heading", "Technical Skills"),
  L("text", "Languages: Python, SQL, TypeScript"),
  L("text", "Machine learning: scikit-learn, PyTorch (basics), pandas"),
  L("text", "Tools: Git, Docker, Linux"),
  L("heading", "Licenses & Certifications"),
  L("text", "Google Data Analytics Certificate", "2024"),
  L("text", "Deep Learning Specialization"),
];

export const GAP = "    ";

export function renderTxt(lines: FixtureLine[] = ALEX_LINES): string {
  return (
    lines
      .map((l) => {
        const base = l.kind === "bullet" ? `- ${l.text}` : l.kind === "heading" ? l.text.toUpperCase() : l.text;
        return l.right ? `${base}${GAP}${l.right}` : base;
      })
      .join("\n") + "\n"
  );
}

export function renderMd(lines: FixtureLine[] = ALEX_LINES): string {
  return (
    lines
      .map((l) => {
        if (l.kind === "name") return `# ${l.text}`;
        if (l.kind === "heading") return `## ${l.text}`;
        if (l.kind === "bullet") return `- ${l.text}`;
        if (l.kind === "text" && l.right) return `**${l.text}** ${GAP}${l.right}`;
        return l.right ? `${l.text}${GAP}${l.right}` : l.text;
      })
      .join("\n") + "\n"
  );
}
