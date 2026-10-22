# Permissions

| Permission | Why | Notes |
|---|---|---|
| `activeTab` | Grants temporary access to the tab where the user clicks the ApplyPilot toolbar button, so Quick Apply can inject the content script and read/fill that one page. | Expires on navigation/tab close. No broad page access. |
| `scripting` | `chrome.scripting.executeScript` injects `content.js` into the active tab on demand. | Only used after the user starts a run (or opens the popup for the job preview, Phase 5). |
| `storage` | Saves the profile vault, run state, AI settings, API keys, usage log and mapping cache in `chrome.storage.local`. | Data stays on the device, in separate keys per concern. Nothing is synced. |
| `offscreen` | Lets the service worker create one hidden extension document that lays out and validates the tailored resume PDF (pdf-lib, pdf.js) and builds the DOCX. Service workers have no DOM and should stay small. | The document is an extension page (`offscreen.html`); its code makes no network requests and never reads API keys (AI calls stay in the service worker, which the document reaches only for shorter resume wording). It is created on demand. No effect on any website. |
| host `https://generativelanguage.googleapis.com/*` | Lets the **service worker** call the Gemini REST API. | Exactly one origin. Only used when the user turns AI on and saves a Gemini key. |
| host `https://api.groq.com/*` | Lets the **service worker** call the Groq REST API. | Exactly one origin. Only used when the user turns AI on and saves a Groq key. |

Not requested: `tabs`, `<all_urls>`, any other host, `webRequest`, `cookies`, `downloads`, `identity`, `alarms`.

Requests to the two API origins are made from the service worker only. They never carry profile values (see `docs/security.md`), use `credentials: "omit"`, and the key travels in a header. With AI off (the default) or no key saved, no request to either origin is ever made.

The test-only build (`pnpm build:e2e`, output `dist-e2e/`) additionally requests `http://127.0.0.1/*` so automated tests can run against local synthetic forms. Never ship `dist-e2e`.

Trade-off: because there is no static content script, Quick Apply must be started from the toolbar popup on the page itself. Cross-origin iframes are not reachable under `activeTab` alone (SPEC 12.9); that limitation is reported rather than hidden.

## Multi-page forms and navigation (Phase 9)
After a click that makes the page reload, the service worker listens to `chrome.tabs.onUpdated` for that one tab (the `status` field needs no `tabs` permission) and re-injects the content script when loading completes.
- `activeTab` stays valid for same-origin navigations of the tab; it ends when the tab moves to another origin. If re-injection is then refused, the run ends BLOCKED with "Permission lost after navigation".

### Optional per-origin host permission (Phase 9b)
| Permission | Why | Notes |
|---|---|---|
| `optional_host_permissions`: `https://*/*`, `http://*/*` | Lets the extension *ask* for one origin at a time. Nothing is granted at install. | Chrome shows its own confirmation. Only the origin named in the request is granted, never the wildcard. |

- When a run is BLOCKED after navigating to another site, the popup shows "Allow ApplyPilot on <origin>". The click calls `chrome.permissions.request({ origins: ["<origin>/*"] })` from that user gesture. On a grant, the run continues as a continuation run that keeps the finished steps and re-observes the new page. If the user declines, the run stays stopped.
- Requests are never made without a click, and never for a wildcard: the payload is built by `permissionRequest()` (`src/shared/origin.ts`), which accepts only a single http(s) host, with no port, path or credentials.
- Options > Site access lists the origins the user granted (the AI API hosts and the test build's loopback are not listed) with a Revoke button for each, which removes exactly that one origin.
- The production `host_permissions` stay the two AI API origins.
- Needs user verification: clicking the real Chrome confirmation bubble cannot be automated. Tests stub `chrome.permissions.request` to check the exact payload and both answers (granted and denied).
