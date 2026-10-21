# Permissions

| Permission | Why | Notes |
|---|---|---|
| `activeTab` | Grants temporary access to the tab where the user clicks the ApplyPilot toolbar button, so Quick Apply can inject the content script and read/fill that one page. | Expires on navigation/tab close. No broad host access. |
| `scripting` | `chrome.scripting.executeScript` injects `content.js` into the active tab on demand. | Only used after the user starts a run. |
| `storage` | Saves the profile vault and run state in `chrome.storage.local`. | Data stays on the device. Nothing is synced or sent anywhere. |

Not requested: `tabs` (tab id/url come from activeTab), `<all_urls>`, `host_permissions`, `webRequest`, `cookies`, `downloads`, `identity`.

The test-only build (`pnpm build:e2e`, output `dist-e2e/`) additionally requests `host_permissions: ["http://127.0.0.1/*"]` so automated tests can run against local synthetic forms. Never ship `dist-e2e`.

Trade-off: because there is no static content script, Quick Apply must be started from the toolbar popup on the page itself. Cross-origin iframes are not reachable under activeTab alone (SPEC 12.9); that limitation is reported rather than hidden.
