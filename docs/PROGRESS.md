# Progress

Status of what is verified (by a passing automated test or an executed command) versus planned. Updated at each phase commit.

## Implemented (verified)
- Phase 0: repo audit (empty), docs, git (repo-local identity, commit-msg hook), tooling, lint/typecheck/test/build scripts.
- Phase 1: MV3 manifest, React popup, service worker, on-demand content script, Zod-validated messages (both directions), run state machine with all SPEC 11.8 states, per-tab duplicate-run guard, Stop, persisted run state, rehydration after service-worker termination.
  - Unit: `tests/unit/state-machine.test.ts`, `messages.test.ts`, `run-manager.test.ts`.
  - E2E: `tests/e2e/foundation.spec.ts` (extension loads, Quick Apply inspects a synthetic form, manifest permissions, single-file bundles, duplicate guard, invalid/foreign messages rejected, SW termination + resume).

- Phase 2: Zod UserProfile schemas with provenance, options page CRUD for all sections, JSON import/export with visible validation errors, persistence.
  - Unit: `tests/unit/profile.test.ts`.
  - E2E: `tests/e2e/profile.spec.ts` (full CRUD, restart persistence with a persistent context, autofill reads the saved profile, visible validation errors, import/export).
- Phase 3: deterministic autofill (observer, label resolution, alias dictionary, mapper, constrained executor, native-setter filling, verification, honest completion report). No AI, no network.
  - Unit: `tests/unit/autofill.test.ts` (label priority, aliases, mapping, executor validation, React-tracker regression, verification, report).
  - E2E: `tests/e2e/autofill.spec.ts` against 7 synthetic portals (basic, unusual labels, duplicate labels, React-controlled, required/optional, sensitive eligibility, adversarial text) incl. no-network, submit-never-clicked, idempotency.
- Phase 4: provider layer (Gemini + Groq over fetch, structured output, tolerant JSON, error classes, retry, rate-limit/quota fallback, run budget), keys/settings/usage/cache storage, candidate gating, prompt building with delimited untrusted data, per-item validator, AI-mapped plans through the same executor/verifier, AI options panel (masked keys, test connection, order, clear cache), popup AI status and AI-mapped count, state machine PLANNING.
  - Unit: `ai-providers.test.ts`, `ai-classify.test.ts`.
  - E2E (HTTP mocked via context.route): `ai.spec.ts` (acceptance on unfamiliar-labels-v2, injection, sensitive, cache, fallback, both-fail, no-key, AI-off zero network, SW killed mid-AI-call, options panel, key isolation, bundle has no mock/keys).
  - Portals added: unfamiliar-labels-v2, missing-info, same-label-sections, custom-dropdowns, autocomplete, dynamic-conditional.
- Phase 5: JobContext schema, deterministic extraction (JSON-LD, metadata, headings, scored main content, noise exclusion, visible-text only), section/skill/education/experience/eligibility extraction, transparent profile relevance ranking, per-URL job cache, optional AI enrichment (off by default, grounded), popup shows real company/role/match or "Unknown".
  - Unit: `job.test.ts` (5 fixture pages + edge cases), `job-service.test.ts`.
  - E2E: `job.spec.ts` (every job page: popup company/role, description matches, decoys absent; run records job; cache hit; Unknown on non-job page; adversarial posting).
  - Portals added: `jobs/` (jsonld, no-jsonld, noisy, adversarial-jd, tabs-accordion, not-a-job).

## Partial
- Custom dropdowns / autocomplete: observed (inputs) or not observed (div/button comboboxes) but never filled; implemented in Phase 4b.
- Job extraction on single-page apps depends on content being rendered when the popup opens or Quick Apply is clicked; there is no re-extraction after later DOM changes (the cache lasts 6 h per URL).
- Dynamic forms: single observation pass; fields revealed by our own fills are not handled until Phase 9.

## Not started
- Phases 4-11 (AI field understanding, job intelligence, answer generation, resume tailoring, adapters, multi-step/recovery, companion, hardening).
- SPEC 25.2 synthetic forms not built this session (11 of 18; the 7 built are in `tests/synthetic-portals/`): custom dropdowns, autocomplete, dynamic conditional fields, multi-step application, validation errors, resume upload, cross-origin iframe, missing personal information, field disabled during execution, DOM changes after every step, same label in several sections (the "duplicate labels" portal covers part of this).

## Known limitations
- Cross-origin iframes, closed shadow roots and custom (non-native) dropdowns/autocompletes are not handled yet.
- No icons in the manifest yet.
- Company and role in the popup are always "Unknown" until Phase 5.

## Failed tests
- (none)

## Needs user config (Phase 4)
- Verify the default model IDs (Gemini `gemini-3.5-flash-lite`, Groq `openai/gpt-oss-20b`) with Test connection; override from settings if needed.
- API keys for the live suite (`.env`, see `.env.example`) if you want `pnpm test:live` to run. No live calls have been made.

## Needs user config
- Nothing for Phases 0-3. API keys (Gemini/Groq) and a real profile JSON are needed from Phase 4 on.
