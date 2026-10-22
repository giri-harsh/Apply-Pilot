# Installation

## Requirements
Windows, Node 20+, pnpm, Chrome 110+. For the end-to-end tests: `pnpm exec playwright install chromium` once.

## Build and load
```powershell
pnpm install
pnpm build            # production build to dist/
```
Chrome -> `chrome://extensions` -> Developer mode -> **Load unpacked** -> select `dist/`.
To share a build: `pnpm package` writes `release/applypilot-0.1.0.zip` (production manifest only).

## First run
1. Open the extension's **Settings** (options page). Fill in your **Personal** details and any Education, Skills, Projects, Experience, Certifications. Save.
2. Optional, **AI providers**: paste a Gemini and/or Groq key, switch AI on, press "Test connection". Keys are never shown again (only the last four characters).
3. Optional, **Resume**: choose a PDF/DOCX/TXT resume, review the extracted items (uncertain ones are flagged first), press **Confirm**. Then switch on "Tailor my resume for each application".
4. Open a job application page, click the ApplyPilot toolbar icon, press **Quick Apply**. Review everything and submit yourself.

## Per-site permission (multi-page applications)
If an application moves to another site, the run stops with "Permission lost after navigation". Open the popup on the new page and press **Allow ApplyPilot on <site>** (Chrome asks you to confirm). The run continues from where it stopped. Granted sites are listed, and revocable, under Settings > Site access.

## Capturing a page for adapter work
Popup > **Capture this page for adapter work** (or Settings > Diagnostics > "capture each step"). Captures are redacted structural snapshots, stored on this computer. Export them from Settings > Diagnostics.

## Live API checks (optional)
Put `GEMINI_API_KEY` / `GROQ_API_KEY` in `.env` (never committed), then `pnpm test:live -- <name>`. At most `LIVE_MAX_CALLS` (default 2) real requests are sent per invocation.
