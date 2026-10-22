# Contract requests

Builders append here (in their own worktree) when they need a change to a LEAD-owned contract
(`src/resume/schema.ts`, `src/resume/contracts.ts`, `src/resume/messages.ts`, `src/resume/hash.ts`, `src/shared/*`, manifest,
storage namespaces, config). Format:

```
## <builder> - <short title>
Change: the exact change (field, type, signature)
Reason: why it is needed
Workaround used meanwhile: ...
```

The LEAD applies approved changes on `phase-7-wip` and tells dependent builders to merge it.

---

## B1 - fake-indexeddb devDependency (package.json)
Change: add to `devDependencies` in package.json: `"fake-indexeddb": "^6.2.6"` (pnpm-lock.yaml updated accordingly).
Reason: the resume store keeps binaries in IndexedDB; a small in-memory adapter would not exercise the real IndexedDB code path (transactions, structured clone of Uint8Array). Used only by tests/unit/resume-import/*.
Workaround used meanwhile: added locally on branch p7-b1 (package.json + pnpm-lock.yaml changed in the p7-b1 commit); LEAD can take or replace that hunk.
## B2 - Bundle the embedded PDF font into the extension build
Change: copy `assets/fonts/SourceSans3-Regular.ttf` and `assets/fonts/SourceSans3-Bold.ttf` (plus `OFL-SourceSans3.md`) into the built extension at `assets/fonts/` (scripts/build.mjs copy step). Because the PDF is laid out in an extension page (options / offscreen), no `web_accessible_resources` entry is needed (extension pages can fetch their own files). Only add one if layout ever runs in a content script.
Reason: `src/resume/layout/fonts.ts` loads the fonts lazily with `fetch(chrome.runtime.getURL("assets/fonts/<file>"))` when `chrome.runtime.getURL` exists, and from the repo's `assets/fonts` directory otherwise (tests / node). The fonts are NOT imported, so they never enter the service-worker bundle. The caller can also inject bytes: `layoutPdf(t, c, { fonts: { regular, bold } | () => Promise<{regular, bold}> })`.
Also: `validatePdf` uses `pdfjs-dist/legacy/build/pdf.mjs` through a dynamic import. In an extension page copy `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs` into the build and pass its URL as `validatePdfWith(bytes, expectations, { workerSrc: chrome.runtime.getURL("pdf.worker.mjs") })` (the contract's `validatePdf` takes no third argument and uses pdfjs defaults). Do not import layout/export from the service worker (pdfjs, pdf-lib, fontkit and docx are large).
Workaround used meanwhile: tests read the fonts from disk and run pdfjs in node without a worker.
## B4 - HandleUploadFn cannot express protocol errors
Change: `HandleUploadFn` should return `Promise<UploadContentResponse | ErrorResponse>` (ErrorResponse from `src/shared/messages.ts`), or `UploadContentResponseSchemas` should gain an error arm.
Reason: chunk-integrity failures (unknown transferId, out-of-order or duplicate chunk, wrong size, missing chunk) must be rejected. B4 answers them with `{ ok: false, code: "INVALID_MESSAGE", message }`, which is valid at the message layer (ContentResponseSchema includes ErrorResponse) but not in the declared return type.
Workaround used meanwhile: a single documented cast in `src/content/upload/index.ts` (`fail()`).


## LEAD decisions
- B1 fake-indexeddb: accepted (kept in package.json).
- B2 font + pdf worker: LEAD adds the copy step to scripts/build.mjs.
- B4 HandleUploadFn error arm: accepted; contracts.ts widened to include ErrorResponse.
- B3 variantAutoSelected: not added to the contract; resume-service overwrites the report field with the `auto` value from selectVariant.
- B3 section titles: TailoredSection.title is the single source of headings; the layout/export render section.title (verified by an integration test).

## B3 - TailorInput should carry whether the variant was auto-selected
Change: add `variantAutoSelected?: boolean` to `TailorInput` in src/resume/contracts.ts (the `auto` value returned by `selectVariant`).
Reason: `ResumeTailoringReport.variantAutoSelected` is required, but `TailorInput` gives `tailor()` no way to know how the variant was chosen.
Workaround used meanwhile: `tailor()` always writes `variantAutoSelected: false`; the caller that ran `selectVariant` must overwrite it on the report (`{ ...report, variantAutoSelected: auto }`).

## B3 - Section titles: lines or only TailoredSection.title? (decision needed, no schema change)
Change: none requested. `TailoredSection.title` already carries the heading text, and `LINE_ROLES` also has `section_title`.
Reason: emitting both would render each heading twice; emitting only one could drop headings if B2 expects the other.
Workaround used meanwhile: `tailor()` sets `TailoredSection.title` ("Experience", ...; the header section's title is "") and does NOT emit `section_title` lines. If B2 wants lines, add them in src/resume/tailor/assemble.ts (sourceFactIds = the section's first fact, `protected: true`).
