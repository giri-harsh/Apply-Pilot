# Architecture

```
popup / options (React, extension pages)
   |  validated messages (Zod, both directions)
service worker  ---- RunManager (state machine, limits, recovery, checkpoints)
   |  |  |-- AiService (Gemini / Groq, router, caches, usage log)  <- the only place keys are read
   |  |-- ResumeService (variant, tailoring, upload orchestration)
   |  |-- DiagnosticsService (redacted captures)
   |  `-- JobService (job extraction cache)
   |  chrome.tabs.sendMessage (validated)         chrome.runtime messages
content script (injected on click only)        offscreen document (PDF layout + validation, DOCX)
   observer -> mapper -> executor -> verifier      pdf-lib, fontkit, pdf.js, docx; no keys, no AI
   classify controls, blockers, upload, capture
```

- **No static content script.** `chrome.scripting.executeScript` injects `content.js` after a user click (`activeTab`).
- **Run state machine** (`src/shared/state-machine.ts`): INITIALIZING, OBSERVING, EXTRACTING_JOB, DISCOVERING_FORM, MAPPING_FIELDS, PLANNING, FILLING, VERIFYING, ADVANCING_STEP, then READY_FOR_REVIEW / PARTIALLY_COMPLETED / BLOCKED / CANCELLED / FAILED. Every transition is validated; the record is persisted so a restarted service worker re-observes and continues.
- **One step** = up to `maxPassesPerStep` passes of observe -> map -> (AI) -> plan -> fill -> verify -> settle, then a form-level check, then control classification and at most one guarded click on the single safe "next" control. File inputs are handled once the text fields converge; a verified upload is followed by one more pass.
- **Deterministic first**: aliases and rules place fields; AI only sees unresolved, non-sensitive fields, at most once per step; answers and rewrites are validated item by item against your facts.
- **Storage namespaces** (never one blob): profile, runs, AI settings, API keys, AI usage, mapping cache, answer cache and memory, job cache, resume master / variants / documents / settings (`chrome.storage.local`); resume binaries and portal captures (IndexedDB, extension origin).

## Run limits (SPEC 21.2)
Defaults are conservative and enforced by the harness; reaching one ends the run BLOCKED with the limit named and the real report kept.

| Limit | Default | Where |
|---|---|---|
| `maxDurationMs` | 180000 | `src/background/limits.ts` |
| `maxActions` | 200 | same |
| `maxRetries` | 12 (2 recovery attempts per field) | same |
| `maxPassesPerStep` | 4 | same |
| `maxStepTransitions` | 8 | same |
| `maxFields` | 300 | same |
| `maxRequestsPerRun` (AI) | 6 | `src/ai/config.ts` |
| `maxResponseChars` (AI) | 60000 | same |
| `maxDescriptionChars` (job text sent to AI enrichment) | 12000 | same |
| per-request page timeout | 20000 ms | `stepTimeoutMs` |

## Failure handling (SPEC 21.3)
`src/shared/failure-policy.ts` maps every AI error kind, API error code, run limit and known message to one of 18 failure kinds, each with a bounded recovery policy; none is "ask the AI again". A test fails if a new code has no policy.

## Resume pipeline
Master (facts with ids and provenance) -> variant (rules over fact ids) -> rank -> one batched AI reword (optional) -> per-bullet grounding (Phase 6 validator + role/outcome/name/keyword/length rules) -> fallback to master wording -> layout in the offscreen document (measured page count, fit loop within readability floors) -> validation (reload, text extraction) -> stored with its report -> uploaded through chunked messages to the classified resume field only.

## Where the code is
`src/shared` contracts and state machine; `src/background` service worker services; `src/content` page-side code; `src/ai`, `src/answers`, `src/job`, `src/resume`, `src/diagnostics` domain modules; `src/popup`, `src/options` UI; `src/offscreen` document builder; `tests/unit`, `tests/e2e`, `tests/synthetic-portals`, `tests/live`, `tests/metrics`.
