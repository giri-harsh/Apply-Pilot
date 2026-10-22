# Metrics (SPEC 25.5)

Measured 2026-10-22 on commit `f130334` by `pnpm metrics`.
Deterministic synthetic suite only (AI off, no network). These are engineering targets measured on our own fixtures, not a claim about real portals, which are measured separately.

| Metric | Correct / total | Result | Target | |
|---|---|---|---|---|
| Autofill correctness (end state right: right value, or left alone) | 47 / 47 | 100.0% | 98% | meets target |
| Standard-control handling (end state right AND the report agrees) | 37 / 37 | 100.0% | 95% | meets target |

10 expectation(s) are excluded from the control-handling metric because they have no unique `<label for>` on the page (duplicate sections, radios and checkboxes without a label element, hidden fields), so a report row cannot be matched to them independently; they still count in the autofill correctness metric. The suite is small (47 hand-written expectations over 6 fixtures): treat the percentages as a regression gate, not as a statistic.

Fixtures: basic, required-optional, sensitive, duplicate-labels, dynamic-conditional, resume-flow. Every expectation is written by hand per field (the value a person would enter, or "left alone" for sensitive, ambiguous, unknown, disabled and hidden fields); none is derived from our own output.

## Failing expectations

None in this run.

## Run time (no AI)

Median of 3 runs per fixture, from the run record's own clock (click to final state, including settle waits and navigation checks).

| Fixture | Median run time |
|---|---|
| basic | 780 ms |
| required-optional | 561 ms |
| sensitive | 524 ms |
| duplicate-labels | 534 ms |
| dynamic-conditional | 777 ms |
| resume-flow | 480 ms |
