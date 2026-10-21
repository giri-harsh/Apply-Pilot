# Decisions

One line each: decision | reason | alternatives rejected.

## Phase 0
- Repo was empty (only docs/SPEC.md); nothing kept, replaced or removed. | Nothing to audit. | n/a
- Spec complete (sections 1-30 present; numbering matches the brief: 6.2, 9.2, 9.4, 11.5, 11.8, 25.2, 26, 27, 29.7). | Verified by reading the whole file. | n/a
- pnpm installed with `npm i -g pnpm` (v12.14). | `corepack enable` fails with EPERM writing to C:\Program Files\nodejs (needs admin). | corepack prepare (activates but no shim on PATH), npm only.
- Single package with `src/` modules (shared, background, content, popup, options). | SPEC 27 allows a simple single-package layout with clear boundaries; brief forbids monorepo/placeholders. | pnpm workspace.
- Plain multi-entry Vite builds driven by `scripts/build.mjs` (pages build + one IIFE lib build each for service worker and content script) with a generated manifest. | Guarantees single-file content script / SW with no chunk imports (brief failure case 6), avoids CRXJS/Vite version coupling. | CRXJS plugin.
- zod 3.25.x (v3 API, `import "zod"`). | Brief asks to pick one major and pin it; v3 API is the one in the SPEC-era samples. | zod 4.
- TypeScript 7.0.2 / Vite 8 / Vitest 5 / ESLint 10 as installed by `pnpm add`. | Current majors; typecheck and build pass. | Downgrading.
- Content script is injected on demand with `chrome.scripting.executeScript` under `activeTab`; no static `content_scripts`, no `host_permissions` in the production manifest. | Least privilege (SPEC 20.1); one-click flow still works because the toolbar click grants activeTab. | `<all_urls>` content script.
- A separate e2e manifest (`pnpm build:e2e` -> `dist-e2e`) adds only `http://127.0.0.1/*`. | Playwright cannot click the toolbar icon to get an activeTab grant; loopback-only access is the narrowest way to test the real built bundle. Production `dist` has no host permission. | `file://` access, `<all_urls>`.
- Popup accepts `?targetTabId=` to point at another tab. | Lets tests open popup.html in its own tab and still drive a specific page tab; message validation and sender checks are unchanged. | Fake toolbar click.
- Run state stored in chrome.storage.local keyed by tab id (latest run per tab). | SPEC 15.3 persistence; one active run per tab is the duplicate-run guard. On wake, in-flight runs go back to OBSERVING and re-observe (never replay). | storage.session (lost on browser restart).
- Profile provenance: personal facts carry a per-key provenance map (validation fails if a non-empty fact lacks one); every other record carries one provenance object. | SPEC 6.2 without turning every string into a wrapper object. | Wrapper `{value, provenance}` for each field.
- "Current employer/title" only comes from an experience record explicitly flagged `current`; never inferred from a missing end date. | SPEC 6.2 (never silently infer). | Inference.
- Phase 3 never fills: sensitive/eligibility (visa, sponsorship, work authorization, disability, veteran, race, gender, criminal history, salary, DOB, age, relocation), consent checkboxes, third-party (reference/emergency) sections, files, password fields, hidden fields. | Brief hard rules + SPEC 14.5/17.2. | Fill preference values.
- Commits are made at verification points per phase; source for later phases was authored while Phase 1 was being built, so a phase commit can contain code whose own tests land in the next verified step. PROGRESS.md states what was verified. | Practical sequencing. | n/a
