import { describe, expect, it, vi } from "vitest";
import { RunManager, type RunDeps } from "@/background/run-manager";
import type { ContentRequest, ContentResponse } from "@/shared/messages";
import type { FormField } from "@/shared/form";
import { emptyProfile, type UserProfile } from "@/shared/profile";
import type { RunsMap } from "@/shared/run";

function field(over: Partial<FormField> = {}): FormField {
  return {
    fieldId: "field_001", tagName: "input", inputType: "email", control: "text", label: "Email", labelSource: "explicit_label",
    signals: [], name: "email", elementId: "", autocomplete: "", placeholder: null, ariaLabel: null, required: true, visible: true,
    enabled: true, options: [], currentValue: "", sectionContext: "", semanticCandidates: ["email"], semanticType: "email",
    confidence: 0.99, ambiguous: false, ambiguityReason: null, risk: "low", fingerprint: "x", widget: "native", ...over,
  };
}

function profile(): UserProfile {
  const p = emptyProfile();
  p.personal.email = "a@b.co";
  p.personal.provenance.email = { source: "user_entered", recordedAt: new Date(0).toISOString() };
  return p;
}

function setup(over: Partial<RunDeps> = {}, initial: RunsMap = {}) {
  let store: RunsMap = structuredClone(initial);
  let t = 1000;
  let n = 0;
  const calls: ContentRequest[] = [];
  const deps: RunDeps = {
    loadRuns: async () => structuredClone(store),
    saveRuns: async (r) => {
      store = structuredClone(r);
    },
    loadProfile: async () => profile(),
    injectContent: async () => undefined,
    sendToTab: async (_tab, req): Promise<ContentResponse> => {
      calls.push(req);
      switch (req.kind) {
        case "OBSERVE":
          return { ok: true, kind: "OBSERVED", url: "http://x.test/", pageTitle: "T", fields: [field()] };
        case "MAP":
          return {
            ok: true, kind: "MAPPED", skipped: [],
            plan: [{ fieldId: "field_001", action: { type: "fill_text", fieldId: "field_001", value: "a@b.co" }, semanticType: "email", label: "Email", required: true }],
          };
        case "EXECUTE":
          return { ok: true, kind: "EXECUTED", results: [{ fieldId: "field_001", executed: true, error: null }] };
        case "VERIFY":
          return { ok: true, kind: "VERIFIED", results: [{ fieldId: "field_001", verified: true, reason: "ok" }] };
        case "CANCEL":
          return { ok: true, kind: "CANCELLED" };
        default:
          return { ok: true, kind: "PONG" };
      }
    },
    tabInfo: async () => ({ url: "http://x.test/", title: "T" }),
    now: () => (t += 10),
    newId: () => `run-${String(++n).padStart(8, "0")}`,
    ...over,
  };
  return { deps, calls, store: () => store, mgr: new RunManager(deps) };
}

async function until(mgr: RunManager, tab: number, pred: (s: string) => boolean) {
  await vi.waitFor(async () => {
    const r = await mgr.get(tab);
    expect(pred(r?.state ?? "")).toBe(true);
  });
}

describe("RunManager", () => {
  it("drives a run to READY_FOR_REVIEW with a report built from real results", async () => {
    const { mgr } = setup();
    const r = await mgr.start(1);
    expect(r.ok).toBe(true);
    await until(mgr, 1, (s) => s === "READY_FOR_REVIEW");
    const run = (await mgr.get(1))!;
    expect(run.fieldsDiscovered).toBe(1);
    expect(run.report).toMatchObject({ filled: 1, verified: 1, failed: 0 });
    expect(run.history.map((h) => h.state)).toEqual([
      "INITIALIZING", "OBSERVING", "DISCOVERING_FORM", "MAPPING_FIELDS", "PLANNING", "FILLING", "VERIFYING", "READY_FOR_REVIEW",
    ]);
  });

  it("blocks honestly (after inspecting) when no profile exists", async () => {
    const { mgr } = setup({ loadProfile: async () => null });
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "BLOCKED");
    const run = (await mgr.get(1))!;
    expect(run.fieldsDiscovered).toBe(1);
    expect(run.reason).toMatch(/profile/i);
  });

  it("blocks when the page has no form fields", async () => {
    const { mgr } = setup({
      sendToTab: async () => ({ ok: true, kind: "OBSERVED", url: "http://x.test/", pageTitle: "T", fields: [] }),
    });
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "BLOCKED");
    expect((await mgr.get(1))!.reason).toMatch(/no form fields/i);
  });

  it("blocks when the page cannot be injected", async () => {
    const { mgr } = setup({
      injectContent: async () => {
        throw new Error("Cannot access chrome:// URL");
      },
    });
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "BLOCKED");
  });

  it("rejects a second concurrent run on the same tab but allows another tab", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { mgr } = setup({
      injectContent: async () => {
        await gate;
      },
    });
    const first = await mgr.start(1);
    const dup = await mgr.start(1);
    const other = await mgr.start(2);
    expect(first.ok).toBe(true);
    expect(dup).toMatchObject({ ok: false, code: "DUPLICATE_RUN" });
    expect(other.ok).toBe(true);
    release();
    await until(mgr, 1, (s) => s === "READY_FOR_REVIEW");
  });

  it("rejects simultaneous start calls issued in the same tick", async () => {
    const { mgr } = setup();
    const [a, b] = await Promise.all([mgr.start(5), mgr.start(5)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  it("allows a new run after the previous one finished", async () => {
    const { mgr } = setup();
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "READY_FOR_REVIEW");
    const again = await mgr.start(1);
    expect(again.ok).toBe(true);
  });

  it("cancellation stops the pipeline: no further content requests are sent", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { mgr, calls } = setup({
      injectContent: async () => {
        await gate;
      },
    });
    await mgr.start(1);
    const stopped = await mgr.stop(1);
    expect(stopped.ok).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 50));
    const run = (await mgr.get(1))!;
    expect(run.state).toBe("CANCELLED");
    expect(calls.filter((c) => c.kind !== "CANCEL")).toEqual([]);
  });

  it("stop with no active run reports NO_RUN", async () => {
    const { mgr } = setup();
    expect(await mgr.stop(9)).toMatchObject({ ok: false, code: "NO_RUN" });
  });

  it("a failing page reply moves the run to FAILED with a safe reason", async () => {
    const { mgr } = setup({
      sendToTab: async () => ({ ok: false, code: "INTERNAL", message: "kaput" }),
    });
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "FAILED");
    expect((await mgr.get(1))!.reason).toBe("kaput");
  });

  it("times out when the page never answers", async () => {
    const { mgr } = setup({
      sendToTab: () => new Promise(() => undefined),
      limits: { maxDurationMs: 90_000, maxFields: 300, stepTimeoutMs: 20 },
    });
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "FAILED");
    expect((await mgr.get(1))!.reason).toMatch(/did not respond/);
  });

  it("persists every transition so a new manager sees the same run", async () => {
    const { mgr, store, deps } = setup();
    await mgr.start(1);
    await until(mgr, 1, (s) => s === "READY_FOR_REVIEW");
    expect(store()["1"]!.state).toBe("READY_FOR_REVIEW");
    const fresh = new RunManager(deps);
    expect((await fresh.get(1))!.report?.verified).toBe(1);
  });
});

describe("service worker restart (rehydration)", () => {
  async function interrupted(state: "OBSERVING" | "FILLING" | "VERIFYING") {
    const first = setup();
    await first.mgr.start(7);
    await until(first.mgr, 7, (s) => s === "READY_FOR_REVIEW");
    // Fabricate the persisted snapshot a killed worker would have left behind.
    const snap = structuredClone(first.store());
    snap["7"] = { ...snap["7"]!, state, report: null, reason: null };
    return snap;
  }

  it.each(["OBSERVING", "FILLING", "VERIFYING"] as const)("re-observes and finishes a run interrupted in %s", async (state) => {
    const snap = await interrupted(state);
    const { mgr, calls } = setup({}, snap);
    await mgr.rehydrate();
    await until(mgr, 7, (s) => s === "READY_FOR_REVIEW");
    const run = (await mgr.get(7))!;
    expect(run.resumeCount).toBe(1);
    expect(calls[0]!.kind).toBe("OBSERVE"); // starts from a fresh observation, not a replay of saved actions
    expect(run.report).not.toBeNull();
  });

  it("fails an interrupted run whose tab no longer exists", async () => {
    const snap = await interrupted("FILLING");
    const { mgr } = setup({ tabInfo: async () => null }, snap);
    await mgr.rehydrate();
    const run = (await mgr.get(7))!;
    expect(run.state).toBe("FAILED");
    expect(run.reason).toMatch(/tab/i);
  });

  it("leaves finished runs untouched", async () => {
    const first = setup();
    await first.mgr.start(3);
    await until(first.mgr, 3, (s) => s === "READY_FOR_REVIEW");
    const { mgr, calls } = setup({}, first.store());
    await mgr.rehydrate();
    expect((await mgr.get(3))!.state).toBe("READY_FOR_REVIEW");
    expect(calls).toEqual([]);
  });
});
