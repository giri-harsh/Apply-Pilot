import { z } from "zod";

/** A redacted structural snapshot of one step of an application page, for adapter development. No values, ever. */

const s = (max = 200) => z.string().max(max);

export const CaptureFieldSchema = z.object({
  index: z.number().int(),
  label: s(),
  labelSource: s(40),
  signals: z.array(z.object({ source: s(40), text: s() })).max(4),
  control: s(20),
  inputType: s(20),
  required: z.boolean(),
  enabled: z.boolean(),
  visible: z.boolean(),
  section: s(),
  options: z.array(s(80)).max(20),
  optionCount: z.number().int(),
  ambiguous: z.boolean(),
  ambiguityReason: s().nullable(),
  risk: s(20),
  semanticType: s(40),
  confidence: z.number(),
  widget: s(20),
  accept: s(100),
  nameHint: s(80),
  idHint: s(80),
});

export const PortalCaptureSchema = z.object({
  version: z.literal(1),
  captureId: s(64),
  capturedAt: z.string().datetime(),
  extensionVersion: s(20),
  /** The step index when captured automatically during a run ("capture each step"), else null. */
  step: z.number().int().nullable(),
  page: z.object({ host: s(120), path: s(200), title: s() }),
  signals: z.object({
    generator: s(100).nullable(),
    scriptHosts: z.array(s(120)).max(30),
    classPrefixes: z.array(z.object({ prefix: s(40), count: z.number().int() })).max(20),
    dataAttributes: z.array(z.object({ name: s(60), count: z.number().int() })).max(30),
  }),
  headings: z.array(s(120)).max(10),
  fields: z.array(CaptureFieldSchema).max(300),
  controls: z.array(z.object({ text: s(80), role: s(10), reasons: z.array(s(120)).max(4) })).max(60),
  stepIndicator: z.object({ current: z.number().int(), total: z.number().int() }).nullable(),
  hasReviewSummary: z.boolean(),
  isLastStep: z.boolean(),
  frames: z.array(z.object({ origin: s(120), accessible: z.boolean(), visible: z.boolean(), width: z.number(), height: z.number() })).max(30),
  shadowRoots: z.number().int(),
  blockers: z.array(z.object({ type: s(10) })).max(5),
  lastRun: z
    .object({
      state: s(30),
      steps: z.array(z.object({ index: z.number().int(), title: s(), outcome: s(20), verified: z.number().int(), failed: z.number().int(), requiredUnresolved: z.number().int() })).max(20),
      results: z.array(z.object({ label: s(), outcome: s(30), reason: s(), semanticType: s(40), required: z.boolean() })).max(80),
    })
    .nullable(),
});
export type PortalCapture = z.infer<typeof PortalCaptureSchema>;
export type CaptureField = z.infer<typeof CaptureFieldSchema>;

export const DIAG_SETTINGS_KEY = "applypilot.diagnostics.settings.v1";
export const DiagSettingsSchema = z.object({ captureEachStep: z.boolean().default(false) });
export type DiagSettings = z.infer<typeof DiagSettingsSchema>;
