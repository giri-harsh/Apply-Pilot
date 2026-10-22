import { INDICATOR_AUTOHIDE_MS, INDICATOR_SETTINGS_KEY, viewFor } from "@/indicator/labels";
import type { KVStore } from "@/ai/storage";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { RunRecord } from "@/shared/run";

/**
 * Pushes the run's status to the in-page indicator (SPEC 5.3). Fire-and-forget: a page that cannot be reached (navigated away,
 * restricted) just shows nothing, and the run is never affected. Sends only when the label changes. Off by a setting.
 */
export class IndicatorService {
  private last = new Map<number, string>();
  constructor(private deps: { store: KVStore; sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse> }) {}

  async enabled(): Promise<boolean> {
    const raw = (await this.deps.store.get(INDICATOR_SETTINGS_KEY))[INDICATOR_SETTINGS_KEY] as { enabled?: boolean } | undefined;
    return raw?.enabled !== false; // on by default
  }

  async update(run: RunRecord): Promise<void> {
    const v = viewFor(run.state, run.reason);
    if (!v) return;
    const sig = `${run.runId}|${v.label}`;
    if (this.last.get(run.tabId) === sig) return;
    this.last.set(run.tabId, sig);
    if (!(await this.enabled())) return;
    await this.deps
      .sendToTab(run.tabId, { kind: "INDICATOR", show: true, label: v.label, tone: v.tone, canStop: !v.final, autoHideMs: v.final ? INDICATOR_AUTOHIDE_MS : null })
      .catch(() => undefined);
  }

  /** Removes the pill (for example when the user turns the indicator off in the middle of a run). */
  async hide(tabId: number): Promise<void> {
    this.last.delete(tabId);
    await this.deps.sendToTab(tabId, { kind: "INDICATOR", show: false, label: "", tone: "done", canStop: false, autoHideMs: null }).catch(() => undefined);
  }
}
