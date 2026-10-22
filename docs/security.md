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

## The final-control guard (SPEC 15, 17, 21)
The agent may click exactly one kind of control: a next-step control, and only after the step's fields are done. Everything else on a page is treated as final and is never clicked.
- Classification (`src/content/navigation/classify.ts`): wording (submit, apply, send, finish, confirm, pay/payment, checkout, register, certify, ...), the submit button of a form that posts (`action`, `method=post` or `formaction`), a review summary page, the last step of a "Step N of N" indicator, and any button whose wording is not recognised are all final. When unsure, the answer is final.
- A step is advanced only when there is exactly one next control and no explicitly final control beside it. Back, Save draft and unrecognised extras do not count as a reason to click and are never clicked.
- The content script re-classifies at click time and refuses if the control is no longer the single safe next control (the page can change between the check and the click). Clicks use real pointer and mouse events on that one element and never call `form.submit()`.
- Page text cannot change this: a button labelled "Next" that sits in a posting form is final, and wording is matched case-insensitively on visible text only.
- Blockers (CAPTCHA, MFA/verification code, login) stop the run before anything is filled; the agent never interacts with those widgets. Cross-origin frames are listed and never entered.
- Limits (180 s, 200 actions, 12 retries, 4 passes per step, 8 step changes) end the run BLOCKED with the limit named. Stop cancels every timer and the page-side work.
Tests: `navigation.test.ts` (classifier cases), `run-manager.test.ts`, and `phase9.spec.ts`, whose trap, review and endless portals assert that the page's click and submit handlers never fired.

## Resume data, generated documents and uploads (Phase 7)
- **Separation (SPEC 20.2).** Master resume, variants, generated-document records and settings are separate `chrome.storage.local` keys; resume and generated binaries live only in IndexedDB (extension origin). No binary is ever written to `chrome.storage`. Everything is user-viewable and user-deletable (Options > Resume), and "Delete all resume data" also removes the binaries.
- **Master is immutable during tailoring.** Every output records `masterHash` (SHA-256 of the canonical JSON); the service worker re-reads the master after the build and fails the run if the hash changed.
- **No unsupported claims.** The AI may reword only; every rewritten bullet is checked by the Phase 6 grounding validator (numbers, tools, organisations, employment vs project, production claims, certifications, links) plus a keyword-stuffing guard and a length cap. A bullet that still fails keeps the master wording, recorded as `fallback_to_master`. Every tailored line carries `sourceFactIds` (schema-enforced, at least one).
- **What goes to the AI.** Only the job slice (title, a few skills, short responsibilities) and the bullets to reword, as delimited data (`<<<PAGE_DATA_START ... PAGE_DATA_END>>>`), never contact details. Keys stay in the service worker; the offscreen document gets structured resume content only.
- **Uploads.** Bytes cross to the page's content script as ordered base64 chunks over the extension message channel (no URL, no page-visible state), reassembled in module memory, zeroed after commit or abort, and dropped after 60 s idle. The resume goes only into a field classified as a resume field; ambiguous, other and cover-letter fields are skipped and reported; a field that already holds a file is never replaced; one upload per field per run. The result is verified from the page's own reaction, never assumed.
- **Filenames** contain only the company and role (ASCII) and the date, never the applicant's name, email or phone.
- **Imports** parse in extension pages only, with the pdf.js worker served from the extension itself (no CDN), size-capped, and never auto-confirmed.
