# Phase 7 Verifier Report

Branch `phase-7-wip` (head 1c24a9e) vs `main`. Read-only audit: no source, test or config file was changed; this file is the only file created. Ad-hoc probes lived only in the scratchpad directory (`...\scratchpad\adhoc`), never in the repo.

## 1. Command results

| Command | Result |
|---|---|
| `pnpm.cmd typecheck` | `$ tsc --noEmit`, no diagnostics |
| `pnpm.cmd lint` | `$ eslint .`, no diagnostics |
| `pnpm.cmd test` | `Test Files  28 passed (28)` / `Tests  705 passed (705)` / Duration 13.68s |
| `pnpm.cmd build` | `Built extension -> dist`. Warnings only: Vite "chunks larger than 500 kB", and `new URL("../../../assets/fonts/", import.meta.url) doesn't exist at build time` (the node-only font loader path, never executed in the extension) |
| `pnpm.cmd test:e2e` (run once) | `122 passed (4.7m)`, no failures, no retries or flakes reported |

Caveat: while the e2e run was in progress I started one tiny, separate vitest process (the grounding probe in finding 4). It did not cause any e2e failure, but the run was not strictly "alone".
`git status` after all runs: clean.

## 2. Findings

### 1. [High] The run's resume status and popup line claim "Tailored resume uploaded" regardless of what the upload did
- `src/background/resume-service.ts:239` copies `prepared.status` into `run.resume.status` BEFORE any transfer. `doPrepare` returns status `"tailored"` for every freshly built file (line 190), whatever the validation or upload outcome. `src/popup/main.tsx` maps `tailored` to the literal text "Tailored resume uploaded" and appends filename and page count.
- Consequences: if the transfer fails, the page reports `upload_unrecognized` or an error, the field is `skipped` at commit, or the file is `ambiguous`/refused by `accept`, the popup headline still says "Tailored resume uploaded: X.pdf (N pages)". Only the per-field report row (outcome `failed`/`unresolved`) tells the truth. The same applies to `reused` ("Saved resume reused") and to overflow/failed-validation documents (finding 2).
- The e2e test asserts exactly this value for the overflow case (`tests/e2e/resume.spec.ts:190`, `expect(record.resume.status).toBe("tailored")`), so the behaviour is locked in by a test.
- Fix needed: separate "prepared" from "uploaded" (for example `status` plus an `uploadOutcome`), set "uploaded" only after at least one `uploaded_verified`, and make the popup text depend on it.

### 2. [Medium] A resume whose validation FAILED, or that overflowed the page limit, is still uploaded to the application
- `resume-service.ts:165-190`: `validationStatus` becomes `"failed"` (e.g. name/email/phone/section missing in the rendered text) or `"overflow"`, a `warnings` entry is added, and the PDF is nevertheless returned as `pdf` and uploaded. `chooseFileForField` (`src/content/upload/choose.ts:38`) only adds a warning when `pageValidated` is false, and `src/offscreen/main.ts:50` sets `pageValidated: validation.pageCount > 0`, i.e. true even when `validation.ok` is false or the page count exceeds the limit.
- Concrete way to get there: a contact name with glyphs missing from Source Sans 3 (any Devanagari/CJK/emoji name) is drawn as "?" (`src/resume/layout/text.ts` `sanitize`), the validator then reports `missingContact: ["name"]` (`validate.ts:66`), and the file with "?" instead of the applicant's name still goes to the employer.
- `FileRef.pageValidated=true` on a failed or over-limit PDF is itself misleading.
- Fix needed: refuse to upload when `validation.ok` is false (fall back to the last validated document or leave it to the user), and compute `pageValidated = validation.ok && pageCount <= limit`. Overflow could stay user-approvable but must not be silent.

### 3. [Medium] No re-observation after the upload; PROGRESS claims the opposite
- `src/background/run-manager.ts:608-633`: the upload phase runs after the fill/verify passes, and then goes straight to form-level verification (`acc.counts()`) and next-step classification. Nothing re-observes or re-maps after the upload. The comment in `tests/e2e/upload.spec.ts:307` says "The LEAD re-observes after the upload", but no such code exists in the run manager.
- `docs/PROGRESS.md` states "After an upload the page is re-observed and the mapper never overwrites values the site filled in". That is only demonstrated by a test that calls OBSERVE/MAP manually; the real run does not do it.
- Impact: a portal that auto-parses the resume and overwrites or clears fields already filled and "verified" earlier is not noticed. The report keeps the pre-upload `filled_verified` rows, and the run may click Next on a stale picture.
- Fix needed: after any `filled_verified` upload, run another observe/map/verify pass (bounded), or correct the docs.

### 4. [Medium] The grounding validator lets scope/seniority inflation, vague outcomes and out-of-dictionary tools through (reproduced)
- Probe (scratchpad vitest, `checkText` with the real adapter, source bullet "Built a churn prediction model using Python for the retention team", entry tech Python, no model claims). Rewrites returning NO violations:
  - "Led the retention team and built a churn prediction model using Python"
  - "Architected and owned a churn prediction model using Python, serving the whole company"
  - "Managed a churn prediction model built using Python for the retention team"
  - "... using Python, improving retention substantially" (invented outcome, no number)
  - "... using Python and Kubeflow ..." (a fabricated tool not in the `src/job/skills.ts` dictionary).
  Rewrites that were correctly rejected: adding Snowflake, Terraform or Docker (dictionary skills).
- Cause: `src/answers/grounding.ts` detects tools only through the skills dictionary (`extractSkills`), organisations through capitalisation heuristics, numbers numerically; it has no check for role/responsibility verbs (led, owned, architected, managed), qualitative outcomes, or unknown tools. The extra rules in `src/resume/tailor/rules.ts` only cover job keywords and certification words. The model-supplied `claims[]` are the only other check, and they are optional.
- The shorten and cover-letter paths use the same `checkText`, so they share the gap.
- Fix needed: an allow-list of action verbs per source bullet (or a verb-strength/seniority lexicon that rejects upgrades), a check that every capitalised or unknown token not in the source is rejected, and a stricter token-subset rule (rewrite words must come from the source or a small function-word list).

### 5. [Medium] Service worker death or a continuation run repeats tailoring and leaves orphan binaries
- `ResumeService.prepared` (`resume-service.ts:67,83-91`) is an in-memory map keyed by `runId`. After a worker restart (`RunManager.rehydrate`, `run-manager.ts:266`) the same run is re-driven and `prepare()` runs again: a second full tailoring (new AI requests against the run budget, new `ResumeDocument`, new PDF and DOCX in IndexedDB). `resumeAfterGrant` creates a new `runId`, so the same happens there.
- Orphans: binaries are written inside the offscreen document (`offscreen/main.ts:53,66`) before the worker saves the document. If the worker dies mid-build, if `assertMasterUnchanged` throws afterwards (`resume-service.ts:161-163`, for example the user edits the master meanwhile), if DOCX export throws after the PDF was stored, or if `putDocument` fails, the binaries remain with no `ResumeDocument`. The options UI lists only documents, so these files are invisible and only "Delete all resume data" removes them. `listBinaries()` is used only for filename de-duplication.
- Evidence of a related inconsistency: `lastValidatedFor` checks only the PDF binary exists, then returns `docx` too; a missing DOCX binary only surfaces later as "saved resume file is missing" at upload.
- Fix needed: persist the prepared document id on the run record and reuse it after restart; make the offscreen document return bytes (or write under a pending key) and have one owner write binary plus document atomically, with cleanup on failure; add a binary garbage collection.

### 6. [Low-Medium] The content script's `uploaded` set is never reset between runs
- `src/content/upload/index.ts:30` holds field fingerprints for the whole page session; `resetUploadState` is only called from tests. `src/content/index.ts` guards re-injection with `__applypilotLoaded`, so the same module instance (and set) survives every later Quick Apply on that page load.
- Effect: a second Quick Apply on the same page after the user removed or changed the file hits `skip("already uploaded this run")` (line 107), so the required resume field is reported unresolved and nothing is attached. The run-level `resume.uploaded` is per run, the content-script one is per page, and the two disagree.
- The e2e test "Quick Apply is idempotent" covers text fields, not upload.
- Fix needed: scope the set to the run (send a run id on `UPLOAD_BEGIN`, or clear on OBSERVE of a new run).

### 7. [Low-Medium] A sole-evidence or protected line can still lose its evidence through shortening
- `src/resume/layout/fit.ts:163-175` builds the shorten candidate list from every bullet/paragraph block, without filtering `isHardLine` (protected or `onlyEvidenceForRequiredQualification`). `makeShorten` (`shorten.ts`) checks grounding and length but never that required terms remain. So the one line flagged as the sole evidence of a required qualification can be rewritten shorter without the keyword; the line stays "protected" but no longer evidences anything. Not reproduced at runtime (code reading only).
- Fix needed: exclude hard lines from shortening or require the term list of the original line to survive.

### 8. [Low-Medium] Privacy controls (SPEC 19.4) are only partly present
- Master resume: Options shows only counts (`ResumeImportPanel.tsx:208-221`). After Confirm there is no way to view the full master or edit a fact (editing exists only inside the import review). There is no export of master, variants or documents' structured content (the "Import / Export" tab exports the profile only; per-document PDF/DOCX download exists).
- Delete: master, variant, per-document (also removes its binaries), and "Delete all resume data" (`clearAll` removes the four kv namespaces and clears the IndexedDB `files` store, `storage/index.ts:190-199`) are present. "Delete master" keeps variants and documents (stated in the confirm text).
- Disable tailoring: present (`tailoring-toggle`).
- Fix needed: master viewer/editor and a JSON export of master and variants.

### 9. [Low] Dead or misleading settings
- "Write a cover letter when a portal requires one" (`ResumeSettingsPanel.tsx:81`) stores `coverLetterEnabled`, but nothing reads it and `generateCoverLetter` is never called from the service worker (grep: only the export in `tailor/index.ts`). The UI promises behaviour that does not exist (PROGRESS admits the harness does not upload a letter, the checkbox text does not).
- `settings.maxUploadBytes` (default 5 MB) and `settings.autoSelectVariant` are in the schema and never enforced. Real caps are `UPLOAD_MAX_CHUNKS` x 192 KiB and the 20 MB `UPLOAD_BEGIN` bound.

### 10. [Low] No retention cap on generated documents
- `putDocument` (`storage/index.ts:177-183`) appends forever to one `chrome.storage.local` array (each with `job.extract` up to 6000 chars plus the full tailored text and report). The extension does not request `unlimitedStorage`, so roughly several hundred applications could hit the 10 MB quota. A failing `kv.set` there also breaks run persistence and API-key writes, which share the same storage area. Binaries pile up in IndexedDB too.
- Fix needed: cap or prune documents (and their binaries), or move documents to IndexedDB.

### 11. [Low] The service worker does not independently re-check what the offscreen document returns
- `resume-service.ts:170-189` stores `built.layout.finalResume` and uses `built.pdf` as returned. There is no check that every final line is either the master's text for its `sourceFactIds` or a text the worker's own grounding run accepted. Today the only producers are trusted extension code, so this is defence in depth, but it is exactly the "text the validator never saw" scenario if the offscreen path were ever compromised or a layout bug introduced a rewrite.
- Related: `src/offscreen/main.ts:74-77` checks only `sender.id !== chrome.runtime.id`, whereas the service worker also requires `sender.url` to be an extension page. A content script of this extension has the same `sender.id`, so a compromised content script could post a `BUILD` request (it would only write a PDF into IndexedDB, no upload without a saved document). Make the offscreen listener reject senders that are not extension pages.

### 12. [Low] Import resource limits are thin
- `src/resume/import/index.ts` caps only the compressed byte size (10 MB). PDF extraction loops over every page with no page, time or text-length cap (`extract.ts` `extractPdf`); a DOCX is passed whole to mammoth (zip-bomb expansion is not bounded). The page is the user's own options page and the user chooses the file, so impact is a hung tab. Good points: `isEvalSupported:false`, `useWorkerFetch:false`, `disableFontFace`, worker served from the extension, mammoth HTML parsed with `DOMParser` (inert), no network code.
- Fix needed: page cap (e.g. 30), per-page and total time limit, and an uncompressed-size cap for DOCX.

### 13. [Low] "Field already holds a file" counts as a satisfied required field
- `resume-service.ts:225-227` reports `already_correct` for an input that already has a file, whatever that file is. A stale or wrong file (for example from an earlier attempt) therefore clears `requiredUnresolved` and lets the run proceed. The reason text does say it was not replaced; the outcome label does not.

### 14. [Low] Test weakness: the overflow e2e is conditional
- `tests/e2e/resume.spec.ts:178-190`: the assertions about overflow are inside `if (doc.report.layout.pageCount > 1)`, with an `else` that asserts "validated". If `longMaster()` happens to fit on one page the overflow path is not exercised at all. I did not measure which branch runs.

### 15. [Low] Stale documentation
- `docs/PROGRESS.md` still lists "Phases 7, 8, 10, 11" under Not started, "Failed tests: ... `pnpm test` 426 passed, `pnpm test:e2e` 83 passed", "Company and role in the popup are always 'Unknown'", and "SPEC 25.2 ... resume upload (11)" is missing although `upload/` portals exist. Actual: 705 unit and 122 e2e tests.
- PROGRESS states Phase 7 "Needs user verification" only for the permission bubble. Also not live-verified (the doc does say so for shorten/cover/regen).

### 16. [Low, hardening] Link URLs are schema-free strings
- `src/resume/schema.ts:44,62,128`: `url: text(500)` has no scheme check, and `render.ts addLink` writes it into a PDF `/URI` action. The importer only extracts http(s)/known-domain links (`import/build.ts:144,340`), so this is not reachable today, but anything that bypasses the importer (variants, future editing) would not be stopped from putting a `javascript:` or `file:` URL into the PDF. Restrict to `https?:` in the schema.

## 3. Verified OK (checklist a-p)

- a. Grounding path coverage: every rewrite goes through `checkText` (`rewrite.ts:52`), the regeneration reuses it (`rewrite.ts:91-107`), a failing bullet falls back to master text; the fit-loop shortening goes through the worker's `makeShorten` -> `checkText` against the MASTER fact text (`shorten.ts:44-48,68`), unknown session or any error returns lines unchanged (`resume-service.ts:72-80`); fit.ts accepts only strictly shorter replacements for the requested lineIds (`fit.ts:183`). Cover letter uses the same validator, is not wired to any upload. Every `TailoredLine` needs `sourceFactIds` (schema min 1, DECISIONS). The validator's strength is the problem (finding 4), not its coverage; no path from model text to the PDF that bypasses it was found (finding 11 is defence in depth).
- b. Master is only read: `tailorWithStats` hashes first and re-checks last (`pipeline.ts:34,114`), the service re-reads and re-checks after the build (`resume-service.ts:161-163`); `applyVariant`/`assemble` build new arrays. Master writes are single `kv.set` calls (atomic) and only from the import UI; tailoring failure cannot half-write the master (but see finding 5 for orphan binaries).
- c. Wrong-field upload: classifier requires exactly one clear meaning (`classify.ts`), instruction-like text makes a field ambiguous, "resume + other" or "resume + cover" wording is ambiguous, duplicates must have one clear primary; `choose.ts` never gives a file to ambiguous/other fields or fields that hold a file; the content script re-checks classification, filename role (`kindFromFilename`), `accept` and `hasFile` at commit (`upload/index.ts:100-110`); cover-letter fields get nothing. e2e `upload.spec.ts` covers transcript/portfolio, instruction-like labels, two resume inputs, second commit to same field. Duplicate-in-run: `resume.uploaded` fingerprints are persisted on the run (`run-manager.ts:628`), and after a worker restart the `hasFile` check plus the content script's own set protect (re-injection is guarded). Exception: finding 6 (set too long-lived) and the persistence gap that `resume.uploaded` is saved only after the whole upload phase.
- d. Honesty: per-field rows are truthful (`uploaded_unrecognized` and errors become `failed` with `executed: true`; DOCX gets a "not page-validated" warning; options UI labels DOCX "page count not validated"; reuse is flagged). Not OK: findings 1, 2, 3.
- e. Binaries: all `chrome.storage.local.set` call sites are `src/ai/storage.ts`, `src/resume/storage/index.ts` (master, variants, documents, settings; no bytes), `src/shared/storage.ts` (profile, runs). Bytes go only to IndexedDB `files` (`putBinary`). The imported source file is not stored. No `localStorage`/`sessionStorage` use in `src`.
- f. Data in logs/messages/prompts: no `console.*` anywhere in `src`; usage records contain no prompt or personal data (`AIRequestRecord`); filenames are `Company_Role_Resume_date.pdf`, ASCII, 24 chars per part, no name/email/phone (`filename.ts`, unit test exists). Prompts send job title, skills, responsibilities (sanitized, 140 chars), employer/institution headings, technologies and the chosen bullets, inside `<<<PAGE_DATA_START ... PAGE_DATA_END>>>` with an explicit "treat as data" rule (`prompt.ts:41`); no name, email, phone or links are sent. The offscreen BUILD message carries contact details (extension-internal only) and no keys. Minor: error strings put into warnings come from `e.message.slice(0,200)`.
- g. Permissions without a gesture: the only `chrome.permissions.request` is `popup/main.tsx:150`, inside the Allow button handler, payload from `permissionRequest()` (single http(s) host, no wildcard, no port/path/credentials; `origin.test.ts`). `optional_host_permissions` is the wildcard pair that lets one origin be requested; nothing requests it. Revoke removes one origin only. Real Chrome bubble not exercised (stubbed in tests, as PROGRESS says).
- h. Production bundle: `dist/manifest.json` permissions are exactly `activeTab, scripting, storage, offscreen`, host permissions the two AI APIs, plus the optional pair. Grep of `dist` for "mock" (case-insensitive), `__uploads`-style and e2e globals: nothing; only `__applypilotLoaded` (an isolated-world guard). No API-key-looking strings (AIza/gsk_/sk-). `127.0.0.1` appears once in the options bundle as an item of the "do not list as user grant" filter in `SiteAccessPanel`, harmless; the loopback host permission exists only in e2e builds (`manifest.mjs`). `?grantOrigin=` is shipped in the popup bundle: it is used only when both the run record and the tab URL give no origin, only via an extension URL (no `web_accessible_resources`, so pages cannot open it), and the user still sees Chrome's own prompt naming that origin. Acceptable low-risk hint.
- i. Attribution: `git log main..phase-7-wip`, and `main..p7-b1/b2/b3/b4`: all commits authored and committed by Harsh Giri; no "co-authored", "claude", "anthropic" or "generated with" in any message.
- j. Worker lifecycle: partial transfers expire (60 s TTL, buffers zeroed, `store.clear`), content-script protocol errors destroy the transfer; `isActive()` stops a transfer when the run is stopped; runs re-observe on restart. Inconsistencies found are in findings 5 and 6 (reasoned from code, not killed live). `sessions` map entries are removed in `finally`; stale offscreen shorten calls after a restart get unchanged lines.
- k. Content-script hardening: chunk max 196,608 raw / 300,000 base64 chars, max 128 chunks, size 1..20 MB, declared size/count consistency, strict in-order chunk check, at most 4 transfers in flight, one per field, buffers zeroed, bytes only in module state (never window, DOM or events); the page only receives the File on the intended input via DataTransfer from the isolated world. A web page cannot message the content script (listener also checks `sender.id`). e2e `chunk integrity` tests pass.
- l. Messages: the service worker rejects any sender that is not an extension page (`background/index.ts:208`), so a web page or content script cannot send RESUME_SHORTEN, BUILD or UPLOAD_*; `RESUME_SHORTEN` needs a live random session id. Content-script UPLOAD_* requests must come from the extension. No `externally_connectable`. Offscreen listener weaker: finding 11.
- m. Layout: floors enforced by schema parse (`LayoutConfigSchema` in `layoutPdf`, `clampConfig`); drop rule never touches name/contact/section titles, protected or sole-evidence lines, top education entry or last entry of a section (`fit.ts` `isHardLine`, `dropCandidates`); right-aligned dates only when they fit (`measure.ts:128`); long tokens are broken (`wrapRuns`/`breakToken`); invisible characters removed, missing glyphs become "?" with a warning. Gaps: findings 2 (unsupported glyphs in contact) and 7 (shortening protected lines). Visual quality of PDFs not inspected.
- n. Import: see finding 12 for gaps; no eval, no network, worker from extension files, `DOMParser` is inert, scanned PDFs refuse Confirm, nothing becomes master before Confirm.
- o. See finding 8. "Delete all resume data" does clear IndexedDB binaries (`clearAll` in `storage/index.ts`, plus storage unit tests); per-document delete removes its PDF and DOCX.
- p. Other: findings 9, 10, 13-16.

## 4. Not checked / limits of this audit
- No live AI calls were made (`test:live` not run). The real Chrome permission confirmation, a real service-worker kill during upload/offscreen build, DOCX opened in Word, and the visual quality of generated PDFs were not exercised; related statements are from code reading.
- Finding 7 and the orphan-binary paths in finding 5 were not reproduced dynamically; finding 4 was reproduced with an ad-hoc vitest run (scratchpad only).
- Variants (`variants/apply.ts`, `select.ts`) and relevance scoring were read only briefly for mutation and determinism.
