# Handoff

State: branch `queue-wip` holds Q1-Q4 (committed); `main` holds M1-M4. Final step is the full verification (unit, typecheck, lint, build, 3x e2e), then fast-forward main and delete the branch.

## Done
- M1-M4 on main: phase-7b, phase-8-prep (capture), phase-11a (hardening).
- Q1 phase-8a adapters (synthetic FakeATS), Q2 phase-8b learned strategies, Q3 phase-11b history and usage, Q4 phase-11c indicator.

## Next
- Phase 8 real adapters need the user's real-portal captures (Popup > Capture this page; Settings > Diagnostics > export). No code is waiting on anything else.
- Phase 11 stays PARTIAL until the manual real-Chrome checks in PROGRESS.md are done.

## Rules
Write/Edit only for source; no subagents; targeted tests; live AI budget 0; attribution-free commits; never push.
