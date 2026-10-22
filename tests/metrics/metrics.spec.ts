import { test } from "@playwright/test";
import fs from "node:fs";
import { launchExtension, runPortal, type Ext } from "../e2e/support/extension";

/**
 * SPEC 25.5 measurement on the deterministic synthetic suite (AI off, no network). Each fixture lists every field whose
 * correct end state a human would define independently of our mapper: the value it must hold, or "" when it must be left
 * alone (sensitive, ambiguous, unknown, disabled, hidden, not in the profile). Nothing here is derived from our own output.
 *
 *  - autofill correctness  = expectations whose END STATE is right (right value, or untouched)
 *  - standard-control handling = native controls (text, email, tel, url, select, textarea, radio, checkbox) whose end state is
 *    right AND whose report row agrees (filled -> filled_verified; left alone -> not reported as filled)
 *  - run time = the run record's own clock, median of 3 runs per fixture
 *
 * Results go to test-results/metrics.json; `pnpm metrics` turns them into docs/METRICS.md. No rounding up anywhere.
 */

type Kind = "text" | "select" | "textarea" | "radio" | "checkbox";
type Expect = { sel: string; label: string; kind: Kind; want: string; /** select: compare the selected option's label */ optionLabel?: boolean; /** the page already held this value; it must be kept, not reported as filled */ keep?: boolean };
type Fixture = { portal: string; expects: Expect[] };

const T = (sel: string, label: string, want: string, kind: Kind = "text"): Expect => ({ sel, label, kind, want });
const S = (sel: string, label: string, want: string): Expect => ({ sel, label, kind: "select", want, optionLabel: true });
const EMPTY = (sel: string, label: string, kind: Kind = "text"): Expect => ({ sel, label, kind, want: "" });

const FIXTURES: Fixture[] = [
  {
    portal: "basic",
    expects: [
      T("#fullname", "Full Name", "Alex Example"),
      T("#email", "Email Address", "alex@example.test"),
      T("#phone", "Phone", "+91 98765 43210"),
      T("#city", "City", "Pune"),
      S("#country", "Country", "India"),
      T("#linkedin", "LinkedIn", "https://www.linkedin.com/in/alex-example"),
      T("#github", "GitHub", "https://github.com/alex-example"),
      T("#school", "University", "Example Institute of Technology"),
      T("#degree", "Degree", "Bachelor of Technology"),
      T("#gradyear", "Graduation Year", "2027"),
    ],
  },
  {
    portal: "required-optional",
    expects: [
      T("#n", "Full name", "Alex Example"),
      T("#e", "Email", "alex@example.test"),
      T("#p", "Phone", "+91 98765 43210"),
      EMPTY("#ce", "Current employer"), // not in the profile: never invented
      { ...T("#pre", "Preferred name (existing value is kept)", "Existing Value"), keep: true },
      S("#sel", "Degree", "Bachelor of Technology"),
      EMPTY("#why", "Why join us (open-ended, AI off)", "textarea"),
      EMPTY("#dis", "City (disabled)"),
      EMPTY("#trap", "Hidden honeypot"),
    ],
  },
  {
    portal: "sensitive",
    expects: [
      T("#n", "Full name", "Alex Example"),
      T("#e", "Email", "alex@example.test"),
      EMPTY("#auth", "Work authorization", "select"),
      EMPTY("#gender", "Gender", "select"),
      EMPTY("#vet", "Veteran status", "select"),
      EMPTY("#dis", "Disability status", "select"),
      EMPTY("#race", "Race / ethnicity", "select"),
      EMPTY("#crim", "Criminal record"),
      EMPTY("#sal", "Expected salary"),
      EMPTY("#dob", "Date of birth"),
      { sel: "#consent", label: "Consent checkbox", kind: "checkbox", want: "" },
      { sel: "input[name=sponsor][value=yes]", label: "Sponsorship yes", kind: "radio", want: "" },
      { sel: "input[name=sponsor][value=no]", label: "Sponsorship no", kind: "radio", want: "" },
    ],
  },
  {
    portal: "duplicate-labels",
    expects: [
      T("#a-name", "Applicant name", "Alex Example"),
      T("#a-email", "Applicant email", "alex@example.test"),
      EMPTY("#r-name", "Reference name"),
      EMPTY("#r-email", "Reference email"),
      EMPTY("#r-phone", "Reference phone"),
      EMPTY("#x1", "City (duplicate A)"),
      EMPTY("#x2", "City (duplicate B)"),
    ],
  },
  {
    portal: "dynamic-conditional",
    expects: [
      T("#n", "Full name", "Alex Example"),
      T("#e", "Email", "alex@example.test"),
      S("#country", "Country", "India"),
      S("#state", "State (revealed by the country)", "Maharashtra"),
      EMPTY("#status", "Employment status", "select"),
      EMPTY("#employer", "Employer (stays hidden)"),
    ],
  },
  {
    portal: "resume-flow",
    expects: [T("#n", "Full name", "Alex Example"), T("#e", "Email", "alex@example.test")],
  },
];

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

type Row = { portal: string; label: string; kind: Kind; want: string; got: string; endStateOk: boolean; reportOk: boolean; reportOutcome: string; matchable: boolean };
const rows: Row[] = [];
const times: Record<string, number[]> = {};

for (const fx of FIXTURES) {
  test(`metrics: ${fx.portal}`, async () => {
    test.setTimeout(120_000);
    for (let rep = 0; rep < 3; rep++) {
      const { page, popup, record, report } = await runPortal(ext, fx.portal);
      (times[fx.portal] ??= []).push(record.updatedAt - record.startedAt);
      if (rep === 0) {
        for (const e of fx.expects) {
          const loc = page.locator(e.sel);
          const got =
            e.kind === "checkbox" || e.kind === "radio"
              ? (await loc.isChecked()) ? "checked" : ""
              : e.optionLabel
                ? await loc.evaluate((el) => ((el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "").trim()).then((t) => (/^(select|choose)/i.test(t) ? "" : t))
                : await loc.inputValue();
          const endStateOk = got === e.want;
          // The report row is matched by the page's own <label for>, so it is independent of our naming. A label that occurs
          // more than once on the page (duplicate sections) cannot be matched to one report row: those are excluded from the
          // control-handling metric and counted separately, never silently passed.
          const labelLoc = page.locator(`label[for="${e.sel.replace(/^#/, "")}"]`);
          const domLabel = e.sel.startsWith("#") && (await labelLoc.count()) > 0 ? ((await labelLoc.first().textContent({ timeout: 2000 })) ?? "").replace(/\s*\*$/, "").trim().toLowerCase() : "";
          const sameLabel = domLabel ? await page.locator("label").evaluateAll((ls, t) => ls.filter((l) => (l.textContent ?? "").replace(/\s*\*$/, "").trim().toLowerCase() === t).length, domLabel) : 0;
          const matchable = domLabel !== "" && sameLabel === 1;
          const row = matchable ? report.results.find((r) => r.label.replace(/\s*\*$/, "").trim().toLowerCase() === domLabel) : undefined;
          const outcome = row?.outcome ?? (matchable ? "not_reported" : "not_matchable");
          // "keep" expectations hold a value the page already had: the right report is NOT "filled".
          const reportOk = !matchable ? true : e.want !== "" && !e.keep ? outcome === "filled_verified" || outcome === "already_correct" : outcome !== "filled_verified";
          rows.push({ portal: fx.portal, label: e.label, kind: e.kind, want: e.want, got, endStateOk, reportOk, reportOutcome: outcome, matchable });
        }
      }
      await popup.close();
      await page.close();
    }
  });
}

test.afterAll(() => {
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  const standard = rows.filter((r) => r.matchable);
  const autofill = rows.filter((r) => r.endStateOk).length;
  const handled = standard.filter((r) => r.endStateOk && r.reportOk).length;
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    "test-results/metrics.json",
    JSON.stringify(
      {
        autofill: { correct: autofill, total: rows.length },
        controls: { handled, total: standard.length, excludedUnmatchable: rows.length - standard.length },
        failing: rows.filter((r) => !r.endStateOk || !r.reportOk),
        medianRunMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)])),
        runsPerFixture: 3,
        fixtures: FIXTURES.map((f) => f.portal),
      },
      null,
      2,
    ),
  );
});
