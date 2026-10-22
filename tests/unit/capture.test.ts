import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DiagnosticsService } from "@/background/diagnostics-service";
import { capturePage } from "@/content/capture";
import { maskText, profileStrings, scrubProfile } from "@/diagnostics/redact";
import { createCaptureStore, MAX_CAPTURES } from "@/diagnostics/store";
import type { ContentResponse } from "@/shared/messages";
import type { RunRecord } from "@/shared/run";
import { testProfile } from "../fixtures/profile";

const profile = testProfile();
const mine = profileStrings(profile);

/** A step of an application, pre-filled with the applicant's values in every place a page could echo them back. */
function prefilledPage() {
  document.title = "Apply - Alex Example - Northwind";
  document.head.innerHTML = '<meta name="generator" content="FakeATS 4.2"><script src="https://cdn.fakeats.test/app.js"></script>';
  document.body.innerHTML = `
    <h1>Welcome back, Alex Example</h1>
    <h2>Step 1 of 3</h2>
    <form class="ats-form" data-automation-id="applyForm">
      <label for="n">Full name</label><input id="n" name="fullName" class="ats-input" data-automation-id="name" value="Alex Example">
      <label for="e">Email (we have alex@example.test)</label><input id="e" name="email" type="email" value="alex@example.test">
      <label for="p">Phone</label><input id="p" name="phone" value="+91 98765 43210">
      <label for="c">City</label><input id="c" name="city" value="Pune">
      <label for="co">Country</label><select id="co" name="country"><option>Select</option><option selected>India</option><option>United States</option></select>
      <label for="l">LinkedIn</label><input id="l" name="li" value="https://www.linkedin.com/in/alex-example">
      <label for="s">Why Example Institute of Technology? </label><textarea id="s">I studied at Example Institute of Technology and live in Pune.</textarea>
      <label for="f">Resume</label><input id="f" type="file" accept=".pdf">
      <a href="https://github.com/alex-example">github.com/alex-example</a>
      <button type="button" id="next">Next</button>
      <button type="button" id="save">Save draft</button>
    </form>`;
  (document.getElementById("s") as HTMLTextAreaElement).value = "I studied at Example Institute of Technology and live in Pune.";
}

const run = { state: "READY_FOR_REVIEW", steps: [{ index: 0, title: "Hello Alex Example", outcome: "final", verified: 2, failed: 0, requiredUnresolved: 0, totalFields: 2, filled: 2, skippedSensitive: 0, ambiguous: 0, unresolved: 0, alreadyCorrect: 0, advancedBy: null, note: null, url: "https://x.test", results: [] }],
  report: { results: [{ label: "Email", outcome: "filled_verified", reason: "Rendered value matches (alex@example.test)", semanticType: "email", required: true }] } } as unknown as RunRecord;

async function service() {
  const store = createCaptureStore({ idb: new IDBFactory(), dbName: `d${Math.random()}` });
  const svc = new DiagnosticsService({
    store,
    injectContent: async () => undefined,
    sendToTab: async (_t, req): Promise<ContentResponse> =>
      req.kind === "CAPTURE" ? { ok: true, kind: "CAPTURED", capture: capturePage(document, "https://jobs.fakeats.test/apply/step1?token=SECRET&email=alex@example.test#frag", { captureId: req.captureId, now: new Date(req.nowIso), version: req.version, step: req.step }) } : { ok: true, kind: "PONG" },
    loadProfile: async () => profile,
    getRun: async () => run,
    version: "0.1.0",
    now: (() => { let t = Date.parse("2026-10-23T10:00:00Z"); return () => new Date((t += 1000)); })(),
    newId: (() => { let n = 0; return () => `cap-${String(++n).padStart(8, "0")}`; })(),
  });
  return { store, svc };
}

describe("portal capture: structure in, personal data out", () => {
  beforeEach(prefilledPage);

  it("captures the structure of a pre-filled page and not one string of the profile (scan of every profile value)", async () => {
    const { svc, store } = await service();
    const c = await svc.capture(1);
    const json = JSON.stringify(c).toLowerCase();
    const stored = JSON.stringify(await store.exportAll()).toLowerCase();
    expect(mine.length).toBeGreaterThan(15);
    for (const s of mine) {
      expect(json, `capture leaks "${s}"`).not.toContain(s.toLowerCase());
      expect(stored, `stored capture leaks "${s}"`).not.toContain(s.toLowerCase());
    }
    // ... while the structure an adapter needs is there
    expect(c.page).toMatchObject({ host: "jobs.fakeats.test", path: "/apply/step1" });
    expect(json).not.toMatch(/secret|token|frag/); // no query string, no fragment
    expect(c.signals.generator).toBe("FakeATS 4.2");
    expect(c.signals.scriptHosts).toContain("cdn.fakeats.test");
    expect(c.signals.dataAttributes.map((d) => d.name)).toContain("data-automation-id");
    expect(c.signals.classPrefixes.map((p) => p.prefix)).toContain("ats");
    expect(c.fields.map((f) => f.control)).toEqual(expect.arrayContaining(["text", "select", "textarea", "file"]));
    expect(c.fields.find((f) => f.control === "file")!.accept).toBe(".pdf");
    expect(c.controls.map((b) => [b.text, b.role])).toEqual(expect.arrayContaining([["Next", "next"]]));
    expect(c.lastRun).toMatchObject({ state: "READY_FOR_REVIEW" });
    expect(c.lastRun!.results[0]!.reason).not.toContain("alex@example.test");
    expect(c.fields.every((f) => !("currentValue" in f))).toBe(true);
  });

  it("an extractor that only masks (no profile scrub) still keeps typed values out: values are never read", () => {
    const raw = capturePage(document, "https://x.test/a", { captureId: "cap-00000001", now: new Date(0), version: "0.1.0", step: null });
    const json = JSON.stringify(raw).toLowerCase();
    for (const s of ["alex-example", "98765", "411001", "student", "pune"]) expect(json).not.toContain(s);
    expect(json).not.toContain("alex@example.test"); // masked to <email> even inside a label
    expect(json).toContain("<email>");
  });

  it("scrubProfile replaces profile strings anywhere in nested data, case-insensitively, and leaves the rest alone", () => {
    const out = scrubProfile({ a: "Hello ALEX EXAMPLE from pune", b: ["x", { c: "India" }], d: 3 }, mine);
    expect(JSON.stringify(out).toLowerCase()).not.toMatch(/alex example|pune|india/);
    expect(out.d).toBe(3);
    expect(scrubProfile({ a: "nothing here" }, mine)).toEqual({ a: "nothing here" });
  });

  it("masks emails, urls, phones and long numbers and truncates long text", () => {
    expect(maskText("mail a.b@c.io or call +1 (555) 010-0199, id 12345678, see https://x.test/p?q=1 and www.y.org")).toBe("mail <email> or call <phone>, id <phone>, see <url> and <url>");
    expect(maskText("x".repeat(500)).length).toBe(200);
    expect(maskText(null)).toBe("");
  });
});

describe("capture store", () => {
  it("lists, views, exports, deletes one and deletes all; the namespace is bounded", async () => {
    prefilledPage();
    const { svc, store } = await service();
    const a = await svc.capture(1);
    await svc.capture(1, 2);
    expect((await store.list()).map((r) => r.step)).toEqual([2, null]); // newest first
    expect((await store.get(a.captureId))!.page.host).toBe("jobs.fakeats.test");
    await store.delete(a.captureId);
    expect(await store.get(a.captureId)).toBeNull();
    expect(await store.exportAll()).toHaveLength(1);
    await store.clearAll();
    expect(await store.list()).toEqual([]);
    for (let i = 0; i < MAX_CAPTURES + 3; i++) await svc.capture(1);
    expect((await store.list()).length).toBe(MAX_CAPTURES);
  }, 60_000);
});
