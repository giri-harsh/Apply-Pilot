import type { AcceptedMapping } from "@/ai/classify/validate";
import type { JobSummary } from "@/job/schema";
import type { CompletionReport, FieldResult, FormField, StepSummary } from "@/shared/form";
import type { ContentRequest, ContentResponse, ErrorResponse, PlannedFill } from "@/shared/messages";
import type { UserProfile } from "@/shared/profile";
import { StepAccumulator, combineReport, type StepRecordLike } from "@/shared/report";
import type { RunRecord, RunsMap } from "@/shared/run";
import { InvalidTransitionError, assertTransition, isTerminal, isWorking, type RunState } from "@/shared/state-machine";
import { Abort, LimitReached } from "./abort";
import { DEFAULT_LIMITS, type RunLimits } from "./limits";
import { Scheduler } from "./scheduler";
import { originPattern } from "@/shared/origin";
import { emptyHints, type LearningPort } from "@/learning/service";
import { fingerprintHash, type LearnEvent } from "@/learning/strategies";

export { DEFAULT_LIMITS };
export type { RunLimits };

export type AiClassifyInput = { fields: FormField[]; skipped: FieldResult[]; requestsRemaining: number };
export type AiClassifyResult = {
  status: RunRecord["ai"]["status"];
  accepted: AcceptedMapping[];
  requests: number;
  cacheHits: number;
  provider: string | null;
  error: string | null;
};

export type AnswerPhaseInput = { fields: FormField[]; skipped: FieldResult[]; profile: UserProfile; url: string; requestsRemaining: number };
export type AnswerPhaseResult = {
  status: RunRecord["ai"]["status"];
  plan: PlannedFill[];
  /** Per-field outcomes for questions that were refused or could not be answered, with the reason. */
  results: FieldResult[];
  answers: RunRecord["answers"];
  requests: number;
  cacheHits: number;
  memoryHits: number;
  error: string | null;
};

/** Phase 7: put the right resume into the page's file field(s). Never throws; problems come back as results and warnings. */
export type UploadPhaseInput = {
  tabId: number;
  runId: string;
  url: string;
  /** Visible file inputs of the final observation of this step. */
  fields: FormField[];
  variantId: string | null;
  resume: RunRecord["resume"];
  scheduler: Scheduler;
  isActive(): boolean;
  /** Persists the run's resume info right away (document id, uploads so far). */
  save(resume: RunRecord["resume"]): Promise<void>;
};
export type UploadPhaseResult = { results: FieldResult[]; resume: RunRecord["resume"]; notes: string[] };

export interface RunDeps {
  /** Learned strategies (Phase 8b): verified successes reused only on a matching page structure. Absent = no learning. */
  learning?: LearningPort;
  /** Diagnostics: capture the current step when the user turned "capture each step" on. Absent or failing never affects the run. */
  captureStep?(tabId: number, stepIndex: number): Promise<void>;
  /** Resume tailoring and upload (Phase 7). Absent means file fields are only reported. */
  uploadResume?(input: UploadPhaseInput): Promise<UploadPhaseResult>;
  /** Grounded answers for open-ended questions (Phase 6). */
  answerQuestions?(input: AnswerPhaseInput): Promise<AnswerPhaseResult>;
  /** Job context for the page (Phase 5). A failure here never stops the run. */
  getJob?(tabId: number, url: string): Promise<JobSummary | null>;
  /** Optional AI field understanding (Phase 4). Absent or "off" means the run is purely deterministic. */
  classifyAi?(input: AiClassifyInput): Promise<AiClassifyResult>;
  aiRequestLimit?: number;
  loadRuns(): Promise<RunsMap>;
  saveRuns(runs: RunsMap): Promise<void>;
  loadProfile(): Promise<UserProfile | null>;
  injectContent(tabId: number): Promise<void>;
  sendToTab(tabId: number, req: ContentRequest): Promise<ContentResponse>;
  tabInfo(tabId: number): Promise<{ url: string; title: string } | null>;
  /** Resolves true when the tab finished loading a different page after a click that navigated. */
  waitForNavigation?(tabId: number, previousUrl: string, timeoutMs: number, scheduler: Scheduler): Promise<boolean>;
  now(): number;
  newId(): string;
  limits?: Partial<RunLimits>;
}

export type StartResult = { ok: true; run: RunRecord } | ErrorResponse;

const key = (tabId: number) => String(tabId);
const failureKey = (p: PlannedFill) => p.fingerprint ?? `${p.semanticType}|${p.label}`;
const origin = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return url.slice(0, 300);
  }
};

type StepRecord = StepRecordLike;
type OkResponse = Extract<ContentResponse, { ok: true }>;

export class RunManager {
  private runs: RunsMap = {};
  private loaded: Promise<void> | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private starting = new Set<number>();
  private schedulers = new Map<string, Scheduler>();
  private limits: RunLimits;

  constructor(private deps: RunDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
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

  private scheduler(runId: string): Scheduler {
    let s = this.schedulers.get(runId);
    if (!s) this.schedulers.set(runId, (s = new Scheduler()));
    return s;
  }

  /** Test hook: how many timers a run still has pending. */
  pendingTimers(runId: string): number {
    return this.schedulers.get(runId)?.pending ?? 0;
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

  /** Updates a run without changing its state (counters, notes, checkpoints). */
  private async update(runId: string, tabId: number, patch: Partial<RunRecord>): Promise<void> {
    this.assertActive(runId, tabId);
    const run = this.runs[key(tabId)]!;
    this.runs[key(tabId)] = { ...run, ...patch, updatedAt: this.deps.now() };
    await this.persist();
  }

  /** Quick Apply. Guards against a second concurrent run on the same tab before any await. */
  async start(tabId: number, opts: { variantId?: string | null } = {}): Promise<StartResult> {
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
        job: null,
        answers: [],
        steps: [],
        counters: { actions: 0, retries: 0, passes: 0, transitions: 0 },
        notes: [],
        needsPermission: false,
        permissionOrigin: null,
        resume: { status: "not_needed", variantId: null, variantAuto: false, documentId: null, filename: null, pageCount: null, warnings: [], uploaded: [], uploadVerified: false },
        variantOverride: opts.variantId ?? null,
        route: null,
        reason: null,
        ai: { status: "off", requests: 0, cacheHits: 0, accepted: 0, provider: null, error: null },
      };
      this.runs[key(tabId)] = run;
      await this.persist();
      void this.drive(run.runId, tabId, at);
      return { ok: true, run };
    } finally {
      this.starting.delete(tabId);
    }
  }

  /**
   * Continues a run that ended BLOCKED because the page could no longer be read after a navigation. Called only after
   * the user granted the origin from a click. BLOCKED stays terminal: this starts a continuation run that inherits the
   * finished steps, counters, notes and answers, then re-observes the page it is now on (never a replay).
   */
  async resumeAfterGrant(tabId: number): Promise<StartResult> {
    if (this.starting.has(tabId)) return { ok: false, code: "DUPLICATE_RUN", message: "A run is already starting on this tab" };
    this.starting.add(tabId);
    try {
      await this.ensureLoaded();
      const old = this.runs[key(tabId)];
      if (!old || old.state !== "BLOCKED" || !old.needsPermission) {
        return { ok: false, code: "NO_RUN", message: "This run is not waiting for a site permission" };
      }
      const info = await this.deps.tabInfo(tabId);
      if (!info) return { ok: false, code: "INJECTION_FAILED", message: "Tab is not available" };
      const at = this.deps.now();
      const run: RunRecord = {
        ...old,
        runId: this.deps.newId(),
        url: info.url || old.url,
        pageTitle: info.title || old.pageTitle,
        state: "INITIALIZING",
        history: [{ state: "INITIALIZING", at }],
        startedAt: at,
        updatedAt: at,
        resumeCount: old.resumeCount + 1,
        report: null,
        counters: { ...old.counters, transitions: old.counters.transitions + 1 }, // the click that navigated counts
        needsPermission: false,
        permissionOrigin: null,
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
    // Cancel timers first so nothing can fire after Stop, then record the cancellation.
    this.schedulers.get(run.runId)?.cancelAll();
    const next = await this.move(run.runId, tabId, "CANCELLED", { reason: "Stopped by user" }).catch((e) => {
      if (e instanceof Abort) return this.runs[key(tabId)]!;
      throw e;
    });
    // Best effort: tell the page to stop any in-flight actions. The run is already cancelled either way.
    void this.deps.sendToTab(tabId, { kind: "CANCEL" }).catch(() => undefined);
    return { ok: true, run: next };
  }

  /**
   * Called when the service worker wakes. In-flight runs are re-observed, never replayed (SPEC 15.3): the
   * pipeline is idempotent because the mapper skips fields that already hold the profile value, and the
   * checkpointed steps and counters are kept.
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

  private async call(runId: string, tabId: number, req: ContentRequest, timeoutMs = this.limits.stepTimeoutMs): Promise<ContentResponse> {
    this.assertActive(runId, tabId); // a cancelled run must not schedule any further page work
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("Page did not respond in time")), timeoutMs);
    });
    try {
      return await Promise.race([this.deps.sendToTab(tabId, req), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async expect<K extends OkResponse["kind"]>(runId: string, tabId: number, req: ContentRequest, kind: K): Promise<Extract<OkResponse, { kind: K }>> {
    const r = await this.call(runId, tabId, req);
    if (!r.ok) throw new Error(r.message);
    if (r.kind !== kind) throw new Error("Unexpected reply");
    return r as Extract<OkResponse, { kind: K }>;
  }

  private checkDuration(startedAt: number): void {
    if (this.deps.now() - startedAt > this.limits.maxDurationMs) throw new LimitReached("duration", "the time limit for one run");
  }

  private async drive(runId: string, tabId: number, startedAt: number): Promise<void> {
    try {
      await this.pipeline(runId, tabId, startedAt);
    } catch (e) {
      if (e instanceof Abort) return; // cancelled or replaced: nothing further may be scheduled
      const reason = e instanceof Error ? e.message.slice(0, 200) : "Unexpected error";
      await this.move(runId, tabId, "FAILED", { reason }).catch(() => undefined);
    } finally {
      const run = this.runs[key(tabId)];
      if (!run || run.runId !== runId || isTerminal(run.state)) this.schedulers.delete(runId);
    }
  }

  private async pipeline(runId: string, tabId: number, startedAt: number): Promise<void> {
    const cur = () => this.runs[key(tabId)]!;
    const L = this.limits;
    const sched = this.scheduler(runId);
    if (cur().state === "INITIALIZING") await this.move(runId, tabId, "OBSERVING");

    // Everything below is resumable: steps and counters live on the run record, the rest is re-observed.
    const steps: StepRecord[] = cur().steps.map((s) => ({ ...s }));
    const notes: string[] = [...cur().notes];
    let counters = { ...cur().counters };
    let frameWarning = false;
    let answers = [...cur().answers];
    let ai = cur().ai;
    let jobDone = cur().job !== null || steps.length > 0;

    const addNote = (n: string) => {
      if (!notes.includes(n)) notes.push(n);
    };
    const saveCounters = (patch: Partial<typeof counters> = {}) => {
      counters = { ...counters, ...patch };
      return this.update(runId, tabId, { counters, notes, answers, ai });
    };

    // Terminal helpers: every ending carries the real report built from the steps so far.
    const report = (current?: StepRecord): CompletionReport => combineReport(current ? [...steps, current] : steps, notes);
    const blockedWith = async (reason: string, current?: StepRecord, extra: Partial<RunRecord> = {}) => {
      addNote(reason);
      await this.move(runId, tabId, "BLOCKED", { reason, report: report(current), steps: current ? [...steps, current] : steps, counters, notes, answers, ai, ...extra });
    };
    const finishWith = async (state: "READY_FOR_REVIEW" | "PARTIALLY_COMPLETED", current: StepRecord) => {
      const all = [...steps, current];
      await this.move(runId, tabId, state, { report: report(current), steps: all, counters, notes, answers, ai });
    };

    try {
      await this.deps.injectContent(tabId);
    } catch {
      // A run that already finished steps and now cannot read the page lost its permission by navigating; the popup can ask again.
      if (steps.length > 0) {
        return blockedWith("Permission lost after navigation: the browser still does not let ApplyPilot read this page. Allow ApplyPilot on this site from the popup to continue.", undefined, { needsPermission: true });
      }
      return blockedWith("Cannot access this page (restricted page or permission not granted)");
    }
    const profile = await this.deps.loadProfile();

    try {
      for (;;) {
        // ------------------------------------------------------------------ one step (one page of the application)
        const stepIndex = steps.length;
        const acc = new StepAccumulator();
        const attempts = new Map<string, number>();
        const lastReason = new Map<string, string>();
        const disabledSeen = new Map<string, number>();
        const askedClassify = new Set<string>();
        const askedAnswers = new Set<string>();
        const classifyMemo = new Map<string, AcceptedMapping>();
        const aiMapped = new Map<string, { semanticType: string; profileKey: string }>();
        const learnedMapUsed = new Map<string, string>();
        const learnedInputUsed = new Map<string, string>();
        let stepUrl = cur().url;
        let stepTitle = cur().pageTitle;
        let stepFields = 0;
        let lastFields: FormField[] = [];
        let uploadDone = false;
        /** Resume upload for the file inputs of the latest observation. Returns true when the page recognised a file. */
        const runUpload = async (fileFields: FormField[]): Promise<boolean> => {
          this.assertActive(runId, tabId);
          this.checkDuration(startedAt);
          if (counters.actions + fileFields.length > L.maxActions) throw new LimitReached("actions", `${L.maxActions} actions`);
          try {
            const up = await this.deps.uploadResume!({
              tabId,
              runId,
              url: stepUrl,
              fields: fileFields,
              variantId: cur().variantOverride,
              resume: cur().resume,
              scheduler: sched,
              isActive: () => this.runs[key(tabId)]?.runId === runId && !isTerminal(this.runs[key(tabId)]!.state),
              save: (resume) => this.update(runId, tabId, { resume }),
            });
            acc.addPass([], up.results, [], []);
            for (const n of up.notes) addNote(n);
            const verified = up.results.filter((r) => r.outcome === "filled_verified").length;
            counters = { ...counters, actions: counters.actions + verified };
            await this.update(runId, tabId, { resume: up.resume, counters, notes });
            return verified > 0;
          } catch (e) {
            if (e instanceof Abort) throw e;
            addNote("The resume upload step failed unexpectedly; upload the file yourself");
            return false;
          }
        };
        let moreWork = false;

        const stepRecord = (outcome: StepSummary["outcome"], advancedBy: string | null, note: string | null): StepRecord => ({
          index: stepIndex,
          url: origin(stepUrl),
          title: stepTitle.slice(0, 200),
          ...acc.counts(),
          totalFields: acc.list().length,
          advancedBy,
          outcome,
          note,
          results: acc.list().slice(0, 80),
        });

        for (let pass = 0; ; pass++) {
          this.checkDuration(startedAt);
          if (pass >= L.maxPassesPerStep) {
            if (moreWork) throw new LimitReached("passes", `${L.maxPassesPerStep} observe-and-fill passes on one step`);
            break;
          }

          // ---- observe
          const obs = await this.expect(runId, tabId, { kind: "OBSERVE" }, "OBSERVED");
          stepUrl = obs.url;
          // Which path handled this page: recorded for the first observation of the run (and when it changes between steps).
          if (obs.route && (cur().route?.path !== obs.route.path || cur().route?.adapterId !== obs.route.adapterId)) await this.update(runId, tabId, { route: obs.route });
          stepTitle = obs.pageTitle;
          const visible = obs.fields.filter((f) => f.visible);
          stepFields = Math.max(stepFields, visible.length);
          lastFields = obs.fields;

          // ---- blockers and unreadable frames are checked at the start of every step
          if (pass === 0) {
            // "Capture each step" (diagnostics, off by default): a redacted snapshot of this step, stored locally. Never stops a run.
            if (this.deps.captureStep) await this.deps.captureStep(tabId, stepIndex).catch(() => undefined);
            const det = await this.expect(runId, tabId, { kind: "DETECT_BLOCKERS" }, "BLOCKERS");
            if (det.blockers.length > 0) {
              const b = det.blockers[0]!;
              return await blockedWith(`${b.detail}. ApplyPilot never tries to get past this; do it yourself and run Quick Apply again.`, stepRecord("blocked", null, b.type));
            }
            const hidden = det.frames.filter((f) => f.visible && f.width >= 40 && f.height >= 40);
            if (hidden.length > 0 && !frameWarning) {
              frameWarning = true;
              addNote(`${hidden.length} embedded frame(s) on this page cannot be read or filled (${[...new Set(hidden.map((f) => f.origin))].join(", ")}). Any fields inside them need your attention.`);
            }
          }

          // ---- job (first observation of the run only), then discovery
          if (!jobDone) {
            await this.move(runId, tabId, "EXTRACTING_JOB", { url: obs.url, pageTitle: obs.pageTitle });
            let job: JobSummary | null = null;
            if (this.deps.getJob) {
              this.assertActive(runId, tabId);
              job = await this.deps.getJob(tabId, obs.url).catch(() => null);
            }
            jobDone = true;
            await this.move(runId, tabId, "DISCOVERING_FORM", { fieldsDiscovered: visible.length, job });
          } else {
            await this.move(runId, tabId, "DISCOVERING_FORM", { url: obs.url, pageTitle: obs.pageTitle, fieldsDiscovered: visible.length });
          }
          if (visible.length === 0) {
            if (stepIndex === 0 && pass === 0) return await blockedWith("No form fields found on this page", stepRecord("blocked", null, "No form fields"));
            // A later page without inputs (for example a review page): nothing more to fill.
            const last = stepRecord("final", null, "No fields on this page");
            return await finishWith(frameWarning ? "PARTIALLY_COMPLETED" : "READY_FOR_REVIEW", last);
          }
          if (visible.length > L.maxFields) return await blockedWith("Too many form fields for one run", stepRecord("blocked", null, "Too many fields"));
          if (!profile) return await blockedWith("No valid profile saved. Open Settings and complete your profile.", stepRecord("blocked", null, "No profile"));

          // ---- map (deterministic), then AI field understanding, then open-ended answers
          await this.move(runId, tabId, "MAPPING_FIELDS");
          const mapped = await this.expect(runId, tabId, { kind: "MAP", profile }, "MAPPED");
          const plan: PlannedFill[] = [...mapped.plan];
          let skipped: FieldResult[] = [...mapped.skipped];
          const fields: FormField[] = obs.fields;

          let aiAccepted: AcceptedMapping[] = [];
          const limit = this.deps.aiRequestLimit ?? 6;
          const fpOf = new Map(fields.map((f) => [f.fieldId, f.fingerprint]));
          const idOf = new Map(fields.map((f) => [f.fingerprint, f.fieldId]));

          // Learned strategies (SPEC 10.4): verified successes from earlier runs on this portal, used only when the page structure
          // matches. They are hypotheses: everything they produce goes through the normal mapper, executor and verifier.
          const hints = this.deps.learning ? await this.deps.learning.forPage({ url: obs.url, fields }).catch(() => emptyHints()) : emptyHints();
          const learnedMaps: AcceptedMapping[] = [];
          for (const s of skipped) {
            const fp = fpOf.get(s.fieldId);
            const lm = fp ? hints.mappings.get(fp) : undefined;
            if (fp && lm && s.outcome === "unresolved") {
              learnedMaps.push({ fieldId: s.fieldId, semanticType: lm.semanticType, profileKey: lm.profileKey, confidence: 0.9 } as AcceptedMapping);
              learnedMapUsed.set(fp, lm.id);
              askedClassify.add(fp); // already understood: the AI is not asked about it
            }
          }
          // Each field is put to the AI at most once per step: later passes re-use the answer, they never re-ask.
          const unasked = (list: FieldResult[], seen: Set<string>) => list.filter((s) => !seen.has(fpOf.get(s.fieldId) ?? ""));
          const markAsked = (list: FieldResult[], seen: Set<string>) => list.forEach((s) => seen.add(fpOf.get(s.fieldId) ?? ""));
          if (this.deps.classifyAi) {
            this.assertActive(runId, tabId);
            try {
              const fresh = unasked(skipped, askedClassify);
              markAsked(fresh, askedClassify);
              const r = await this.deps.classifyAi({ fields, skipped: fresh, requestsRemaining: Math.max(0, limit - ai.requests) });
              for (const m of r.accepted) {
                const fp = fpOf.get(m.fieldId);
                if (fp) {
                  classifyMemo.set(fp, m);
                  aiMapped.set(fp, { semanticType: m.semanticType, profileKey: m.profileKey });
                }
              }
              // Accepted mappings from earlier passes still apply to fields that remain unresolved (recovery of AI-mapped fields).
              const remembered: AcceptedMapping[] = [];
              for (const [fp, m] of classifyMemo) {
                const id = idOf.get(fp);
                if (id && !r.accepted.some((a) => a.fieldId === id) && skipped.some((s) => s.fieldId === id)) remembered.push({ ...m, fieldId: id });
              }
              aiAccepted = [...r.accepted, ...remembered];
              ai = {
                status: r.status === "off" && ai.status !== "off" ? ai.status : r.status,
                requests: ai.requests + r.requests,
                cacheHits: ai.cacheHits + r.cacheHits,
                accepted: ai.accepted + r.accepted.length,
                provider: r.provider ?? ai.provider,
                error: r.error ?? ai.error,
              };
            } catch {
              ai = { ...ai, status: "unavailable", error: "unexpected" };
            }
          }

          aiAccepted = [...learnedMaps, ...aiAccepted.filter((m) => !learnedMaps.some((l) => l.fieldId === m.fieldId))];
          await this.move(runId, tabId, "PLANNING", { ai });
          if (aiAccepted.length > 0) {
            const mappedAi = await this.expect(
              runId,
              tabId,
              {
                kind: "MAP_AI",
                profile,
                mappings: aiAccepted.map((m) => ({ fieldId: m.fieldId, semanticType: m.semanticType, profileKey: m.profileKey, confidence: m.confidence })),
              },
              "MAPPED",
            );
            const touched = new Set([...mappedAi.plan.map((p) => p.fieldId), ...mappedAi.skipped.map((x) => x.fieldId)]);
            skipped = skipped.filter((x) => !touched.has(x.fieldId));
            plan.push(...mappedAi.plan);
            skipped.push(...mappedAi.skipped);
          }

          if (this.deps.answerQuestions) {
            this.assertActive(runId, tabId);
            try {
              const fresh = unasked(skipped, askedAnswers);
              markAsked(fresh, askedAnswers);
              const r = await this.deps.answerQuestions({ fields, skipped: fresh, profile, url: obs.url, requestsRemaining: Math.max(0, limit - ai.requests) });
              const touched = new Set([...r.plan.map((p) => p.fieldId), ...r.results.map((x) => x.fieldId)]);
              skipped = skipped.filter((x) => !touched.has(x.fieldId));
              plan.push(...r.plan);
              skipped.push(...r.results);
              answers = [...answers.filter((a) => !r.answers.some((n) => n.fieldId === a.fieldId && n.label === a.label)), ...r.answers].slice(-20);
              // Only let this phase change the status when it actually used or failed the AI; "nothing to answer" says nothing.
              const usedAi = r.requests > 0 || r.cacheHits + r.memoryHits > 0 || r.error !== null || r.plan.length > 0;
              ai = {
                ...ai,
                status: !usedAi ? ai.status : ai.status === "unavailable" || r.status === "unavailable" ? "unavailable" : "used",
                requests: ai.requests + r.requests,
                cacheHits: ai.cacheHits + r.cacheHits + r.memoryHits,
                error: ai.error ?? r.error,
              };
            } catch {
              ai = { ...ai, status: "unavailable", error: ai.error ?? "unexpected" };
            }
          }

          // ---- bounded recovery (SPEC 11.7): a field that already failed gets a different strategy, then is given up
          const runnable: PlannedFill[] = [];
          for (const p of plan) {
            const n = attempts.get(failureKey(p)) ?? 0;
            if (n > L.maxRecoveryAttempts) {
              acc.addPass([], [{ fieldId: p.fieldId, label: p.label, outcome: "failed", required: p.required, reason: `Recovery exhausted: ${lastReason.get(failureKey(p)) ?? "the field could not be filled"}`.slice(0, 280), semanticType: p.semanticType, fingerprint: p.fingerprint, executed: false }], [], []);
              continue;
            }
            // A learned input strategy is the FIRST attempt for a field that needed it before (fewer retries next time).
            const li = p.fingerprint ? hints.inputStrategies.get(p.fingerprint) : undefined;
            if (n === 0 && li && !p.strategy) learnedInputUsed.set(p.fingerprint!, li.id);
            runnable.push(n >= L.maxRecoveryAttempts || (n === 0 && li) ? { ...p, strategy: "keyboard" } : p);
          }
          const retrying = runnable.filter((p) => (attempts.get(failureKey(p)) ?? 0) > 0).length;
          if (counters.retries + retrying > L.maxRetries) throw new LimitReached("retries", `${L.maxRetries} retried actions`);
          if (counters.actions + runnable.length > L.maxActions) throw new LimitReached("actions", `${L.maxActions} actions`);

          // ---- fill
          await this.move(runId, tabId, "FILLING", { ai, answers });
          let executed: { fieldId: string; executed: boolean; error: string | null }[] = [];
          let replan = false;
          if (runnable.length > 0) {
            this.checkDuration(startedAt);
            const ex = await this.expect(runId, tabId, { kind: "EXECUTE", plan: runnable }, "EXECUTED");
            executed = ex.results;
            replan = Boolean(ex.replan);
          }
          await this.move(runId, tabId, "VERIFYING");
          let verified: { fieldId: string; verified: boolean; reason: string }[] = [];
          const ran = runnable.filter((p) => executed.find((e) => e.fieldId === p.fieldId)?.executed);
          if (ran.length > 0) verified = (await this.expect(runId, tabId, { kind: "VERIFY", plan: ran }, "VERIFIED")).results;

          if (replan) {
            // The page changed under the plan: not a failure, just plan again from a fresh observation.
            acc.addPass([], skipped, [], []);
            counters = { ...counters, passes: counters.passes + 1 };
            await saveCounters();
            moreWork = true;
            await this.move(runId, tabId, "OBSERVING");
            continue;
          }

          acc.addPass(runnable, skipped, executed, verified);

          // What was learned or confirmed on this pass (verified successes only; personal values never enter the memory).
          if (this.deps.learning) {
            const events: LearnEvent[] = [];
            for (const p of runnable) {
              const fp = p.fingerprint;
              if (!fp) continue;
              const ok = verified.find((v) => v.fieldId === p.fieldId)?.verified === true;
              const lmId = learnedMapUsed.get(fp);
              const liId = learnedInputUsed.get(fp);
              if (lmId) events.push({ type: ok ? "used_ok" : "used_failed", id: lmId });
              if (liId) events.push({ type: ok ? "used_ok" : "used_failed", id: liId });
              if (!ok) continue;
              const am = aiMapped.get(fp);
              if (am && !lmId) events.push({ type: "verified", kind: "field_mapping", host: hints.host, structure: hints.structure, pattern: fingerprintHash(fp), value: { semanticType: am.semanticType, profileKey: am.profileKey } });
              if (p.strategy === "keyboard" && !liId) events.push({ type: "verified", kind: "input_strategy", host: hints.host, structure: hints.structure, pattern: fingerprintHash(fp), value: { inputStrategy: "keyboard" } });
            }
            // one outcome per learned strategy per pass; a field re-planned in a later pass reports again then
            await this.deps.learning.record(events).catch(() => undefined);
            for (const p of runnable) if (p.fingerprint) { learnedMapUsed.delete(p.fingerprint); learnedInputUsed.delete(p.fingerprint); }
          }
          for (const p of runnable) {
            const ok = verified.find((v) => v.fieldId === p.fieldId)?.verified === true;
            if (!ok) {
              const k = failureKey(p);
              attempts.set(k, (attempts.get(k) ?? 0) + 1);
              lastReason.set(k, verified.find((v) => v.fieldId === p.fieldId)?.reason ?? executed.find((e) => e.fieldId === p.fieldId)?.error ?? "not verified");
            }
          }
          counters = { actions: counters.actions + executed.filter((e) => e.executed).length, retries: counters.retries + retrying, passes: counters.passes + 1, transitions: counters.transitions };
          await saveCounters();

          // ---- let the page settle (debounced mutation observer in the page), then decide whether another pass is needed
          if (runnable.length > 0) await this.expect(runId, tabId, { kind: "WAIT_STABLE", quietMs: L.settleQuietMs, maxMs: L.settleMaxMs }, "STABLE");
          const retryable = runnable.some((p) => (attempts.get(failureKey(p)) ?? 0) > 0 && (attempts.get(failureKey(p)) ?? 0) <= L.maxRecoveryAttempts + 1 && !verified.find((v) => v.fieldId === p.fieldId)?.verified);
          // A recognised field that is disabled right now may be enabled a moment later: look again, a bounded number of times.
          const disabledNow = skipped.filter((s) => /disabled or read-only/.test(s.reason) && s.semanticType !== "unknown");
          const waitingOnDisabled = disabledNow.filter((s) => (disabledSeen.get(s.fingerprint ?? s.fieldId) ?? 0) < L.maxRecoveryAttempts);
          for (const s of waitingOnDisabled) disabledSeen.set(s.fingerprint ?? s.fieldId, (disabledSeen.get(s.fingerprint ?? s.fieldId) ?? 0) + 1);
          if (waitingOnDisabled.length > 0) await sched.sleep(L.disabledRetryMs);
          moreWork = runnable.length > 0 || retryable || waitingOnDisabled.length > 0;
          if (!moreWork) {
            // Converged. File fields are handled once the text fields are done (SPEC 12.7, 16); a site that parses the
            // uploaded resume may rewrite fields, so a verified upload is followed by one more observe-map-verify pass.
            const fileFields = lastFields.filter((f) => f.control === "file" && f.visible);
            if (!uploadDone && fileFields.length > 0 && this.deps.uploadResume) {
              uploadDone = true;
              const verifiedUpload = await runUpload(fileFields);
              if (verifiedUpload && pass + 1 < L.maxPassesPerStep) {
                moreWork = true;
                await this.move(runId, tabId, "OBSERVING");
                continue;
              }
            }
            break;
          }
          await this.move(runId, tabId, "OBSERVING");
        }

        // ------------------------------------------------------------------ form-level verification (SPEC 18.2)
        const counts = acc.counts();
        if (counts.requiredUnresolved > 0) {
          const note = `${counts.requiredUnresolved} required field(s) on this page are not filled, so ApplyPilot did not move to the next step`;
          addNote(note);
          return await finishWith(frameWarning ? "PARTIALLY_COMPLETED" : "READY_FOR_REVIEW", stepRecord("stopped", null, note));
        }

        // ------------------------------------------------------------------ next-step detection by context (SPEC 15.1)
        const ctl = await this.expect(runId, tabId, { kind: "CLASSIFY_CONTROLS" }, "CONTROLS");
        const next = ctl.next;
        if (!next) {
          const why = ctl.hasReviewSummary || ctl.isLastStep ? "Reached the final step; it needs your review and submission" : "No safe next-step control was found; stopping for your review";
          return await finishWith(frameWarning ? "PARTIALLY_COMPLETED" : "READY_FOR_REVIEW", stepRecord("final", null, why));
        }
        if (counters.transitions >= L.maxStepTransitions) throw new LimitReached("steps", `${L.maxStepTransitions} step transitions`);

        await this.move(runId, tabId, "ADVANCING_STEP");
        const previousUrl = stepUrl;
        let navigated = false;
        try {
          const nav = await this.expect(runId, tabId, { kind: "NAVIGATE", controlId: next.id, text: next.text }, "NAVIGATED");
          if (!nav.clicked) {
            const note = `Did not move on: ${nav.reason}`;
            addNote(note);
            return await finishWith(frameWarning ? "PARTIALLY_COMPLETED" : "READY_FOR_REVIEW", stepRecord("stopped", null, note));
          }
          if (!nav.changed) {
            const note = `"${next.text}" did not change the page; stopping instead of clicking again`;
            addNote(note);
            return await finishWith(frameWarning ? "PARTIALLY_COMPLETED" : "READY_FOR_REVIEW", stepRecord("stopped", null, note));
          }
        } catch (e) {
          if (e instanceof Abort) throw e;
          // The page unloaded (full navigation) before it could answer: wait for the new page, then re-inject.
          navigated = this.deps.waitForNavigation ? await this.deps.waitForNavigation(tabId, previousUrl, L.navigationTimeoutMs, sched) : false;
          if (!navigated) return await blockedWith("The page did not respond after moving to the next step", stepRecord("blocked", next.text, "No response after next"));
          try {
            await this.deps.injectContent(tabId);
          } catch {
            // The URL of a page we may not read is hidden from us; the popup learns it from the user's own click (activeTab).
            const info = await this.deps.tabInfo(tabId).catch(() => null);
            return await blockedWith(
              "Permission lost after navigation: the browser no longer lets ApplyPilot read this page. Allow ApplyPilot on this site from the popup to continue.",
              stepRecord("advanced", next.text, "Navigated"),
              { needsPermission: true, permissionOrigin: info?.url ? originPattern(info.url) : null },
            );
          }
        }

        // checkpoint (SPEC 15.3): the step is done; resume continues from a fresh observation of the new page
        steps.push(stepRecord("advanced", next.text, null));
        counters = { ...counters, transitions: counters.transitions + 1 };
        await this.update(runId, tabId, { steps, counters, notes, answers, ai });
        await this.move(runId, tabId, "OBSERVING");
        void stepFields;
      }
    } catch (e) {
      if (e instanceof LimitReached) {
        await blockedWith(`Stopped: run limit reached (${e.message}). Review what was filled and continue yourself.`).catch(() => undefined);
        return;
      }
      throw e;
    }
  }
}

export { InvalidTransitionError };
