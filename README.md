# ApplyPilot AI

Personal Chrome MV3 extension that prepares job applications in one click. It fills what it can verify, leaves sensitive or uncertain fields for you, and never submits. Spec: [docs/SPEC.md](docs/SPEC.md). Status: [docs/PROGRESS.md](docs/PROGRESS.md).

## Commands (PowerShell)
| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm build` | Build the extension to `dist/` |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Builds `dist-e2e/` + synthetic portals, runs Playwright (needs `pnpm exec playwright install chromium` once) |

## Load unpacked
1. `pnpm build`
2. Chrome -> `chrome://extensions` -> enable Developer mode -> Load unpacked -> select `dist/`.
3. Open the extension's options page, fill in your profile (or import JSON), Save.
4. Open a job application page and click the ApplyPilot toolbar icon -> Quick Apply.
