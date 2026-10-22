import { describe, expect, it } from "vitest";
import { kindFromFilename, resumeFilename } from "@/resume/filename";

const d = new Date("2026-10-22T10:00:00Z");

describe("resume filenames", () => {
  it("follows Company_Role_Resume_date.pdf", () => {
    expect(resumeFilename({ company: "Northwind Analytics", role: "Machine Learning Intern", date: d })).toBe("Northwind-Analytics_Machine-Learning-Intern_Resume_2026-10-22.pdf");
  });

  it("is ASCII only, has no path characters and bounds its length", () => {
    const name = resumeFilename({ company: "Zoë & Söhne / ../etc", role: "Développeur <script>", date: d });
    expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(name).not.toContain("..");
    expect(resumeFilename({ company: "x".repeat(300), role: "y".repeat(300), date: d }).length).toBeLessThan(90);
  });

  it("falls back to placeholders and never contains personal information it was not given", () => {
    expect(resumeFilename({ company: "", role: "???", date: d })).toBe("Company_Role_Resume_2026-10-22.pdf");
  });

  it("avoids collisions with a numeric suffix", () => {
    const taken = new Set(["A_B_Resume_2026-10-22.pdf", "A_B_Resume_2026-10-22-2.pdf"]);
    expect(resumeFilename({ company: "A", role: "B", date: d, taken })).toBe("A_B_Resume_2026-10-22-3.pdf");
  });

  it("marks cover letters and docx, and the kind marker round-trips", () => {
    const cl = resumeFilename({ company: "A", role: "B", kind: "CoverLetter", date: d });
    expect(cl).toBe("A_B_CoverLetter_2026-10-22.pdf");
    expect(kindFromFilename(cl)).toBe("CoverLetter");
    expect(kindFromFilename(resumeFilename({ company: "A", role: "B", date: d, ext: "docx" }))).toBe("Resume");
    expect(kindFromFilename("notes.pdf")).toBeNull();
  });
});
