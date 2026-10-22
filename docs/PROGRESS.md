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
  - The Phase 6 live smoke (real pipeline, Groq, fixture profile) was run in the follow-up session; see Live verification.
- Phase 9: agent recovery and multi-step forms (SPEC 11, 15, 17, 21), built before Phases 7 and 8.
  - Multi-pass, multi-step harness (`src/background/run-manager.ts`): per step, up to 4 observe -> map -> (AI) -> plan -> fill -> verify passes, so fields revealed by earlier fills (country -> state) are found and filled; each pass waits for the page to settle (debounced MutationObserver that exists only while waiting, so the executor's own writes can never re-enter observation). After the passes: form-level check (a required field still unresolved stops the run before any navigation), control classification, one guarded click on the single safe next control, then a checkpoint.
  - Final-control guard (`src/content/navigation/classify.ts`): each control is `next | final | back | other`. Final wins on submit/apply/send/finish/pay/checkout wording, on a submit button of a form that posts (action, POST or formaction), on a review summary, on the last step of a step indicator, and for any unrecognised button. Only exactly one `next` control with no explicit final control beside it is ever clicked, and the content script re-classifies at click time. A trap portal (a "Continue" that really submits) and the review/final steps assert that the click handlers never fired.
  - Bounded recovery: a field that fails execution or verification is retried with a fresh observation; the third try uses the keyboard fallback (real key events, for pages that only commit on keyup); after that it is reported as failed ("Recovery exhausted"). Counts as actions/retries/passes/transitions are persisted on the run record, so limits hold across a service-worker restart. Page changes under a plan (`replan`) are not counted as failures. A field disabled at observation time is looked at again up to twice, 1 s apart.
  - Hard limits (`src/background/limits.ts`): 180 s run, 200 actions, 12 retries, 4 passes per step, 8 step transitions, 20 s per page request. Reaching one ends the run BLOCKED with the limit named and a real report of what was done.
  - Blockers: CAPTCHA (widget, provider frame, wording), MFA/verification-code fields and login walls stop the run BLOCKED before anything is filled. Unreadable (cross-origin) frames are reported and end the run PARTIALLY_COMPLETED; nothing inside them is touched.
  - Navigation: a click that unloads the page loses the message channel; the service worker waits for that tab's load to complete (`chrome.tabs.onUpdated`, this tab only, cancelled by Stop), re-injects the content script, and re-observes. If injection is refused the run ends BLOCKED "Permission lost after navigation".
  - Stop: one cancellable scheduler per run; Stop rejects every pending sleep, tells the page to cancel (executor, waits and keyboard typing all check the flag), and `pendingTimers(runId)` is asserted to be 0.
  - Report and popup: per-step results (`report.steps`), notes, and a popup "Steps" list with per-step verified/failed counts, outcome, which control moved on, and live action/retry/pass/step counters.
  - Found and fixed by the tests: a value the page flagged as invalid counted as "already correct" on the next pass (now `FormField.invalid`, and it goes back through recovery); the AI was asked again about the same unresolved field on every pass (now each field is put to the AI at most once per step; accepted mappings are remembered for recovery); a later "still unresolved" overwrote an earlier specific reason; "Proceed to payment" matched the next-step wording (payment/checkout are now final words).
  - Unit: `run-manager.test.ts` (stateful fake page: reveal after fill, step change after navigate, disabled field, validation that clears, all limits, blockers, frames, navigation, rehydration, Stop and timers), `navigation.test.ts` (classifier, blockers, settle wait non-re-entrancy, scheduler), `state-machine.test.ts`.
  - E2E: `phase9.spec.ts` (16 tests) on the new portals `wizard-basic`, `wizard-student`, `wizard-trap`, `wizard-validation`, `wizard-disabled`, `wizard-churn`, `wizard-captcha`, `wizard-endless-steps`, `wizard-endless-fields`, `iframe-host` (+ `frame-content` served from a second origin), `multipage-1/2` (real navigation).

## Live verification
Session 3, Step 0 (2026-10-21, 10 real calls of 10 allowed):
- Groq `openai/gpt-oss-20b` (json_schema): classification request passed through the real provider code.
- Gemini `gemini-3.5-flash-lite`: `responseSchema` returned HTTP 400 ("Request contains an invalid argument", no field named); schema-in-prompt timed out at 20 s; `gemini-2.5-flash-lite` returns 404 for this key.

Follow-up session (5 real calls of 6 allowed; no key, header or body was printed or stored):
- Groq classification: PASS, 481 ms, 1061 input / 168 output tokens.
- Gemini `gemini-3.5-flash-lite`, `prompt_only` schema mode with `thinkingConfig.thinkingLevel: "minimal"` (now the default): PASS, 1934 ms, 1017 input / 45 output tokens. The earlier 20 s timeout was model thinking time. Structured modes (`response_json_schema`, `response_schema`) still return HTTP 400 with no usable detail, so Gemini stays in `prompt_only` (output is validated by Zod either way).
- Phase 6 smoke through the real pipeline (Groq, fictional fixture profile, budget 2): 1 request, 0 regenerations, 0 shortenings, no error. The first answer ("why join us") was accepted by the grounding validator with evidence ids for two projects, the experience and the skills. The second field's result line was lost: the live results file sat in `test-results/`, which Playwright empties on each run (fixed: Playwright now writes to `test-results/playwright`). Not re-run, to stay within the call budget.
- Call count for that session: 5 real calls of the 6 allowed (Gemini diagnosis and verification, one Groq re-run, one Phase 6 smoke request).

## Partial
- Custom widgets: only ARIA-annotated comboboxes/listboxes (`role=combobox`, `aria-haspopup=listbox`, `role=option`) are recognised; un-annotated widgets are not seen. Virtualised/lazy-scrolling option lists are not scrolled.
- Job extraction on single-page apps depends on content being rendered when the popup opens or Quick Apply is clicked; there is no re-extraction after later DOM changes (the cache lasts 6 h per URL).
- Multi-step: a field that fails verification after AI writing is not re-generated (the answer is reported failed, the AI is not asked twice); recovery re-uses deterministic and remembered AI field mappings only.
- Navigation across origins under production `activeTab`: the grant ends when the tab moves to another origin, so the run ends BLOCKED "Permission lost after navigation". Same-origin multi-page forms continue (see NEEDS FROM USER in the Phase 9 report).
- Disabled fields are re-checked twice, 1 s apart; a field enabled later than that is reported, not filled.

## Not started
- Phases 7, 8, 10, 11 (resume tailoring, adapters, companion, hardening).
- SPEC 25.2 synthetic forms still missing: resume upload (11). Built: 1-10, 12-18 plus unfamiliar-labels-v2 and the `jobs/` pages (see `tests/synthetic-portals/`).

## Known limitations
- Closed shadow roots and cross-origin iframe contents are not handled (iframes are reported, never entered).
- No icons in the manifest yet.
- Company and role in the popup are always "Unknown" until Phase 5.

## Failed tests
- (none). Last verification: `pnpm test` 426 passed (12 files); `pnpm test:e2e` 83 passed on three consecutive full runs; typecheck and lint clean.

## Needs user config (Phase 4)
- Verify the default model IDs (Gemini `gemini-3.5-flash-lite`, Groq `openai/gpt-oss-20b`) with Test connection; override from settings if needed.
- API keys for the live suite (`.env`, see `.env.example`) if you want `pnpm test:live` to run. No live calls have been made.

## Needs user config
- Nothing for Phases 0-3. API keys (Gemini/Groq) and a real profile JSON are needed from Phase 4 on.
