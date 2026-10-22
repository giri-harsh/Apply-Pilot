# Data models

All persisted and message data is validated with Zod at the boundary (`*Schema` next to each type).

| Model | File | Notes |
|---|---|---|
| UserProfile | `src/shared/profile.ts` | personal, education, skills, projects, experience, certifications, preferences; every fact has provenance (`user_entered`, `resume_import_approved`, `user_edited`, ...) |
| FormField, FieldResult, CompletionReport | `src/shared/form.ts` | observed control, label evidence, semantic type, confidence, risk; per-step report |
| RunRecord | `src/shared/run.ts` | state, history, steps, counters, notes, answers, job, AI usage, resume info, permission flags |
| JobContext, MatchReport | `src/job/schema.ts` | extracted posting and a transparent skill-overlap score |
| MasterResume, Fact, ResumeVariant, TailoredResume, LayoutConfig, ResumeDocument, ResumeTailoringReport | `src/resume/schema.ts` | facts with `factId`; variants are rules over ids; tailored lines cite `sourceFactIds` |
| PortalCapture | `src/diagnostics/schema.ts` | redacted structure only; no values |
| AIRequestRecord, mapping cache | `src/ai/storage.ts` | provider, model, tokens, latency, outcome; never prompts or content |
| SavedAnswer | `src/answers/storage.ts` | saved only on an explicit click |
| Failure policy | `src/shared/failure-policy.ts` | 18 kinds, bounded recoveries |

Storage keys are prefixed `applypilot.` and listed in `docs/security.md` (what is stored where, and what is never stored).
