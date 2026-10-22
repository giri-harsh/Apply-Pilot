# Handoff

Branch `hardening-wip` (from main at ccf7efd). Queue in order: M1 -> M2 -> M3 -> M4, then Q1-Q5 on branch `queue-wip`.

## Done
- M1-M4 done and merged: phase-7b, phase-8-prep (capture), phase-11a (hardening). 3x e2e green (146), 776 unit.

## Next
- M2: redacted portal capture (popup button + options Diagnostics tab, IndexedDB `diagnostics` namespace, redaction unit test scanning every profile string, JSON export via blob anchor, "capture each step" mode).
- M3: privacy/log scan test, permission snapshot vs PERMISSIONS.md, key-protection tests, error-code table test (SPEC 21.3), run-limit status tests, axe on popup/options, `pnpm metrics` -> docs/METRICS.md, `pnpm package` zip, clean clone build at C:\Work\ap-verify, README + docs.
- M4: unit/typecheck/lint/build, 3x e2e, fast-forward main, delete branch.
- Queue: Q1 adapter framework + FakeATS, Q2 learned strategies, Q3 history/usage views, Q4 in-page indicator (shadow DOM), Q5 final.

## Rules
Write/Edit only for source; no subagents; targeted tests (`vitest --reporter=dot <path>`, `playwright test <spec> --reporter=line`); live AI budget 0 after M1; attribution-free commits; never push.
