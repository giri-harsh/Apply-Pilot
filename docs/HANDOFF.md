# Handoff

Branch `queue-wip` holds Q1-Q4 and all fixes, committed. `main` holds M1-M4. The queue is NOT merged yet.

## Verified on the final tree
typecheck, lint, 826 unit tests, production build: all green. Full e2e (176 tests): runs 1 and 3 green earlier; two separate runs failed once each on test-side flakes that were then fixed (favicon resource count in autofill.spec; the mapping-cache test now isolates itself from learned strategies). A clean 3x consecutive e2e run on the final tree was STOPPED by the user (the PC was overheating), so it has not been done.

## Exact next step
1. When the machine is free: `pnpm test:e2e` three times in a row (about 7 minutes each; each launches many Chromium windows).
2. If all three are green: `git switch main; git merge --ff-only queue-wip; git branch -d queue-wip`.
3. `pnpm metrics` was already re-run on commit f130334 (47/47 and 37/37).

## Rules
Write/Edit only for source; no subagents; live AI budget 0; attribution-free commits; never push.
