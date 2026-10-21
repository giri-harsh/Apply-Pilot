# Security and privacy notes

## Page content is untrusted data (SPEC 20.3)
- Nothing the page says is ever executed or treated as an instruction. The executor accepts only the typed `AgentAction` union, validates each action on its own, and has no code-evaluation path. There is no click action other than toggling a radio/checkbox input; submit, finalize and certify controls are never clicked.
- When AI is on, page-derived text (labels, placeholders, nearby text, section headings, option labels) is length-bounded, stripped of control characters, stripped of our own delimiter tokens, and wrapped in one `<<<PAGE_DATA_START ... PAGE_DATA_END>>>` block. The system prompt states that this block is data, never instructions.
- The model's answer is only a hint. Deterministic code validates every item (closed enums for semantic type and profile key, type/key consistency, sensitive-type and sensitive-label rejection, duplicate and conflict rejection, a configurable confidence threshold, and `requiresReview`). Injection text in a label or in the model's evidence strings can therefore not select a key outside the allow-list or trigger an action.

## What leaves the browser when AI is on (SPEC 20.4)
Only for fields the rules could not place and that are not sensitive, eligibility, consent, legal, identity-document, file, password, hidden, disabled, already-filled or third-party: field type, label evidence (up to 4 strings), name/id, placeholder, a bounded nearby-text snippet, the section heading, and up to 12 option labels. Never: profile values, resume text, API keys, other tabs, history, or the page URL.

## API keys (SPEC 13.6) and the limits of extension storage
- Keys are typed on the options page, sent once to the service worker (`AI_SET_KEY`), stored in `chrome.storage.local` under their own key, and never sent back: the UI only learns "configured" and the last four characters. No response or content-script message schema has a key field (unit test enforced).
- The service worker sets the storage access level to `TRUSTED_CONTEXTS`, so content scripts (which run alongside web pages) cannot read `chrome.storage.local`.
- Limits you should know: `chrome.storage.local` is **not encrypted**. Anyone with access to your unlocked computer and Chrome profile directory can read the keys; malware running as your user can too; other extensions cannot read it, but a malicious extension you install with debugging privileges could. Use free-tier keys with a small quota, rotate them if the machine is shared, and remove them with "Remove key". A local companion process (Phase 10) could improve isolation but is not required for the MVP.
- Keys are sent only in a request header (`x-goog-api-key` for Gemini, `Authorization: Bearer` for Groq) to the two allowed origins, with `credentials: "omit"`. Endpoint overrides are not accepted from settings, so a key cannot be redirected to another host.

## Logging (SPEC 20.5)
The usage log (`AIRequestRecord`) stores provider, model, category, token counts, latency, outcome and a short error code such as `http_429`. It never stores prompts, responses, keys or personal data. Error objects are built from status codes only, never from response bodies.

## Mapping cache
The cache stores `{semantic type, profile key, confidence, time}` keyed by provider, model and a signature of the field (normalized label, control type, options hash, section). It never stores values. Negative results (the model said "unknown", or it proposed a disallowed type) are stored so the same field does not spend quota again. "Clear mapping cache" on the options page removes it.
