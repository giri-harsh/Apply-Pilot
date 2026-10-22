import { test, expect, type Page } from "@playwright/test";
import { configureAi, launchExtension, runPortal, type Ext } from "./support/extension";
import { installMockAi, type CoverPayload, type MockAi } from "./support/mock-ai";
import { sampleMaster } from "../fixtures/resumes";
import type { ResumeDocument } from "../../src/resume/schema";

const MASTER_KEY = "applypilot.resume.master.v1";
const SETTINGS_KEY = "applypilot.resume.settings.v1";
const DOCS_KEY = "applypilot.resume.documents.v1";
const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };

let ext: Ext;
let ai: MockAi;
test.beforeEach(async () => {
  ext = await launchExtension();
  ai = await installMockAi(ext.context);
});
test.afterEach(async () => {
  await ext.context.close();
});

async function seed(items: Record<string, unknown>) {
  const p = await ext.context.newPage();
  await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await p.evaluate((i) => chrome.storage.local.set(i), items);
  await p.close();
}
const setup = (cover: boolean) => seed({ [MASTER_KEY]: sampleMaster(), [SETTINGS_KEY]: { tailoringEnabled: true, pageLimit: 1, coverLetterEnabled: cover } });
const stored = <T>(key: string) => ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T | undefined>;
const uploads = (page: Page) => page.evaluate(() => (window as unknown as { __uploads: { field: string; name: string | null }[] }).__uploads);

/** A faithful letter: each paragraph quotes the evidence it cites, so it can only say what the facts say. */
const faithfulLetter = (p: CoverPayload) =>
  p.evidence.slice(0, 3).map((e) => ({ text: `I would bring this to the role. ${e.text}`, evidenceIds: [e.id], claims: [] }));
const useLetter = (fn: (p: CoverPayload) => unknown[]) => {
  ai.set("gemini", { cover: fn });
  ai.set("groq", { cover: fn });
};

test.describe("Phase 7b: cover letters (default off, required fields only, never crossed with the resume)", () => {
  test("a REQUIRED cover-letter field with the setting on gets a generated, validated letter; the resume and the letter each go to their own field only", async () => {
    await setup(true);
    await configureAi(ext, { enabled: true, keys: KEYS });
    useLetter(faithfulLetter);
    const { page, record, report } = await runPortal(ext, "resume-flow-cover");

    expect(ai.coverRequests.length).toBeGreaterThanOrEqual(1);
    const up = await uploads(page);
    expect(up).toHaveLength(2);
    expect(up.find((u) => u.field === "cv")!.name).toMatch(/_Resume_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(up.find((u) => u.field === "cl")!.name).toMatch(/_CoverLetter_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(up.find((u) => u.field === "cv")!.name).not.toMatch(/CoverLetter/);
    expect(up.find((u) => u.field === "cl")!.name).not.toMatch(/_Resume_/);
    expect(report.results.filter((r) => /Resume|Cover/.test(r.label)).map((r) => r.outcome)).toEqual(["filled_verified", "filled_verified"]);
    expect(report.requiredUnresolved).toBe(0);
    expect(record.resume.uploaded).toHaveLength(2);

    // The letter is attached to the run's document, so deleting the document deletes it as well.
    const doc = ((await stored<ResumeDocument[]>(DOCS_KEY)) ?? [])[0]!;
    expect(doc.report.coverLetter?.filename).toMatch(/_CoverLetter_/);
    expect(doc.report.coverLetter?.pageValidated).toBe(true);
  });

  test("default OFF: the required cover-letter field is reported and left for the user, and no letter is requested", async () => {
    await setup(false);
    await configureAi(ext, { enabled: true, keys: KEYS });
    useLetter(faithfulLetter);
    const { page, report } = await runPortal(ext, "resume-flow-cover");
    expect(ai.coverRequests).toEqual([]);
    expect((await uploads(page)).map((u) => u.field)).toEqual(["cv"]);
    const cl = report.results.find((r) => /Cover/.test(r.label))!;
    expect(cl.outcome).toBe("unresolved");
    expect(cl.reason).toMatch(/off/i);
  });

  test("an OPTIONAL cover-letter field is never filled, even with the setting on", async () => {
    await setup(true);
    await configureAi(ext, { enabled: true, keys: KEYS });
    useLetter(faithfulLetter);
    const { page, report } = await runPortal(ext, "resume-flow"); // its cover-letter input is optional
    expect(ai.coverRequests).toEqual([]);
    expect((await uploads(page)).map((u) => u.field)).toEqual(["cv"]);
    expect(report.results.find((r) => /Cover/.test(r.label))!.reason).toMatch(/optional/i);
  });

  test("with AI off no letter is invented; a letter that fails grounding is never uploaded; the resume still goes in", async () => {
    await setup(true);
    const off = await runPortal(ext, "resume-flow-cover");
    expect((await uploads(off.page)).map((u) => u.field)).toEqual(["cv"]);
    expect(off.report.results.find((r) => /Cover/.test(r.label))!.reason).toMatch(/needs AI/i);
    await off.page.close();
    await off.popup.close();

    await configureAi(ext, { enabled: true, keys: KEYS });
    useLetter((p) => p.evidence.slice(0, 3).map((e) => ({ text: "I improved forecast accuracy by 45% and ran Kubernetes in production at scale.", evidenceIds: [e.id], claims: [] })));
    const bad = await runPortal(ext, "resume-flow-cover");
    expect((await uploads(bad.page)).map((u) => u.field)).toEqual(["cv"]);
    expect(bad.report.results.find((r) => /Cover/.test(r.label))!.outcome).toBe("unresolved");
    expect(ai.coverRequests.length).toBeLessThanOrEqual(2); // letter + one regeneration at most
  });
});
