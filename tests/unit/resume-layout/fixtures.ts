import { TailoredResumeSchema, type TailoredLine, type TailoredResume } from "@/resume/schema";

/** Local TailoredResume fixtures for the layout tests (independent of B1's master fixtures). */

type Opts = Partial<Pick<TailoredLine, "url" | "relevance" | "protected" | "onlyEvidenceForRequiredQualification">>;
export function line(id: string, role: TailoredLine["role"], text: string, o: Opts = {}): TailoredLine {
  return {
    lineId: id,
    role,
    text,
    url: o.url,
    sourceFactIds: [`fact_${id}`],
    origin: "master",
    relevance: o.relevance ?? 0.5,
    protected: o.protected ?? false,
    onlyEvidenceForRequiredQualification: o.onlyEvidenceForRequiredQualification ?? false,
  };
}

const title = (key: string, text: string) => line(`t_${key}`, "section_title", text, { protected: true, relevance: 1 });

export type Section = TailoredResume["sections"][number];
export function resume(sections: Section[]): TailoredResume {
  return TailoredResumeSchema.parse({
    tailoredId: "t1",
    masterId: "m1",
    masterHash: "a".repeat(64),
    variantId: "v1",
    sections,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

export function header(name = "Alex Example", extra: TailoredLine[] = []): Section {
  return {
    key: "header",
    title: "Header",
    entries: [
      {
        entryId: "hdr",
        lines: [
          line("name", "name", name, { protected: true, relevance: 1 }),
          line("c_email", "contact", "alex@example.test", { protected: true, relevance: 1 }),
          line("c_phone", "contact", "+91 98765 43210", { protected: true, relevance: 1 }),
          line("c_loc", "contact", "Pune, India", { protected: true, relevance: 1 }),
          line("c_gh", "contact", "github.com/alex-example", { url: "https://github.com/alex-example", protected: true, relevance: 1 }),
          line("c_li", "contact", "linkedin.com/in/alex-example", { url: "https://linkedin.com/in/alex-example", protected: true, relevance: 1 }),
          ...extra,
        ],
      },
    ],
  };
}

/** A small realistic resume that fits on one page without any fit-loop action. */
export function smallResume(): TailoredResume {
  return resume([
    header(),
    {
      key: "summary",
      title: "Summary",
      entries: [{ entryId: "sum", lines: [title("summary", "Summary"), line("sum1", "paragraph", "Final-year computer science student with hands-on experience building data pipelines and forecasting models, looking for a data science internship.", { relevance: 0.7 })] }],
    },
    {
      key: "education",
      title: "Education",
      entries: [
        {
          entryId: "edu1",
          lines: [
            title("education", "Education"),
            line("edu1_h", "entry_heading", "Savitribai Phule Pune University", { relevance: 0.9 }),
            line("edu1_s", "entry_subheading", "B.Tech in Computer Science, CGPA 8.7/10", { relevance: 0.9 }),
            line("edu1_m", "entry_meta", "2022 – 2026", { relevance: 0.9 }),
          ],
        },
      ],
    },
    {
      key: "experience",
      title: "Experience",
      entries: [
        {
          entryId: "exp1",
          lines: [
            title("experience", "Experience"),
            line("exp1_h", "entry_heading", "Acme Labs — Data Intern", { relevance: 0.9 }),
            line("exp1_m", "entry_meta", "Jun 2025 – Aug 2025", { relevance: 0.9 }),
            line("exp1_b1", "bullet", "Built SQL reports for the analytics team, cutting weekly reporting time from 6 hours to 90 minutes.", { relevance: 0.9 }),
            line("exp1_b2", "bullet", "Cleaned and joined 4 data sources in pandas; documented the pipeline on the team wiki.", { relevance: 0.6 }),
          ],
        },
        {
          entryId: "exp2",
          lines: [
            line("exp2_h", "entry_heading", "Campus Robotics Club — Software Lead", { relevance: 0.4 }),
            line("exp2_m", "entry_meta", "2023 – 2025", { relevance: 0.4 }),
            line("exp2_b1", "bullet", "Led a team of 6 students shipping a line-following robot; wrote the control loop in C++.", { relevance: 0.4 }),
          ],
        },
      ],
    },
    {
      key: "projects",
      title: "Projects",
      entries: [
        {
          entryId: "prj1",
          lines: [
            title("projects", "Projects"),
            line("prj1_h", "entry_heading", "Sales Forecaster", { relevance: 0.8, url: "https://github.com/alex-example/sales-forecaster" }),
            line("prj1_m", "entry_meta", "Python, scikit-learn", { relevance: 0.8 }),
            line("prj1_b1", "bullet", "Trained gradient-boosted models on 3 years of retail data; reduced MAPE by 18% against a seasonal baseline.", { relevance: 0.8 }),
          ],
        },
      ],
    },
    {
      key: "skills",
      title: "Skills",
      entries: [
        {
          entryId: "skl",
          lines: [
            title("skills", "Skills"),
            line("skl1", "skills_row", "Languages: Python, SQL, C++, TypeScript", { relevance: 0.8 }),
            line("skl2", "skills_row", "Machine learning: scikit-learn, pandas, NumPy, PyTorch", { relevance: 0.8 }),
          ],
        },
      ],
    },
  ]);
}

const BULLET_TEXTS = [
  "Designed and implemented a batch ingestion service that normalised partner CSV feeds into a typed warehouse schema, with automated validation and a replayable audit trail for every rejected row.",
  "Reduced p95 query latency from 4.2 s to 640 ms by rewriting three hot SQL paths, adding covering indexes and caching the dimension tables that were joined on every request.",
  "Wrote the onboarding guide and a week of pairing sessions for four new interns, who then shipped their first production change within five working days.",
  "Introduced contract tests between the web client and the forecasting API so schema drift is caught in CI instead of by users.",
  "Short bullet about on-call.",
];

function bulletsFor(prefix: string, count: number, o: (i: number) => Opts): TailoredLine[] {
  return Array.from({ length: count }, (_, i) => line(`${prefix}_b${i + 1}`, "bullet", `${BULLET_TEXTS[i % BULLET_TEXTS.length]} (${prefix} item ${i + 1})`, o(i)));
}

/**
 * Overflowing fixture. `allProtected` makes every bullet protected/required so nothing can be dropped (honest-overflow test);
 * otherwise bullets carry graded relevance so the fit loop has low-relevance material to drop.
 */
export function longResume(allProtected: boolean): TailoredResume {
  const entry = (sec: string, i: number, count: number, relBase: number) => ({
    entryId: `${sec}_e${i}`,
    lines: [
      ...(i === 0 ? [title(sec, sec[0]!.toUpperCase() + sec.slice(1))] : []),
      line(`${sec}${i}_h`, "entry_heading", `${sec} entry ${i} — Role at Company ${i}`, { relevance: relBase }),
      line(`${sec}${i}_m`, "entry_meta", `20${20 + i} – 20${21 + i}`, { relevance: relBase }),
      ...bulletsFor(`${sec}${i}`, count, (k) => ({ relevance: allProtected ? 0.9 : Math.max(0.05, relBase - k * 0.1), protected: allProtected })),
    ],
  });
  return resume([
    header("Priya Natarajan"),
    { key: "education", title: "Education", entries: [{ entryId: "edu", lines: [title("education", "Education"), line("edu_h", "entry_heading", "IIT Madras", { relevance: 0.95 }), line("edu_m", "entry_meta", "2020 – 2024", { relevance: 0.95 }), line("edu_b1", "bullet", "Minor in statistics; teaching assistant for Linear Algebra.", { relevance: 0.2 })] }] },
    { key: "experience", title: "Experience", entries: [entry("experience", 0, 5, 0.95), entry("experience", 1, 5, 0.7), entry("experience", 2, 5, 0.3)] },
    { key: "projects", title: "Projects", entries: [entry("projects", 0, 5, 0.85), entry("projects", 1, 5, 0.5), entry("projects", 2, 5, 0.15)] },
    { key: "skills", title: "Skills", entries: [{ entryId: "skl", lines: [title("skills", "Skills"), line("skl1", "skills_row", "Languages: Python, SQL, Go, Rust", { relevance: 0.8 })] }] },
  ]);
}
