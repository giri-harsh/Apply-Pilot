# Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit | `pnpm test` | pure logic and jsdom: mapper, validators, grounding, layout (real PDFs), import, state machine, run manager with a stateful fake page, failure policy, permissions snapshot, redaction |
| E2E | `pnpm test:e2e` | real Chromium with the built extension against synthetic portals served locally on dynamic ports; AI HTTP is mocked with `context.route` (no real calls) |
| Accessibility | in e2e (`a11y.spec.ts`) | axe on the popup and every options tab; serious/critical fail, others are written to `test-results/a11y-minor.json` |
| Privacy | in e2e (`privacy.spec.ts`) | scans all storage, diagnostics, exports, console output and AI request bodies for profile strings and API keys |
| Metrics | `pnpm metrics` | SPEC 25.5 numbers on the deterministic suite, written to `docs/METRICS.md` |
| Live | `pnpm test:live -- <name>` | opt-in real API checks, hard-capped by `LIVE_MAX_CALLS` (default 2) |

Rules the suites enforce: no skipped or weakened tests; a failing test is fixed in the code, or (if the test is wrong) corrected with the reason in DECISIONS.md. Wait on run state, never on sleeps. Run the e2e suite three times in a row before a release commit.

Synthetic portals live in `tests/synthetic-portals/` (static HTML plus small scripts, instrumented by `_common.js` so tests can prove what was NOT clicked or submitted).

Real-portal coverage is measured separately and is not claimed here: see the manual checks in `docs/PROGRESS.md`.
