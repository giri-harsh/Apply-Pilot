import { describe, expect, it } from "vitest";
import { LearningService, emptyHints } from "@/learning/service";
import {
  DEMOTED_GRACE_MS,
  LEARNED_KEY,
  LEARNING_SETTINGS_KEY,
  MATCH_TOLERANCE,
  TTL_MS,
  applyEvents,
  fingerprintHash,
  matchStrategies,
  similarity,
  structureOf,
  type LearnEvent,
  type LearnedStrategy,
} from "@/learning/strategies";
import { memoryStore } from "./helpers";
import { field } from "./helpers";
import { testProfile } from "../fixtures/profile";
import { profileStrings } from "@/diagnostics/redact";

const T0 = 1_700_000_000_000;
let n = 0;
const id = () => `strategy-${String(++n).padStart(6, "0")}`;
const structure = (k: number) => Array.from({ length: k }, (_, i) => `h${i}`);
const verified = (over: Partial<Extract<LearnEvent, { type: "verified" }>> = {}): LearnEvent => ({
  type: "verified", kind: "field_mapping", host: "jobs.portal.test", structure: structure(10), pattern: "p1", value: { semanticType: "email", profileKey: "personal.email" }, ...over,
});

describe("learned strategies: lifecycle", () => {
  it("a verified success is stored with 0.6 confidence; confirming it reinforces; it is never stored twice", () => {
    let list = applyEvents([], [verified()], T0, id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ confidence: 0.6, successes: 1, failures: 0 });
    list = applyEvents(list, [verified(), { type: "used_ok", id: list[0]!.id }], T0 + 1000, id);
    expect(list).toHaveLength(1);
    expect(list[0]!.successes).toBe(3);
    expect(list[0]!.confidence).toBeCloseTo(0.8);
    expect(list[0]!.expiresAt).toBe(T0 + 1000 + TTL_MS);
  });

  it("a different value for the same pattern is a different strategy, not an overwrite", () => {
    const list = applyEvents([], [verified(), verified({ value: { semanticType: "phone", profileKey: "personal.phone" } })], T0, id);
    expect(list).toHaveLength(2);
  });

  it("one failure demotes a fresh strategy below the use threshold; a strong one survives one failure and is expired by the second", () => {
    const fresh = applyEvents([], [verified()], T0, id);
    const demoted = applyEvents(fresh, [{ type: "used_failed", id: fresh[0]!.id }], T0 + 10, id);
    expect(demoted[0]!.confidence).toBeCloseTo(0.3);
    expect(matchStrategies(demoted, "jobs.portal.test", structure(10), T0 + 20)).toEqual([]); // kept as evidence, never used

    let strong = applyEvents([], [verified()], T0, id);
    for (let i = 0; i < 3; i++) strong = applyEvents(strong, [{ type: "used_ok", id: strong[0]!.id }], T0 + i, id);
    expect(strong[0]!.confidence).toBeCloseTo(0.9);
    const once = applyEvents(strong, [{ type: "used_failed", id: strong[0]!.id }], T0 + 100, id);
    expect(once[0]!.confidence).toBeCloseTo(0.6);
    expect(matchStrategies(once, "jobs.portal.test", structure(10), T0 + 200)).toHaveLength(1); // one more chance
    expect(applyEvents(once, [{ type: "used_failed", id: once[0]!.id }], T0 + 300, id)).toEqual([]); // repeated failure: expired
  });

  it("a demoted strategy that is verified again recovers; one that is not re-verified for two weeks disappears", () => {
    const fresh = applyEvents([], [verified()], T0, id);
    const demoted = applyEvents(fresh, [{ type: "used_failed", id: fresh[0]!.id }], T0 + 10, id);
    const back = applyEvents(demoted, [verified()], T0 + 20, id);
    expect(back[0]!.confidence).toBeCloseTo(0.4);
    const later = applyEvents(demoted, [], T0 + DEMOTED_GRACE_MS + 1000, id);
    expect(later).toEqual([]);
  });

  it("a strategy expires after its time to live", () => {
    const list = applyEvents([], [verified()], T0, id);
    expect(applyEvents(list, [], T0 + TTL_MS + 1, id)).toEqual([]);
  });
});

describe("learned strategies: matching is strict", () => {
  const s = applyEvents([], [verified()], T0, id);
  it("same portal and a structure within tolerance matches; another portal or a changed structure does not", () => {
    expect(matchStrategies(s, "jobs.portal.test", structure(10), T0 + 1)).toHaveLength(1);
    expect(matchStrategies(s, "jobs.portal.test", [...structure(10).slice(0, 9), "new"], T0 + 1)).toHaveLength(1); // 9/11 = 0.82: within tolerance
    expect(matchStrategies(s, "jobs.portal.test", [...structure(10).slice(0, 8), "n1", "n2"], T0 + 1)).toHaveLength(0); // 8/12 = 0.67: a changed page
    expect(similarity(structure(10), [...structure(10).slice(0, 9), "new"])).toBeCloseTo(9 / 11);
    expect(similarity(structure(10), structure(5))).toBe(0.5);
    expect(MATCH_TOLERANCE).toBe(0.8);
    expect(matchStrategies(s, "other.portal.test", structure(10), T0 + 1)).toEqual([]);
    expect(matchStrategies(s, "jobs.portal.test", structure(4), T0 + 1)).toEqual([]);
  });

  it("the structure is a set of hashed field fingerprints: no label or value text", () => {
    const a = field({ fieldId: "field_001", fingerprint: "input|text|email|e|1|email address" });
    const b = field({ fieldId: "field_002", fingerprint: "input|text|city|c|1|city", visible: false });
    expect(structureOf([a, b])).toEqual([fingerprintHash("input|text|email|e|1|email address")]);
    expect(JSON.stringify(structureOf([a]))).not.toMatch(/email|address/);
  });
});

describe("LearningService", () => {
  const mk = () => {
    const store = memoryStore();
    let t = T0;
    return { store, svc: new LearningService({ store, now: () => (t += 1000), newId: id }) };
  };

  it("records verified successes and serves them back only for a matching page; learning off records and serves nothing", async () => {
    const { store, svc } = mk();
    const f = [field({ fieldId: "field_001", fingerprint: "fp-email", label: "Item 3" })];
    await svc.record([{ type: "verified", kind: "field_mapping", host: "jobs.portal.test", structure: structureOf(f), pattern: fingerprintHash("fp-email"), value: { semanticType: "email", profileKey: "personal.email" } }]);
    const hit = await svc.forPage({ url: "https://jobs.portal.test/apply/1?token=x", fields: f });
    expect(hit.mappings.get("fp-email")).toMatchObject({ semanticType: "email", profileKey: "personal.email" });
    expect((await svc.forPage({ url: "https://other.test/", fields: f })).mappings.size).toBe(0);

    await store.set({ [LEARNING_SETTINGS_KEY]: { enabled: false } });
    expect((await svc.forPage({ url: "https://jobs.portal.test/", fields: f })).mappings.size).toBe(0);
    await svc.record([{ type: "verified", kind: "input_strategy", host: "jobs.portal.test", structure: [], pattern: "x", value: { inputStrategy: "keyboard" } }]);
    expect(await svc.list()).toHaveLength(1); // nothing new was recorded while off
    expect(emptyHints().mappings.size).toBe(0);
  });

  it("the store holds no profile value: only types, profile KEYS, strategy names and hashes", async () => {
    const { store, svc } = mk();
    await svc.record([verified({ pattern: fingerprintHash("fp-any") }), verified({ kind: "input_strategy", value: { inputStrategy: "keyboard" } })]);
    const json = JSON.stringify((await store.get(LEARNED_KEY))[LEARNED_KEY]).toLowerCase();
    for (const s of profileStrings(testProfile())) expect(json, s).not.toContain(s.toLowerCase());
  });

  it("view, delete one, delete all; corrupt records are ignored", async () => {
    const { store, svc } = mk();
    await svc.record([verified(), verified({ pattern: "p2" })]);
    const [a] = await svc.list();
    await svc.deleteOne(a!.id);
    expect(await svc.list()).toHaveLength(1);
    await store.set({ [LEARNED_KEY]: [...(await svc.list()), { nonsense: true }] });
    expect(await svc.list()).toHaveLength(1);
    await svc.clearAll();
    expect(await svc.list()).toEqual([]);
  });

  it("serialises concurrent recordings so none is lost", async () => {
    const { svc } = mk();
    await Promise.all([1, 2, 3, 4, 5].map((i) => svc.record([verified({ pattern: `p${i}` })])));
    expect((await svc.list()).length).toBe(5);
  });
});

void (null as unknown as LearnedStrategy);
