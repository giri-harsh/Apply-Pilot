import { PortalCaptureSchema, type PortalCapture } from "@/diagnostics/schema";
import { profileStrings, scrubProfile, maskText } from "@/diagnostics/redact";
import type { CaptureStore } from "@/diagnostics/store";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { UserProfile } from "@/shared/profile";
import type { RunRecord } from "@/shared/run";

export type DiagnosticsDeps = {
  store: CaptureStore;
  injectContent(tabId: number): Promise<void>;
  sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse>;
  loadProfile(): Promise<UserProfile | null>;
  getRun(tabId: number): Promise<RunRecord | null>;
  version: string;
  now(): Date;
  newId(): string;
};

/** The value-free part of a run report: outcomes and reasons per field label, never anything that was typed. */
export function lastRunOf(run: RunRecord | null): PortalCapture["lastRun"] {
  if (!run) return null;
  return {
    state: run.state,
    steps: run.steps.slice(0, 20).map((s) => ({ index: s.index, title: maskText(s.title), outcome: s.outcome, verified: s.verified, failed: s.failed, requiredUnresolved: s.requiredUnresolved })),
    results: (run.report?.results ?? []).slice(0, 80).map((r) => ({ label: maskText(r.label), outcome: r.outcome, reason: maskText(r.reason), semanticType: r.semanticType, required: r.required })),
  };
}

/**
 * Captures the current page of a tab: asks the content script for the structural snapshot (read-only, user-initiated),
 * adds the last run's value-free report, scrubs every string the profile holds, validates, and stores it locally.
 * Nothing leaves the browser.
 */
export class DiagnosticsService {
  constructor(private deps: DiagnosticsDeps) {}

  async capture(tabId: number, step: number | null = null, opts: { inject?: boolean } = { inject: true }): Promise<PortalCapture> {
    const d = this.deps;
    if (opts.inject !== false) await d.injectContent(tabId);
    const res = await d.sendToTab(tabId, { kind: "CAPTURE", captureId: d.newId(), nowIso: d.now().toISOString(), version: d.version, step });
    if (!res.ok || res.kind !== "CAPTURED") throw new Error("The page could not be captured");
    const profile = await d.loadProfile();
    const merged = { ...res.capture, lastRun: lastRunOf(await d.getRun(tabId)) };
    const clean = PortalCaptureSchema.parse(scrubProfile(merged, profile ? profileStrings(profile) : []));
    await d.store.put(clean);
    return clean;
  }
}
