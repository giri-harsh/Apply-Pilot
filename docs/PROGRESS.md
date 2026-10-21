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

## Partial
- (none yet)

## Not started
- Phases 4-11 (AI field understanding, job intelligence, answer generation, resume tailoring, adapters, multi-step/recovery, companion, hardening).
- SPEC 25.2 synthetic forms not built this session (11 of 18): custom dropdowns, autocomplete, dynamic conditional fields, multi-step application, validation errors, resume upload, cross-origin iframe, missing personal information, field disabled during execution, DOM changes after every step, same label in several sections (the "duplicate labels" portal covers part of this).

## Known limitations
- Cross-origin iframes, closed shadow roots and custom (non-native) dropdowns/autocompletes are not handled yet.
- No icons in the manifest yet.
- Company and role in the popup are always "Unknown" until Phase 5.

## Failed tests
- (none)

## Needs user config
- Nothing for Phases 0-3. API keys (Gemini/Groq) and a real profile JSON are needed from Phase 4 on.
