# Handoff

Everything is merged into `main` (Greenhouse invisible-reCAPTCHA fix, company fallbacks, popup run-lookup retry, capture intake).

Verified on the final tree: typecheck, lint, 858 unit tests, production build, and 182 e2e tests on three consecutive full runs.

## Next
- Phase 8 real adapters: drop exported captures in `captures/` (git-ignored), run `pnpm captures:summarize`, share `captures/SUMMARY.md`. Files that fail the redaction re-scan are listed and never summarized.
- Phase 11 stays PARTIAL until the manual real-Chrome checks in PROGRESS.md are done.
- Watch: `permission.spec.ts` "clicking Allow" failed once in a full run. Cause not reproduced; the popup run-lookup race (fixed, own test) is the best explanation; the test prints the run record if it recurs.
