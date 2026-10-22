# ApplyPilot AI

A personal Chrome (Manifest V3) extension that prepares a job application in one click: it reads the page, fills the fields it can verify from your profile, can write a job-specific resume PDF, and uploads it. **It never submits an application.** You review and press Submit yourself.

Status: Phase 11 hardening is PARTIAL until the manual real-Chrome checks in [docs/PROGRESS.md](docs/PROGRESS.md) are done. Real-portal adapters (Phase 8) wait for captures from real portals. Spec: [docs/SPEC.md](docs/SPEC.md).

## What it does
- **Autofill** from a local profile vault (every fact has provenance), with verification after each action and an honest per-field report.
- **Multi-step forms**: fills each step, clicks only a control it can positively identify as "next", and stops at the review or final step.
- **Optional AI** (off by default; Gemini or Groq with your own key): classifies fields rules could not place and writes grounded answers to open-ended questions. Answers are checked against your own facts and marked "AI-written, review".
- **Resumes**: import a PDF/DOCX/TXT resume, confirm it as your master, and let Quick Apply build a one-page, job-specific PDF from it (wording changes only; every claim traces to a master fact). Cover letters are optional and off by default.
- **Portal capture** for adapter development: a redacted structural snapshot of a page step, stored locally, exported by you.

## Safety guarantees (each has a test)
- Never clicks Submit, Apply, Send, Pay or any control it is unsure about (unrecognised buttons count as final).
- Never fills sensitive, legal, eligibility or consent fields; never invents values, metrics, tools or employers.
- Stops at CAPTCHA, MFA and login walls; never touches cross-origin frames.
- Hard run limits (time, actions, retries, passes, steps); Stop cancels every timer immediately.
- API keys live only in the service worker's storage and never appear in a message, export, capture or log.
- Nothing runs on a page until you click the toolbar button; broader site access is requested per origin, from your click.
- The master resume is never modified by tailoring; edits happen only in Settings.

## Commands (PowerShell)
| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm build` | Production build to `dist/` |
| `pnpm package` | Production zip `release/applypilot-<version>.zip` |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Builds the test extension and synthetic portals, runs Playwright (once: `pnpm exec playwright install chromium`) |
| `pnpm metrics` | Measures the synthetic suite and writes [docs/METRICS.md](docs/METRICS.md) |
| `pnpm test:live` | Opt-in real-API checks, capped by `LIVE_MAX_CALLS` (default 2); needs keys in `.env` |

## Install and use
See [docs/installation.md](docs/installation.md). In short: build, load `dist/` unpacked, fill your profile in Settings, open an application page, click the icon, Quick Apply.

## Documentation
[architecture](docs/architecture.md), [data models](docs/data-models.md), [security](docs/security.md), [permissions](docs/PERMISSIONS.md), [testing](docs/testing.md), [decisions](docs/DECISIONS.md), [progress and known limitations](docs/PROGRESS.md), [metrics](docs/METRICS.md).

## Known limitations (consolidated)
- Not verified in real Chrome yet: the permission prompt, the toolbar flow on real portals, pdf.js and fonts in the packaged extension, the DOCX in Word. Nothing here is claimed as production-ready.
- No portal adapters for real sites yet; the general agent handles unknown portals.
- Closed shadow roots and cross-origin iframe contents are not handled (reported, never entered). Cross-origin navigation needs your per-origin permission.
- Custom widgets: only ARIA-annotated comboboxes and listboxes are recognised.
- Resumes: no OCR for scanned PDFs; glyphs missing from the embedded font (for example Devanagari, CJK) draw as "?" and fail validation; a resume whose lines are all protected cannot be fitted and is reported as over the page limit.
- AI: Gemini runs in prompt-only schema mode (structured modes return HTTP 400); keys sit unencrypted in `chrome.storage.local` (see security.md).
- Metrics are measured on small synthetic fixtures; they are a regression gate, not a statistic about real portals.
