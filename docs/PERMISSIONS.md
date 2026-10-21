# Permissions

| Permission | Why | Notes |
|---|---|---|
| `activeTab` | Grants temporary access to the tab where the user clicks the ApplyPilot toolbar button, so Quick Apply can inject the content script and read/fill that one page. | Expires on navigation/tab close. No broad page access. |
| `scripting` | `chrome.scripting.executeScript` injects `content.js` into the active tab on demand. | Only used after the user starts a run (or opens the popup for the job preview, Phase 5). |
| `storage` | Saves the profile vault, run state, AI settings, API keys, usage log and mapping cache in `chrome.storage.local`. | Data stays on the device, in separate keys per concern. Nothing is synced. |
| host `https://generativelanguage.googleapis.com/*` | Lets the **service worker** call the Gemini REST API. | Exactly one origin. Only used when the user turns AI on and saves a Gemini key. |
| host `https://api.groq.com/*` | Lets the **service worker** call the Groq REST API. | Exactly one origin. Only used when the user turns AI on and saves a Groq key. |

Not requested: `tabs`, `<all_urls>`, any other host, `webRequest`, `cookies`, `downloads`, `identity`, `alarms`.

Requests to the two API origins are made from the service worker only. They never carry profile values (see `docs/security.md`), use `credentials: "omit"`, and the key travels in a header. With AI off (the default) or no key saved, no request to either origin is ever made.

The test-only build (`pnpm build:e2e`, output `dist-e2e/`) additionally requests `http://127.0.0.1/*` so automated tests can run against local synthetic forms. Never ship `dist-e2e`.

Trade-off: because there is no static content script, Quick Apply must be started from the toolbar popup on the page itself. Cross-origin iframes are not reachable under `activeTab` alone (SPEC 12.9); that limitation is reported rather than hidden.
