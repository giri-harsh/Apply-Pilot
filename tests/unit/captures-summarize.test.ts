import { describe, expect, it } from "vitest";
import { leakFindings, screen, summarize } from "../../scripts/captures-lib.mjs";

const field = (over: Record<string, unknown> = {}) => ({
  index: 0, label: "First Name", labelSource: "explicit_label", signals: [{ source: "explicit_label", text: "First Name" }],
  control: "text", inputType: "text", required: true, enabled: true, visible: true, section: "", options: [], optionCount: 0,
  ambiguous: false, ambiguityReason: null, risk: "low", semanticType: "first_name", confidence: 0.95, widget: "none",
  accept: "", nameHint: "first_name", idHint: "first_name", ...over,
});

const capture = (over: Record<string, unknown> = {}) => ({
  version: 1, captureId: "c-1234abcd", capturedAt: "2026-01-01T00:00:00.000Z", extensionVersion: "0.1.0", step: null,
  page: { host: "boards.example-ats.test", path: "/acme/jobs/<num>", title: "Application" },
  signals: { generator: null, scriptHosts: ["cdn.example-ats.test"], classPrefixes: [{ prefix: "ats-", count: 12 }], dataAttributes: [{ name: "data-qa", count: 4 }] },
  headings: ["Apply"],
  fields: [
    field(),
    field({ index: 1, label: "Pronouns", semanticType: "unknown", confidence: 0, signals: [{ source: "explicit_label", text: "Pronouns" }] }),
    field({ index: 2, label: "Email or Phone", ambiguous: true, ambiguityReason: "Conflicting signals: email vs phone", semanticType: "email" }),
    field({ index: 3, label: "Resume", control: "file", semanticType: "resume_upload", accept: ".pdf,.docx" }),
  ],
  controls: [{ text: "Submit application", role: "final", reasons: ["label"] }, { text: "Next", role: "next", reasons: [] }],
  stepIndicator: null, hasReviewSummary: false, isLastStep: true,
  frames: [{ origin: "https://www.google.com", accessible: false, visible: false, width: 0, height: 0 }],
  shadowRoots: 0, blockers: [{ type: "captcha" }],
  lastRun: { state: "PAUSED", steps: [{ index: 0, title: "Apply", outcome: "ok", verified: 3, failed: 0, requiredUnresolved: 1 }], results: [{ label: "Pronouns", outcome: "unresolved", reason: "no match", semanticType: "unknown", required: true }] },
  ...over,
});

describe("capture intake", () => {
  it("summarizes a clean capture per portal: signals, types, unresolved, buttons, uploads, blockers, run status", () => {
    const { clean, refused } = screen([{ name: "clean.json", json: capture() }]);
    expect(refused).toEqual([]);
    const md = summarize({ clean, refused });
    expect(md).toContain("## boards.example-ats.test");
    expect(md).toContain("script hosts: cdn.example-ats.test");
    expect(md).toContain("- first_name: 1");
    expect(md).toMatch(/"Pronouns" \[text, required\] type=unknown/);
    expect(md).toContain("ambiguous: Conflicting signals: email vs phone");
    expect(md).toContain('"Submit application" -> final');
    expect(md).toContain("accept=.pdf,.docx");
    expect(md).toContain("blockers: captcha");
    expect(md).toContain("iframes: 1 (1 not accessible, 0 visible)");
    expect(md).toContain("PAUSED");
    expect(md).toContain('required not done: "Pronouns" unresolved (no match)');
  });

  it("an array export is read capture by capture and grouped by host", () => {
    const { clean } = screen([{ name: "all.json", json: [capture(), capture({ page: { host: "other.test", path: "/x", title: "T" } })] }]);
    expect(summarize({ clean, refused: [] }).match(/^## /gm)).toHaveLength(2);
  });

  it("refuses a file with a planted leak, lists it, and never summarizes it", () => {
    const leaky = capture({ fields: [field({ label: "Reach me at jane.doe@mail.com" })] });
    const { clean, refused } = screen([
      { name: "clean.json", json: capture() },
      { name: "leaky.json", json: leaky },
      { name: "garbage.json", json: null },
    ]);
    expect(clean).toHaveLength(1);
    expect(refused.map((r) => r.name)).toEqual(["leaky.json", "garbage.json"]);
    const md = summarize({ clean, refused });
    expect(md).toContain("leaky.json: failed redaction re-scan - email x1");
    expect(md).not.toContain("jane.doe");
    expect(md).not.toContain("Reach me at");
  });

  it.each([
    ["an email", "write to a@b.co", "email"],
    ["a URL with a query string", "see https://x.test/p?token=abc", "url with query string"],
    ["a phone number", "call +1 415 555 0100", "phone-like number"],
    ["long free text", "word ".repeat(60), "long free text"],
  ])("flags %s", (_n, text, kind) => {
    expect(leakFindings(capture({ headings: [text] })).map((f) => f.kind)).toEqual([kind]);
  });

  it("masked placeholders and a normal capture are not flagged", () => {
    expect(leakFindings(capture({ headings: ["<email>", "<url>", "<phone>", "<num>"] }))).toEqual([]);
  });
});
