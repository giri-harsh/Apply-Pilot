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
- Phase 4b: custom dropdown and autocomplete interaction (open, read real options, exact label match, select, verify the displayed value, detect and undo typed-but-not-selected), new validated actions, submit-control click guard.
  - Unit: `widgets.test.ts`. E2E: `widgets.spec.ts` (custom-dropdowns and autocomplete portals, no-match and prefix-only cases).
- Phase 6: grounded AI answers for open-ended questions (SPEC 14): deterministic question classification and hard partition (generate vs unknown personal fact / sensitive demographic / legal declaration / eligibility / binding agreement / injected instruction), evidence retrieval (relevant slices only, no contact details), one batched schema-validated request, deterministic grounding validator (figures, technologies, organisations, employment-from-project, production claims, evidence ids, links/contact/instructions, the model's own claims), one regeneration listing the exact violations, length detection (maxlength, "max N words", counters) with one shorten request and never truncating, insertion through the existing executor and verifier, report/popup "AI-written, review" with evidence, answer memory (explicit save, scoped by question signature and job, switchable off, listable/deletable), answer cache.
  - Unit: `answers.test.ts` (classification per category, limits, numbers, evidence, each grounding rule with adversarial fixtures, generation flow, memory, partition at AiService level).
  - E2E (HTTP mocked): `answers.spec.ts` (15 tests: grounded insertion with counters, fabricated metric / tool rejected, employment-from-project and production claims rejected, uncited evidence rejected, word/char limits, unknown fact, mixed sensitive, injected question, AI off, cache, memory scoping).
  - Portals added: `open-ended`, `unknown-fact`, `mixed-questions`, `injected-question`.
  - Found and fixed by these tests: a hostile label was still reaching the Phase 4 field classifier (now never sent); a production claim about one project passed by citing a different deployed project (now each named project must be deployed); the generic phrase "data pipelines" counted as the ETL skill.
  - Live smoke generation was NOT run: the 10-call live budget was spent in Step 0 (see below).

## Live verification (Step 0, 2026-10-21, 10 real calls of 10 allowed)
- Groq `openai/gpt-oss-20b` (json_schema, best effort): classification request PASSED through the real provider code. Latency and token counts were not captured on that pass (the live suite did not print them yet); not re-run to stay within budget.
- Gemini: the models endpoint lists `gemini-3.5-flash-lite`. A request using `responseSchema` returned HTTP 400 ("Request contains an invalid argument", no field named). With the schema moved into the prompt (`geminiSchemaMode: "prompt_only"`) the request was accepted but timed out at 20 s. `gemini-2.5-flash-lite` is listed but returns HTTP 404 for this key. Result: Gemini is NOT verified; defaults are Groq first, Gemini `gemini-3.5-flash-lite` / `prompt_only` / 45 s timeout.
- Calls: 2 (first `pnpm test:live`) + 1 (list models) + 1 (Gemini live) + 1 (Gemini live + debug) ... total 10; no key was ever printed or logged.

## Partial
- Custom widgets: only ARIA-annotated comboboxes/listboxes (`role=combobox`, `aria-haspopup=listbox`, `role=option`) are recognised; un-annotated widgets are not seen. Virtualised/lazy-scrolling option lists are not scrolled.
- Job extraction on single-page apps depends on content being rendered when the popup opens or Quick Apply is clicked; there is no re-extraction after later DOM changes (the cache lasts 6 h per URL).
- Dynamic forms: single observation pass; fields revealed by our own fills are not handled until Phase 9.

## Not started
- Phases 4-11 (AI field understanding, job intelligence, answer generation, resume tailoring, adapters, multi-step/recovery, companion, hardening).
- SPEC 25.2 synthetic forms still missing: resume upload (11), cross-origin iframe (12), multi-step application (8), validation-errors form (9), field disabled during execution (16), DOM changes after every step (17). Built: 1-7, 10, 13-15, 18 plus unfamiliar-labels-v2 and the `jobs/` pages (see `tests/synthetic-portals/`).

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
