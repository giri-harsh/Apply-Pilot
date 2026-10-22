import { describe, expect, it, vi } from "vitest";
import { RunManager, type RunDeps } from "@/background/run-manager";
import type { FieldResult, FormField, SemanticType } from "@/shared/form";
import type { ContentRequest, ContentResponse, PlannedFill } from "@/shared/messages";
import { emptyProfile, type UserProfile } from "@/shared/profile";
import type { RunRecord, RunsMap } from "@/shared/run";

/* ------------------------------------------------------------------ a small stateful fake page */

type Def = {
  key: string;
  label: string;
  type: SemanticType;
  required?: boolean;
  /** Visible only once these other fields have been filled (a field revealed by an earlier fill). */
  after?: string[];
  /** The profile has no value for it. */
  unfillable?: boolean;
  /** Number of executions that fail with "disabled" before it works. */
  disabledFor?: number;
  /** Number of verifications that fail (a validation error) before one passes. */
  verifyFailsFor?: number;
  /** Always fails verification. */
  neverVerifies?: boolean;
};

type StepDef = { fields: Def[]; next?: string; /** the click unloads the page instead of answering */ unload?: boolean };

type PageOpts = {
  steps: StepDef[];
  blockers?: { type: "captcha" | "mfa" | "login"; detail: string }[];
  frames?: { origin: string; accessible: boolean; visible: boolean; width: number; height: number }[];
  replanOnce?: boolean;
  /** NAVIGATE says it clicked but nothing changed. */
  navigateNoChange?: boolean;
  /** NAVIGATE refuses. */
  navigateRefused?: boolean;
  /** Fields that reveal one more field every time they are observed (never converges). */
  endlessFields?: boolean;
};

function profile(): UserProfile {
  const p = emptyProfile();
  p.personal.email = "a@b.co";
  p.personal.provenance.email = { source: "user_entered", recordedAt: new Date(0).toISOString() };
  return p;
}

class FakePage {
  step = 0;
  filled = new Set<string>();
  calls: ContentRequest[] = [];
  executeBatches: PlannedFill[][] = [];
  navigateCalls = 0;
  private disabledLeft = new Map<string, number>();
  private verifyFailsLeft = new Map<string, number>();
  private replanned = false;
  private extra = 0;

  constructor(readonly opts: PageOpts) {
    for (const s of opts.steps) for (const d of s.fields) {
      this.disabledLeft.set(d.key, d.disabledFor ?? 0);
      this.verifyFailsLeft.set(d.key, d.verifyFailsFor ?? 0);
    }
  }

  private defs(): Def[] {
    const s = this.opts.steps[this.step]!;
    const base = s.fields.filter((d) => (d.after ?? []).every((k) => this.filled.has(k)));
    if (!this.opts.endlessFields) return base;
    return [...base, ...Array.from({ length: this.extra }, (_, i) => ({ key: `dyn${i}`, label: `Dynamic ${i}`, type: "city" as SemanticType }))];
  }

  private fieldOf(d: Def, i: number): FormField {
    return {
      fieldId: `field_${String(i + 1).padStart(3, "0")}`, tagName: "input", inputType: "text", control: "text", label: d.label, labelSource: "explicit_label",
      signals: [], name: d.key, elementId: "", autocomplete: "", placeholder: null, ariaLabel: null, required: Boolean(d.required), visible: true, enabled: true,
      options: [], currentValue: this.filled.has(d.key) ? "x" : "", sectionContext: "", semanticCandidates: [d.type], semanticType: d.type, confidence: 0.99,
      ambiguous: false, ambiguityReason: null, risk: "low", fingerprint: `s${this.step}:${d.key}`, widget: "native", limit: null, invalid: false,
    };
  }

  handle(req: ContentRequest): ContentResponse {
    this.calls.push(req);
    const defs = this.defs();
    switch (req.kind) {
      case "OBSERVE": {
        if (this.opts.endlessFields) this.extra++;
        const d2 = this.defs();
        return { ok: true, kind: "OBSERVED", url: `http://x.test/step${this.step}`, pageTitle: `Step ${this.step + 1}`, fields: d2.map((d, i) => this.fieldOf(d, i)) };
      }
      case "DETECT_BLOCKERS":
        return { ok: true, kind: "BLOCKERS", blockers: this.opts.blockers ?? [], frames: this.opts.frames ?? [] };
      case "MAP": {
        const plan: PlannedFill[] = [];
        const skipped: FieldResult[] = [];
        defs.forEach((d, i) => {
          const f = this.fieldOf(d, i);
          const base = { fieldId: f.fieldId, label: d.label, required: Boolean(d.required), semanticType: d.type, fingerprint: f.fingerprint };
          if (this.filled.has(d.key)) skipped.push({ ...base, outcome: "already_correct", reason: "Field already holds the profile value" });
          else if (d.unfillable) skipped.push({ ...base, outcome: "unresolved", reason: "Profile has no value for this field" });
          else plan.push({ ...base, action: { type: "fill_text", fieldId: f.fieldId, value: "v" } });
        });
        return { ok: true, kind: "MAPPED", plan, skipped };
      }
      case "EXECUTE": {
        this.executeBatches.push(req.plan);
        if (this.opts.replanOnce && !this.replanned) {
          this.replanned = true;
          return { ok: true, kind: "EXECUTED", replan: true, results: req.plan.map((p) => ({ fieldId: p.fieldId, executed: false, error: "Page changed since planning" })) };
        }
        const byId = new Map(defs.map((d, i) => [this.fieldOf(d, i).fieldId, d]));
        return {
          ok: true,
          kind: "EXECUTED",
          replan: false,
          results: req.plan.map((p) => {
            const d = byId.get(p.fieldId);
            if (!d) return { fieldId: p.fieldId, executed: false, error: "Target field does not exist" };
            const left = this.disabledLeft.get(d.key) ?? 0;
            if (left > 0) {
              this.disabledLeft.set(d.key, left - 1);
              return { fieldId: p.fieldId, executed: false, error: "Target is disabled or read-only" };
            }
            this.filled.add(d.key);
            return { fieldId: p.fieldId, executed: true, error: null };
          }),
        };
      }
      case "VERIFY": {
        const byId = new Map(defs.map((d, i) => [this.fieldOf(d, i).fieldId, d]));
        return {
          ok: true,
          kind: "VERIFIED",
          results: req.plan.map((p) => {
            const d = byId.get(p.fieldId);
            const left = d ? (this.verifyFailsLeft.get(d.key) ?? 0) : 0;
            if (d && (d.neverVerifies || left > 0)) {
              this.verifyFailsLeft.set(d.key, Math.max(0, left - 1));
              this.filled.delete(d.key);
              return { fieldId: p.fieldId, verified: false, reason: "Validation message: Enter a valid value" };
            }
            return { fieldId: p.fieldId, verified: Boolean(d), reason: "ok" };
          }),
        };
      }
      case "WAIT_STABLE":
        return { ok: true, kind: "STABLE", mutations: 0, waitedMs: 1, timedOut: false };
      case "CLASSIFY_CONTROLS": {
        const s = this.opts.steps[this.step]!;
        const next = s.next ? { id: "ctl_001", text: s.next, role: "next" as const, reasons: ["progression wording"] } : null;
        return {
          ok: true, kind: "CONTROLS", controls: next ? [next] : [{ id: "ctl_001", text: "Submit application", role: "final", reasons: ["final wording"] }],
          isLastStep: !next, hasReviewSummary: !next, stepIndicator: null, next,
        };
      }
      case "NAVIGATE": {
        this.navigateCalls++;
        if (this.opts.navigateRefused) return { ok: true, kind: "NAVIGATED", clicked: false, changed: false, reason: "The control is no longer a safe next-step control" };
        if (this.opts.navigateNoChange) return { ok: true, kind: "NAVIGATED", clicked: true, changed: false, reason: "" };
        const unload = this.opts.steps[this.step]!.unload;
        this.step++;
        if (unload) throw new Error("The message channel closed before a response was received");
        return { ok: true, kind: "NAVIGATED", clicked: true, changed: true, reason: "" };
      }
      case "CANCEL":
        return { ok: true, kind: "CANCELLED" };
      default:
        return { ok: true, kind: "PONG" };
    }
  }
}

function setup(page: FakePage, over: Partial<RunDeps> = {}, initial: RunsMap = {}) {
  let store: RunsMap = structuredClone(initial);
  let t = 1000;
  let n = 0;
  const deps: RunDeps = {
    loadRuns: async () => structuredClone(store),
    saveRuns: async (r) => {
      store = structuredClone(r);
    },
    loadProfile: async () => profile(),
    injectContent: async () => undefined,
    sendToTab: async (_tab, req) => page.handle(req),
    tabInfo: async () => ({ url: "http://x.test/", title: "T" }),
    waitForNavigation: async () => true,
    now: () => (t += 10),
    newId: () => `run-${String(++n).padStart(8, "0")}`,
    ...over,
  };
  return { deps, store: () => store, mgr: new RunManager(deps), advance: (ms: number) => (t += ms) };
}

const single = (fields: Def[]): PageOpts => ({ steps: [{ fields }] });
const email: Def = { key: "email", label: "Email", type: "email", required: true };

async function until(mgr: RunManager, tab: number, pred: (s: string) => boolean) {
  await vi.waitFor(async () => {
    const r = await mgr.get(tab);
    expect(pred(r?.state ?? "")).toBe(true);
  });
}
const final = (s: string) => ["READY_FOR_REVIEW", "PARTIALLY_COMPLETED", "BLOCKED", "FAILED", "CANCELLED"].includes(s);
const states = (r: RunRecord) => r.history.map((h) => h.state);

/* ------------------------------------------------------------------ tests */

describe("RunManager: single page", () => {
  it("fills, re-observes once to confirm convergence, and ends READY_FOR_REVIEW with real counts", async () => {
    const page = new FakePage(single([email]));
    const { mgr } = setup(page);
    expect((await mgr.start(1)).ok).toBe(true);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(states(run)).toEqual([
      "INITIALIZING", "OBSERVING", "EXTRACTING_JOB", "DISCOVERING_FORM", "MAPPING_FIELDS", "PLANNING", "FILLING", "VERIFYING",
      "OBSERVING", "DISCOVERING_FORM", "MAPPING_FIELDS", "PLANNING", "FILLING", "VERIFYING", "READY_FOR_REVIEW",
    ]);
    expect(run.report).toMatchObject({ totalFields: 1, filled: 1, verified: 1, failed: 0 });
    expect(run.report!.steps).toHaveLength(1);
    expect(run.fieldsDiscovered).toBe(1);
    expect(page.executeBatches).toHaveLength(1); // the second pass found nothing left to do
  });

  it("blocks honestly after inspecting when there is no profile, or no fields, or no access", async () => {
    const noProfile = setup(new FakePage(single([email])), { loadProfile: async () => null });
    await noProfile.mgr.start(1);
    await until(noProfile.mgr, 1, final);
    expect(await noProfile.mgr.get(1)).toMatchObject({ state: "BLOCKED", fieldsDiscovered: 1, reason: expect.stringMatching(/profile/i) });

    const empty = setup(new FakePage(single([])));
    await empty.mgr.start(1);
    await until(empty.mgr, 1, final);
    expect((await empty.mgr.get(1))!.reason).toMatch(/no form fields/i);

    const denied = setup(new FakePage(single([email])), { injectContent: async () => Promise.reject(new Error("no access")) });
    await denied.mgr.start(1);
    await until(denied.mgr, 1, final);
    expect((await denied.mgr.get(1))!.reason).toMatch(/cannot access/i);
  });

  it("rejects a second concurrent run on the same tab (also when started in the same tick) but allows another tab", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { mgr } = setup(new FakePage(single([email])), { injectContent: async () => void (await gate) });
    const [a, b] = await Promise.all([mgr.start(1), mgr.start(1)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await mgr.start(2)).ok).toBe(true);
    release();
    await until(mgr, 1, final);
  });

  it("allows a new run after the previous one finished, and persists every transition", async () => {
    const { mgr, store, deps } = setup(new FakePage(single([email])));
    await mgr.start(1);
    await until(mgr, 1, final);
    expect(store()["1"]!.state).toBe("READY_FOR_REVIEW");
    expect((await new RunManager(deps).get(1))!.report?.verified).toBe(1);
    expect((await mgr.start(1)).ok).toBe(true);
  });

  it("a failing reply from the page ends the run FAILED with a safe reason; a silent page times out", async () => {
    const failing = setup(new FakePage(single([email])), { sendToTab: async () => ({ ok: false, code: "INTERNAL", message: "kaput" }) });
    await failing.mgr.start(1);
    await until(failing.mgr, 1, final);
    expect(await failing.mgr.get(1)).toMatchObject({ state: "FAILED", reason: "kaput" });

    const silent = setup(new FakePage(single([email])), { sendToTab: () => new Promise(() => undefined), limits: { stepTimeoutMs: 20 } });
    await silent.mgr.start(1);
    await until(silent.mgr, 1, final);
    expect((await silent.mgr.get(1))!.reason).toMatch(/did not respond/);
  });
});

describe("RunManager: dynamic fields, multiple steps and form-level verification", () => {
  it("maps a field revealed by an earlier fill in the next pass (the country -> state case)", async () => {
    const page = new FakePage(single([{ key: "country", label: "Country", type: "country" }, { key: "state", label: "State", type: "state", after: ["country"] }]));
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(page.filled).toEqual(new Set(["country", "state"]));
    expect(run.report).toMatchObject({ totalFields: 2, filled: 2, verified: 2 });
    expect(page.executeBatches.map((b) => b.length)).toEqual([1, 1]);
  });

  it("completes every non-final step unattended and stops at the final one without clicking anything", async () => {
    const page = new FakePage({
      steps: [
        { fields: [email], next: "Next" },
        { fields: [{ key: "city", label: "City", type: "city", required: true }], next: "Continue" },
        { fields: [{ key: "gh", label: "GitHub", type: "github" }], next: undefined },
      ],
    });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(page.navigateCalls).toBe(2);
    expect(page.step).toBe(2);
    expect(run.steps.map((s) => s.outcome)).toEqual(["advanced", "advanced", "final"]);
    expect(run.report!.steps.map((s) => [s.index, s.outcome, s.advancedBy, s.verified])).toEqual([[0, "advanced", "Next", 1], [1, "advanced", "Continue", 1], [2, "final", null, 1]]);
    expect(run.report).toMatchObject({ verified: 3, failed: 0 });
    expect(run.counters.transitions).toBe(2);
    expect(states(run)).toContain("ADVANCING_STEP");
  });

  it("does not advance while a required field is unresolved", async () => {
    const page = new FakePage({ steps: [{ fields: [email, { key: "sid", label: "Student ID", type: "unknown", required: true, unfillable: true }], next: "Next" }, { fields: [] }] });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(page.navigateCalls).toBe(0);
    expect(run.notes.join(" ")).toMatch(/required field/);
    expect(run.report!.steps[0]).toMatchObject({ outcome: "stopped", requiredUnresolved: 1 });
  });

  it("stops when the next control is refused or does nothing, instead of clicking again", async () => {
    const refused = new FakePage({ steps: [{ fields: [email], next: "Next" }, { fields: [] }], navigateRefused: true });
    const a = setup(refused);
    await a.mgr.start(1);
    await until(a.mgr, 1, final);
    expect((await a.mgr.get(1))!.notes.join(" ")).toMatch(/Did not move on/);
    expect(refused.navigateCalls).toBe(1);

    const nochange = new FakePage({ steps: [{ fields: [email], next: "Next" }, { fields: [] }], navigateNoChange: true });
    const b = setup(nochange);
    await b.mgr.start(1);
    await until(b.mgr, 1, final);
    expect((await b.mgr.get(1))!.notes.join(" ")).toMatch(/did not change the page/);
    expect(nochange.navigateCalls).toBe(1);
  });

  it("a later page with no inputs (review) ends the run READY_FOR_REVIEW", async () => {
    const page = new FakePage({ steps: [{ fields: [email], next: "Next" }, { fields: [] }] });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    expect(await mgr.get(1)).toMatchObject({ state: "READY_FOR_REVIEW" });
  });
});

describe("RunManager: bounded recovery (SPEC 11.7)", () => {
  it("recovers a field that fails once, using a fresh observation, without counting a page change as a failure", async () => {
    const page = new FakePage({ ...single([{ ...email, verifyFailsFor: 1 }]), replanOnce: true });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.report).toMatchObject({ verified: 1, failed: 0 });
    expect(page.executeBatches.length).toBeGreaterThanOrEqual(3); // replan + first try + recovery
    expect(run.counters.retries).toBe(1);
  });

  it("a transient 'disabled' field is retried on the next pass and then filled", async () => {
    const page = new FakePage(single([{ ...email, disabledFor: 1 }]));
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    expect((await mgr.get(1))!.report).toMatchObject({ verified: 1, failed: 0 });
  });

  it("a field that never works is tried three times (default, default, keyboard) and then given up with a reason", async () => {
    const page = new FakePage(single([{ ...email, neverVerifies: true }]));
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    const strategies = page.executeBatches.flat().map((p) => p.strategy ?? "default");
    expect(strategies).toEqual(["default", "default", "keyboard"]);
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(run.report).toMatchObject({ verified: 0, failed: 1, requiredUnresolved: 1 });
    expect(run.report!.results[0]!.reason).toMatch(/Recovery exhausted/);
    expect(run.counters.actions).toBe(3); // bounded: never a fourth try
  });

  it("a permanently disabled field is reported, not retried forever", async () => {
    const page = new FakePage(single([{ ...email, disabledFor: 99 }]));
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(page.executeBatches.flat().length).toBeLessThanOrEqual(3);
    expect(run.report!.results[0]!.outcome).toBe("failed");
  });
});

describe("RunManager: run limits (SPEC 21.2) always terminate", () => {
  const blocked = async (page: FakePage, limits: Partial<NonNullable<RunDeps["limits"]>>, extra: Partial<RunDeps> = {}) => {
    const s = setup(page, { limits, ...extra });
    await s.mgr.start(1);
    await until(s.mgr, 1, final);
    return { run: (await s.mgr.get(1))!, ...s };
  };

  it("actions", async () => {
    const page = new FakePage(single([email, { key: "a", label: "A", type: "city" }, { key: "b", label: "B", type: "state" }]));
    const { run } = await blocked(page, { maxActions: 2 });
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toMatch(/limit reached.*2 actions/);
    expect(page.executeBatches).toHaveLength(0); // checked before executing anything
  });

  it("passes: fields that keep appearing stop at the per-step pass limit", async () => {
    const { run, deps } = await blocked(new FakePage({ ...single([email]), endlessFields: true }), { maxPassesPerStep: 3 });
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toMatch(/3 observe-and-fill passes/);
    expect(run.counters.passes).toBeLessThanOrEqual(3);
    void deps;
  });

  it("step transitions: an endless chain of steps stops", async () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ fields: [{ key: `f${i}`, label: "City", type: "city" as SemanticType }], next: "Next" }));
    const { run } = await blocked(new FakePage({ steps }), { maxStepTransitions: 3 });
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toMatch(/3 step transitions/);
    expect(run.steps).toHaveLength(3);
  });

  it("retries", async () => {
    const page = new FakePage(single([{ ...email, neverVerifies: true }]));
    const { run } = await blocked(page, { maxRetries: 1 });
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toMatch(/1 retried actions/);
  });

  it("duration", async () => {
    let jump = false;
    const page = new FakePage(single([email]));
    const s = setup(page, { sendToTab: async (_t, req) => { if (req.kind === "MAP") jump = true; return page.handle(req); } });
    s.deps.now = () => (jump ? 10_000_000 : 1000);
    const mgr = new RunManager({ ...s.deps, limits: { maxDurationMs: 5000 } });
    await mgr.start(1);
    await until(mgr, 1, final);
    expect((await mgr.get(1))!.reason).toMatch(/time limit/);
  });

  it("a blocked run still carries the real report of what was done", async () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({ fields: [{ key: `f${i}`, label: "City", type: "city" as SemanticType }], next: "Next" }));
    const { run } = await blocked(new FakePage({ steps }), { maxStepTransitions: 2 });
    expect(run.report!.verified).toBeGreaterThanOrEqual(2);
    expect(run.report!.notes.join(" ")).toMatch(/limit/);
  });
});

describe("RunManager: blockers, frames and navigation", () => {
  it.each([
    ["captcha", "A CAPTCHA or human-verification check is on this page"],
    ["mfa", "A verification code (MFA / one-time code) is required"],
    ["login", "This page asks you to sign in"],
  ] as const)("%s blocks the run before anything is filled", async (type, detail) => {
    const page = new FakePage({ ...single([email]), blockers: [{ type, detail }] });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toContain(detail);
    expect(run.reason).toMatch(/never tries to get past/);
    expect(page.executeBatches).toHaveLength(0);
    expect(page.filled.size).toBe(0);
  });

  it("an unreadable embedded frame is reported and the run ends PARTIALLY_COMPLETED, never silent success", async () => {
    const page = new FakePage({ ...single([email]), frames: [{ origin: "http://other.test", accessible: false, visible: true, width: 500, height: 400 }, { origin: "http://pixel.test", accessible: false, visible: true, width: 1, height: 1 }] });
    const { mgr } = setup(page);
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("PARTIALLY_COMPLETED");
    expect(run.report!.notes.join(" ")).toMatch(/1 embedded frame\(s\).*http:\/\/other\.test/);
    expect(run.report!.notes.join(" ")).not.toMatch(/pixel/);
    expect(run.report!.verified).toBe(1);
  });

  it("after a click that unloads the page it waits for the new page, re-injects, and continues", async () => {
    const page = new FakePage({ steps: [{ fields: [email], next: "Next", unload: true }, { fields: [{ key: "city", label: "City", type: "city" }] }] });
    const inject = vi.fn(async () => undefined);
    const wait = vi.fn(async () => true);
    const { mgr } = setup(page, { injectContent: inject, waitForNavigation: wait });
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(wait).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledTimes(2); // start + after navigation
    expect(run.report).toMatchObject({ verified: 2 });
  });

  it("permission lost after navigation: BLOCKED with that reason (production activeTab case)", async () => {
    const page = new FakePage({ steps: [{ fields: [email], next: "Next", unload: true }, { fields: [{ key: "city", label: "City", type: "city" }] }] });
    let n = 0;
    const { mgr } = setup(page, { injectContent: async () => { if (++n > 1) throw new Error("Cannot access contents of the page"); } });
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("BLOCKED");
    expect(run.reason).toMatch(/Permission lost after navigation/);
    expect(run.report!.verified).toBe(1); // the first page's work is kept
  });

  it("a page that never loads after next blocks the run", async () => {
    const page = new FakePage({ steps: [{ fields: [email], next: "Next", unload: true }, { fields: [] }] });
    const { mgr } = setup(page, { waitForNavigation: async () => false });
    await mgr.start(1);
    await until(mgr, 1, final);
    expect((await mgr.get(1))!.reason).toMatch(/did not respond after moving/);
  });
});

describe("RunManager: cancellation", () => {
  it("Stop halts immediately: no further page calls, no pending timers", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const page = new FakePage(single([email]));
    const { mgr } = setup(page, { injectContent: async () => void (await gate) });
    const started = await mgr.start(1);
    const runId = started.ok ? started.run.runId : "";
    expect((await mgr.stop(1)).ok).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 60));
    expect((await mgr.get(1))!.state).toBe("CANCELLED");
    expect(page.calls.filter((c) => c.kind !== "CANCEL")).toEqual([]);
    expect(mgr.pendingTimers(runId)).toBe(0);
  });

  it("Stop during navigation wait cancels the scheduler's timers", async () => {
    const page = new FakePage({ steps: [{ fields: [email], next: "Next", unload: true }, { fields: [] }] });
    let sched: { cancelAll(): void; pending: number } | undefined;
    const { mgr } = setup(page, {
      waitForNavigation: async (_t, _u, _ms, s) => {
        sched = s;
        await s.sleep(60_000); // would hold the run for a minute if Stop did not cancel it
        return true;
      },
    });
    await mgr.start(1);
    await vi.waitFor(() => expect(sched?.pending).toBe(1));
    await mgr.stop(1);
    expect(sched!.pending).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    expect((await mgr.get(1))!.state).toBe("CANCELLED");
    expect(page.navigateCalls).toBe(1);
  });

  it("stop with no active run reports NO_RUN", async () => {
    const { mgr } = setup(new FakePage(single([email])));
    expect(await mgr.stop(9)).toMatchObject({ ok: false, code: "NO_RUN" });
  });
});

describe("service worker restart (rehydration)", () => {
  async function finished() {
    const first = setup(new FakePage(single([email])));
    await first.mgr.start(7);
    await until(first.mgr, 7, final);
    return first;
  }
  const interrupted = async (state: RunRecord["state"], extra: Partial<RunRecord> = {}) => {
    const first = await finished();
    const snap = structuredClone(first.store());
    snap["7"] = { ...snap["7"]!, state, report: null, reason: null, steps: [], ...extra };
    return snap;
  };

  it.each(["OBSERVING", "FILLING", "VERIFYING", "ADVANCING_STEP", "PLANNING"] as const)("re-observes and finishes a run interrupted in %s", async (state) => {
    const snap = await interrupted(state);
    const page = new FakePage(single([email]));
    const { mgr } = setup(page, {}, snap);
    await mgr.rehydrate();
    await until(mgr, 7, final);
    const run = (await mgr.get(7))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(run.resumeCount).toBe(1);
    expect(page.calls[0]!.kind).toBe("OBSERVE"); // starts from a fresh observation, not a replay
  });

  it("keeps finished steps and counters, and continues on the page the browser is now on", async () => {
    const done = { index: 0, url: "http://x.test/step0", title: "Step 1", totalFields: 1, filled: 1, verified: 1, failed: 0, skippedSensitive: 0, ambiguous: 0, unresolved: 0, alreadyCorrect: 0, requiredUnresolved: 0, advancedBy: "Next", outcome: "advanced" as const, note: null, results: [] };
    const snap = await interrupted("FILLING", { steps: [done], counters: { actions: 1, retries: 0, passes: 1, transitions: 1 } });
    const page = new FakePage({ steps: [{ fields: [] }, { fields: [{ key: "city", label: "City", type: "city" }] }] });
    page.step = 1;
    const { mgr } = setup(page, {}, snap);
    await mgr.rehydrate();
    await until(mgr, 7, final);
    const run = (await mgr.get(7))!;
    expect(run.steps[0]).toMatchObject({ index: 0, outcome: "advanced" });
    expect(run.report!.steps.map((s) => s.index)).toEqual([0, 1]);
    expect(run.counters.actions).toBe(2);
    expect(page.executeBatches.flat().map((p) => p.label)).toEqual(["City"]); // nothing from step 0 was replayed
  });

  it("fails an interrupted run whose tab no longer exists, and leaves finished runs untouched", async () => {
    const snap = await interrupted("FILLING");
    const gone = setup(new FakePage(single([email])), { tabInfo: async () => null }, snap);
    await gone.mgr.rehydrate();
    expect(await gone.mgr.get(7)).toMatchObject({ state: "FAILED", reason: expect.stringMatching(/tab/i) });

    const first = await finished();
    const page = new FakePage(single([email]));
    const { mgr } = setup(page, {}, first.store());
    await mgr.rehydrate();
    expect((await mgr.get(7))!.state).toBe("READY_FOR_REVIEW");
    expect(page.calls).toEqual([]);
  });
});

describe("RunManager: job and AI hooks never stop a run", () => {
  const summary = { title: "ML Intern", company: "Acme", confidence: 0.9, warnings: [], skills: ["Python"], descriptionChars: 100, fromCache: false, matchScore: 70, topProjects: [] };

  it("stores the detected job once; an extraction failure never stops the run; a job is kept without a form", async () => {
    const ok = setup(new FakePage(single([email])), { getJob: vi.fn(async () => summary) });
    await ok.mgr.start(1);
    await until(ok.mgr, 1, final);
    expect((await ok.mgr.get(1))!.job).toEqual(summary);
    expect(ok.deps.getJob).toHaveBeenCalledTimes(1); // not again on later passes

    const bad = setup(new FakePage(single([email])), { getJob: async () => { throw new Error("boom"); } });
    await bad.mgr.start(1);
    await until(bad.mgr, 1, final);
    expect(await bad.mgr.get(1)).toMatchObject({ state: "READY_FOR_REVIEW", job: null });

    const noForm = setup(new FakePage(single([])), { getJob: async () => summary });
    await noForm.mgr.start(1);
    await until(noForm.mgr, 1, final);
    expect(await noForm.mgr.get(1)).toMatchObject({ state: "BLOCKED", job: { company: "Acme" } });
  });

  it("an AI hook that throws leaves the deterministic run intact", async () => {
    const { mgr } = setup(new FakePage(single([email])), {
      classifyAi: async () => { throw new Error("x"); },
      answerQuestions: async () => { throw new Error("y"); },
    });
    await mgr.start(1);
    await until(mgr, 1, final);
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("READY_FOR_REVIEW");
    expect(run.ai.status).toBe("unavailable");
  });
});
