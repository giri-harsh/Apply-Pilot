import type { CompletionReport, FieldResult, FormField } from "@/shared/form";
import type { ContentRequest, ContentResponse, ErrorResponse, PlannedFill } from "@/shared/messages";
import type { UserProfile } from "@/shared/profile";
import { buildReport } from "@/shared/report";
import type { RunRecord, RunsMap } from "@/shared/run";
import { InvalidTransitionError, assertTransition, isTerminal, isWorking, type RunState } from "@/shared/state-machine";

export type RunLimits = { maxDurationMs: number; maxFields: number; stepTimeoutMs: number };
export const DEFAULT_LIMITS: RunLimits = { maxDurationMs: 90_000, maxFields: 300, stepTimeoutMs: 20_000 };

export interface RunDeps {
  loadRuns(): Promise<RunsMap>;
  saveRuns(runs: RunsMap): Promise<void>;
  loadProfile(): Promise<UserProfile | null>;
  injectContent(tabId: number): Promise<void>;
  sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse>;
  tabInfo(tabId: number): Promise<{ url: string; title: string } | null>;
  now(): number;
  newId(): string;
  limits?: RunLimits;
}

export type StartResult = { ok: true; run: RunRecord } | ErrorResponse;

const key = (tabId: number) => String(tabId);

class Abort extends Error {}

export class RunManager {
  private runs: RunsMap = {};
  private loaded: Promise<void> | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private starting = new Set<number>();
  private limits: RunLimits;

  constructor(private deps: RunDeps) {
    this.limits = deps.limits ?? DEFAULT_LIMITS;
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.deps.loadRuns().then((r) => {
      this.runs = r;
    });
    return this.loaded;
  }

  private persist(): Promise<void> {
    const snapshot = structuredClone(this.runs);
    this.saveChain = this.saveChain.then(() => this.deps.saveRuns(snapshot));
    return this.saveChain;
  }

  async get(tabId: number): Promise<RunRecord | null> {
    await this.ensureLoaded();
    return this.runs[key(tabId)] ?? null;
  }

  private async move(runId: string, tabId: number, to: RunState, patch: Partial<RunRecord> = {}): Promise<RunRecord> {
    const run = this.runs[key(tabId)];
    if (!run || run.runId !== runId) throw new Abort("Run was replaced");
    if (run.state === "CANCELLED") throw new Abort("Run was cancelled");
    assertTransition(run.state, to);
    const at = this.deps.now();
    const next: RunRecord = { ...run, ...patch, state: to, updatedAt: at, history: [...run.history, { state: to, at }] };
    this.runs[key(tabId)] = next;
    await this.persist();
    return next;
  }

  /** Quick Apply. Guards against a second concurrent run on the same tab before any await. */
  async start(tabId: number): Promise<StartResult> {
    if (this.starting.has(tabId)) {
      return { ok: false, code: "DUPLICATE_RUN", message: "A run is already starting on this tab" };
    }
    this.starting.add(tabId);
    try {
      await this.ensureLoaded();
      const existing = this.runs[key(tabId)];
      if (existing && isWorking(existing.state)) {
        return { ok: false, code: "DUPLICATE_RUN", message: "A run is already active on this tab" };
      }
      const info = await this.deps.tabInfo(tabId);
      if (!info) return { ok: false, code: "INJECTION_FAILED", message: "Tab is not available" };
      const at = this.deps.now();
      const run: RunRecord = {
        runId: this.deps.newId(),
        tabId,
        url: info.url,
        pageTitle: info.title,
        state: "INITIALIZING",
        history: [{ state: "INITIALIZING", at }],
        startedAt: at,
        updatedAt: at,
        fieldsDiscovered: null,
        resumeCount: 0,
        report: null,
        reason: null,
      };
      this.runs[key(tabId)] = run;
      await this.persist();
      void this.drive(run.runId, tabId, at);
      return { ok: true, run };
    } finally {
      this.starting.delete(tabId);
    }
  }

  async stop(tabId: number): Promise<StartResult> {
    await this.ensureLoaded();
    const run = this.runs[key(tabId)];
    if (!run || isTerminal(run.state) || run.state === "IDLE") {
      return { ok: false, code: "NO_RUN", message: "No active run on this tab" };
    }
    const next = await this.move(run.runId, tabId, "CANCELLED", { reason: "Stopped by user" }).catch((e) => {
      if (e instanceof Abort) return this.runs[key(tabId)]!;
      throw e;
    });
    // Best effort: tell the page to stop any in-flight actions. The run is already cancelled either way.
    void this.deps.sendToTab(tabId, { kind: "CANCEL" }).catch(() => undefined);
    return { ok: true, run: next };
  }

  /**
   * Called when the service worker wakes. In-flight runs are re-observed, never replayed (SPEC 15.3):
   * the pipeline is idempotent because the mapper skips fields that already hold the profile value.
   */
  async rehydrate(): Promise<void> {
    await this.ensureLoaded();
    for (const run of Object.values(this.runs)) {
      if (!isWorking(run.state)) continue;
      const info = await this.deps.tabInfo(run.tabId);
      if (!info) {
        await this.move(run.runId, run.tabId, "FAILED", { reason: "Tab closed while the run was interrupted" }).catch(() => undefined);
        continue;
      }
      try {
        const patch = { resumeCount: run.resumeCount + 1, url: info.url };
        if (run.state === "OBSERVING") {
          this.runs[key(run.tabId)] = { ...run, ...patch };
          await this.persist();
        } else {
          await this.move(run.runId, run.tabId, "OBSERVING", patch);
        }
        void this.drive(run.runId, run.tabId, run.startedAt);
      } catch {
        /* run was cancelled or replaced concurrently */
      }
    }
  }

  private assertActive(runId: string, tabId: number): void {
    const run = this.runs[key(tabId)];
    if (!run || run.runId !== runId || isTerminal(run.state)) throw new Abort("Run is no longer active");
  }

  private async call(runId: string, tabId: number, req: ContentRequest): Promise<ContentResponse> {
    this.assertActive(runId, tabId); // a cancelled run must not schedule any further page work
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("Page did not respond in time")), this.limits.stepTimeoutMs);
    });
    try {
      return await Promise.race([this.deps.sendToTab(tabId, req), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private checkBudget(startedAt: number): void {
    if (this.deps.now() - startedAt > this.limits.maxDurationMs) throw new Error("Run exceeded its time limit");
  }

  private async drive(runId: string, tabId: number, startedAt: number): Promise<void> {
    try {
      await this.pipeline(runId, tabId, startedAt);
    } catch (e) {
      if (e instanceof Abort) return; // cancelled or replaced: nothing further may be scheduled
      const reason = e instanceof Error ? e.message.slice(0, 200) : "Unexpected error";
      await this.move(runId, tabId, "FAILED", { reason }).catch(() => undefined);
    }
  }

  private async blocked(runId: string, tabId: number, reason: string, patch: Partial<RunRecord> = {}): Promise<void> {
    await this.move(runId, tabId, "BLOCKED", { ...patch, reason });
  }

  private async pipeline(runId: string, tabId: number, startedAt: number): Promise<void> {
    const cur = () => this.runs[key(tabId)];
    if (cur()?.state === "INITIALIZING") await this.move(runId, tabId, "OBSERVING");

    try {
      await this.deps.injectContent(tabId);
    } catch {
      return this.blocked(runId, tabId, "Cannot access this page (restricted page or permission not granted)");
    }

    this.checkBudget(startedAt);
    const obs = await this.call(runId, tabId, { kind: "OBSERVE" });
    if (!obs.ok || obs.kind !== "OBSERVED") throw new Error(obs.ok ? "Unexpected reply" : obs.message);
    const fields: FormField[] = obs.fields;
    const visible = fields.filter((f) => f.visible);
    await this.move(runId, tabId, "DISCOVERING_FORM", { url: obs.url, pageTitle: obs.pageTitle, fieldsDiscovered: visible.length });
    if (visible.length === 0) return this.blocked(runId, tabId, "No form fields found on this page");
    if (fields.length > this.limits.maxFields) return this.blocked(runId, tabId, "Too many form fields for one run");

    // Mapping needs the profile; without one we stop honestly after having inspected the page.
    const profile = await this.deps.loadProfile();
    if (!profile) return this.blocked(runId, tabId, "No valid profile saved. Open Settings and complete your profile.");

    this.checkBudget(startedAt);
    await this.move(runId, tabId, "MAPPING_FIELDS");
    const mapped = await this.call(runId, tabId, { kind: "MAP", profile });
    if (!mapped.ok || mapped.kind !== "MAPPED") throw new Error(mapped.ok ? "Unexpected reply" : mapped.message);
    const plan: PlannedFill[] = mapped.plan;
    const skipped: FieldResult[] = mapped.skipped;

    let executed: { fieldId: string; executed: boolean; error: string | null }[] = [];
    let verified: { fieldId: string; verified: boolean; reason: string }[] = [];
    await this.move(runId, tabId, "FILLING");
    if (plan.length > 0) {
      this.checkBudget(startedAt);
      const ex = await this.call(runId, tabId, { kind: "EXECUTE", plan });
      if (!ex.ok || ex.kind !== "EXECUTED") throw new Error(ex.ok ? "Unexpected reply" : ex.message);
      executed = ex.results;
    }
    await this.move(runId, tabId, "VERIFYING");
    if (plan.length > 0) {
      const ver = await this.call(runId, tabId, { kind: "VERIFY", plan });
      if (!ver.ok || ver.kind !== "VERIFIED") throw new Error(ver.ok ? "Unexpected reply" : ver.message);
      verified = ver.results;
    }

    const report: CompletionReport = buildReport(fields, plan, skipped, executed, verified);
    await this.move(runId, tabId, "READY_FOR_REVIEW", { report });
  }
}

export { InvalidTransitionError };
