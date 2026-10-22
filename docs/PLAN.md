# Plan

## Architecture summary
Chrome MV3 extension, TypeScript, React popup/options, single package. Modules:

- `src/shared/` schemas and pure logic used by every context: Zod schemas (profile, form fields, actions, run, messages), run state machine, report builder, storage helpers.
- `src/background/` service worker. `RunManager` owns the run lifecycle (dependency-injected so it is unit tested), persists every transition to `chrome.storage.local`, rehydrates on wake, injects the content script, and talks to it through validated messages.
- `src/content/` single injected bundle, split into: `observer/` (DOM, label resolution, field discovery), `mapping/` (alias dictionary, classification, profile mapping), `actions/` (constrained executor, native value setter), `verification/` (re-read + validation checks). `index.ts` only routes messages.
- `src/popup/`, `src/options/` React UIs. The popup shows state derived from the persisted run; options is the profile vault (CRUD, import/export).
- `tests/unit` Vitest (jsdom). `tests/e2e` Playwright against `tests/synthetic-portals` served by a local static server on a dynamic port.

Flow of a run: `IDLE -> INITIALIZING -> OBSERVING -> DISCOVERING_FORM -> MAPPING_FIELDS -> FILLING -> VERIFYING -> READY_FOR_REVIEW`, with `BLOCKED / CANCELLED / FAILED` reachable from working states. Rules only; no AI, no network.

Boundaries: page content is untrusted data; the executor only accepts the `AgentAction` union, validates every action independently, and never evaluates code. Submit/final controls are never clicked (there is no click action other than radio/checkbox inputs).

## Stack
TypeScript, React 19, Vite 8 (multi-build), Zod 3, Vitest 5 + jsdom, Playwright (Chromium, `--load-extension`), ESLint.

## Task breakdown
- Phase 0: audit, docs, git, tooling.
- Phase 1: manifest, popup, SW, content injection, validated messaging, state machine, persistence + rehydrate, Playwright extension test.
- Phase 2: profile schemas with provenance, options CRUD, import/export, persistence test across browser restart.
- Phase 3: observer, aliases, mapper, executor, verification, report, 7 synthetic portals, no-network assertion.
- Phase 4: AI field classification (Gemini/Groq behind typed provider interface, schema-validated, data-minimised).
- Phase 5: job description extraction + job context schema.
- Phase 6: grounded answer generation, sensitive-question policy.
- Phase 9 (pulled ahead of 7 and 8, session 3): planner loop, bounded recovery, multi-step forms, dynamic DOM observation, final-control classifier, blocker detection. Reason: the single-observation-pass limit blocks real portals.
- Phase 7 (done, session 4, in-extension): resume import, variants, grounded tailoring, deterministic PDF layout with a measured page count, DOCX export, upload integration. The Phase 10 companion was not needed for it and stays deferred.
- Phase 8: portal adapters driven by real testing.
- Phase 10: optional local companion (only if needed).
- Phase 11: hardening, privacy/permission review, docs.
- Phase 10 (local companion): SKIPPED. Phase 7 (resume import, layout, PDF validation, upload) runs entirely in the extension with a deterministic layout engine and an offscreen document, so no Phase 7 requirement needs a companion. Revisit only if a measured need appears (for example persistent SQLite history or rendering fidelity beyond the built-in engine).
