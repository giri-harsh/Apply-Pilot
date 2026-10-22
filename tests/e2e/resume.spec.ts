import { test, expect, chromium, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { configureAi, getRunRecord, launchExtension, runPortal, seedProfile, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";
import { installMockAi, type MockAi } from "./support/mock-ai";
import { longMaster, sampleMaster } from "../fixtures/resumes";
import { positionedText } from "../unit/resume-layout/helpers";
import { defaultVariants } from "../../src/resume/variants";
import type { MasterResume, ResumeDocument } from "../../src/resume/schema";
import fs from "node:fs";

const MASTER_KEY = "applypilot.resume.master.v1";
const SETTINGS_KEY = "applypilot.resume.settings.v1";
const VARIANTS_KEY = "applypilot.resume.variants.v1";
const DOCS_KEY = "applypilot.resume.documents.v1";
const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };
const PORTAL = "resume-flow";

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
async function stored<T>(key: string): Promise<T | undefined> {
  return ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T | undefined>;
}
const setup = (master: MasterResume, tailoring: boolean, extra: Record<string, unknown> = {}) =>
  seed({ [MASTER_KEY]: master, [SETTINGS_KEY]: { tailoringEnabled: tailoring, pageLimit: 1 }, ...extra });

const uploads = (page: Page) => page.evaluate(() => (window as unknown as { __uploads: { field: string; name: string | null; size: number }[] }).__uploads);
const clicks = (page: Page) => page.evaluate(() => (window as unknown as { __events: { type: string; id: string | null }[] }).__events);

/** All stored binaries, read back from IndexedDB in an extension page. */
async function binaries(): Promise<{ filename: string; bytes: Buffer }[]> {
  const p = await ext.context.newPage();
  await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
  const rows = await p.evaluate(
    () =>
      new Promise<{ filename: string; bytes: number[] }[]>((resolve, reject) => {
        const open = indexedDB.open("applypilot-resume");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("files")) return resolve([]);
          const all = db.transaction("files", "readonly").objectStore("files").getAll();
          all.onsuccess = () => resolve((all.result as { ref: { filename: string }; bytes: Uint8Array }[]).map((r) => ({ filename: r.ref.filename, bytes: Array.from(r.bytes) })));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  await p.close();
  return rows.map((r) => ({ filename: r.filename, bytes: Buffer.from(r.bytes) }));
}

test.describe("Phase 7: tailored resume generation and upload", () => {
  test("tailoring on: a one-page PDF is generated, validated, uploaded to the resume field only, and the master is untouched", async () => {
    const master = sampleMaster();
    await setup(master, true);
    const { page, popup, tabId, record, report } = await runPortal(ext, PORTAL);

    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(record.resume, JSON.stringify({ w: record.resume.warnings, n: record.notes, job: record.job?.title })).toMatchObject({ status: "tailored", pageCount: 1 });
    expect(record.resume.filename).toMatch(/^Northwind-Analytics_Machine-Learning-Intern_Resume_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(report.results.find((r) => /Resume/.test(r.label))).toMatchObject({ outcome: "filled_verified" });
    expect(report.requiredUnresolved).toBe(0);

    // The page received exactly one file, in the resume field; the cover-letter field stayed empty; nothing was submitted.
    const up = await uploads(page);
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ field: "cv", name: record.resume.filename });
    await expect(page.locator("#cv-status")).toContainText(`Uploaded: ${record.resume.filename}`);
    await expect(page.locator("#cl-status")).toHaveText("");
    expect((await clicks(page)).filter((e) => e.type === "submit" || e.id === "submit")).toEqual([]);

    // The master is byte-for-byte what it was.
    expect(await stored(MASTER_KEY)).toEqual(JSON.parse(JSON.stringify(master)));

    // The stored PDF is real: header, one page, contact and section titles in its text; document + report saved.
    const bins = await binaries();
    const pdf = bins.find((b) => b.filename === record.resume.filename)!;
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
    const text = (await positionedText(new Uint8Array(pdf.bytes))).items.map((i) => i.str).join(" ");
    expect(text).toContain("Alex Example");
    expect(text).toMatch(/Education/i);
    fs.mkdirSync("test-results/resume", { recursive: true });
    fs.writeFileSync("test-results/resume/generated.pdf", pdf.bytes);

    // Visual check: the PDF is rendered by Chromium's own viewer and page 1 is saved as a PNG for a human to look at.
    const viewer = await chromium.launch({ channel: "chromium", headless: true });
    try {
      const vp = await viewer.newPage({ viewport: { width: 900, height: 1200 } });
      await vp.goto(pathToFileURL(path.resolve("test-results/resume/generated.pdf")).href);
      await vp.waitForTimeout(2500);
      const png = await vp.screenshot({ path: "test-results/resume/page1.png" });
      await test.info().attach("resume-page-1", { body: png, contentType: "image/png" });
      expect(png.byteLength).toBeGreaterThan(20_000); // a blank or error page would be tiny
    } finally {
      await viewer.close();
    }

    const docs = (await stored<ResumeDocument[]>(DOCS_KEY)) ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ validationStatus: "validated", masterId: master.masterId });
    expect(docs[0]!.report.validation).toMatchObject({ ok: true, pageCount: 1 });
    expect(docs[0]!.report.layout).toMatchObject({ pageCount: 1, satisfiedLimit: true });
    expect(docs[0]!.report.output?.pageValidated).toBe(true);
    expect(docs[0]!.masterHash).toMatch(/^[0-9a-f]{64}$/);
    for (const entry of docs[0]!.tailored.sections.flatMap((s) => s.entries))
      for (const line of entry.lines) expect(line.sourceFactIds.length).toBeGreaterThan(0);
    expect(ai.calls.gemini + ai.calls.groq).toBe(0); // AI was off: nothing left the browser

    // The popup shows what happened.
    await expect(popup.getByTestId("resume-status")).toContainText("Tailored resume uploaded");
    await expect(popup.getByTestId("resume-status")).toContainText("1 page");
    expect((await getRunRecord(popup, tabId)).resume.documentId).toBe(docs[0]!.documentId);
  });

  test("a fabricated rewrite is rejected, the retry is rejected too, and the master wording is used; the PDF never shows the invented claim", async () => {
    await setup(sampleMaster(), true);
    await configureAi(ext, { enabled: true, keys: KEYS });
    const FAKE = "Improved forecast accuracy by 45% using Kubernetes in production";
    ai.set("gemini", { resume: (p) => p.bullets.slice(0, 2).map((b) => ({ lineId: b.lineId, text: FAKE, evidenceFactIds: [b.lineId], claims: [] })) });
    ai.set("groq", { resume: (p) => p.bullets.slice(0, 2).map((b) => ({ lineId: b.lineId, text: FAKE, evidenceFactIds: [b.lineId], claims: [] })) });
    const { record, page } = await runPortal(ext, PORTAL);

    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(record.resume.status).toBe("tailored");
    expect(ai.resumeRequests.length).toBeGreaterThanOrEqual(1);
    expect(ai.resumeRequests.length).toBeLessThanOrEqual(3); // rewrite + one regeneration (+ at most one shorten)
    expect(ai.resumeRequests.map((r) => r.kind)).toContain("regeneration");
    const doc = ((await stored<ResumeDocument[]>(DOCS_KEY)) ?? [])[0]!;
    const fallbacks = doc.report.rewrites.filter((r) => r.status === "fallback_to_master");
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const f of fallbacks) expect(f.violations.length).toBeGreaterThan(0);
    for (const line of doc.tailored.sections.flatMap((s) => s.entries.flatMap((e) => e.lines))) {
      expect(line.text).not.toContain("45%");
      expect(line.text).not.toMatch(/Kubernetes/i);
    }
    const pdf = (await binaries()).find((b) => b.filename === record.resume.filename)!;
    const text = (await positionedText(new Uint8Array(pdf.bytes))).items.map((i) => i.str).join(" ");
    expect(text).not.toContain("45%");
    expect((await uploads(page))[0]).toMatchObject({ field: "cv" });
  });

  test("a faithful rewrite is accepted and cites its source facts", async () => {
    await setup(sampleMaster(), true);
    await configureAi(ext, { enabled: true, keys: KEYS });
    // Reword by swapping a leading verb only; every figure, tool and fact stays exactly as written.
    const reword = (t: string) => t.replace(/^Wrote\b/, "Authored").replace(/^Built\b/, "Developed").replace(/^Automated\b/, "Streamlined");
    const answer = (p: { bullets: { lineId: string; text: string }[] }) => p.bullets.map((b) => ({ lineId: b.lineId, text: reword(b.text), evidenceFactIds: [b.lineId], claims: [] }));
    ai.set("gemini", { resume: answer });
    ai.set("groq", { resume: answer });
    const { record } = await runPortal(ext, PORTAL);
    expect(record.resume.status).toBe("tailored");
    const doc = ((await stored<ResumeDocument[]>(DOCS_KEY)) ?? [])[0]!;
    expect(doc.report.rewrites.some((r) => r.status === "accepted" || r.status === "kept_master")).toBe(true);
    expect(doc.report.rewrites.filter((r) => r.status === "fallback_to_master")).toEqual([]);
    for (const line of doc.tailored.sections.flatMap((s) => s.entries.flatMap((e) => e.lines)).filter((l) => l.origin === "rewritten")) {
      expect(line.sourceFactIds.length).toBeGreaterThan(0);
      expect(line.masterText).toBeTruthy();
    }
  });

  test("a master too long for one page is fitted by the page-fit rule, the real page count is checked, and every dropped line is reported", async () => {
    await setup(longMaster(), true);
    const { record, popup } = await runPortal(ext, PORTAL);
    const doc = ((await stored<ResumeDocument[]>(DOCS_KEY)) ?? [])[0]!;
    expect(doc.report.layout.pageCount).toBe(doc.report.validation!.pageCount);
    expect(doc.report.layout.pageCount).toBe(1);
    expect(doc.validationStatus).toBe("validated");
    expect(doc.report.droppedLines.some((d) => /page-fit rule/.test(d.reason))).toBe(true);
    expect(record.resume).toMatchObject({ status: "tailored", uploadVerified: true });
    await expect(popup.getByTestId("resume-status")).toContainText("Tailored resume uploaded");
    // (A resume that truly cannot fit, because every line is protected, is covered by the unit suite: resume-integration and resume-layout.)
  });

  test("tailoring off and no saved resume: nothing is uploaded, the required file field is reported, the run still ends honestly", async () => {
    await setup(sampleMaster(), false);
    const { page, record, report } = await runPortal(ext, PORTAL);
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(record.resume.status).toBe("off");
    expect(await uploads(page)).toEqual([]);
    expect(report.requiredUnresolved).toBeGreaterThanOrEqual(1);
    expect(report.results.find((r) => /Resume/.test(r.label))!.outcome).not.toBe("filled_verified");
  });

  test("tailoring off after a validated resume exists: that saved file is reused and uploaded", async () => {
    await setup(sampleMaster(), true);
    const first = await runPortal(ext, PORTAL);
    const name = first.record.resume.filename!;
    await first.popup.close();
    await first.page.close(); // the next run must drive a fresh page, not this one (tabs are found by URL)
    await seed({ [SETTINGS_KEY]: { tailoringEnabled: false, pageLimit: 1 } });
    const second = await runPortal(ext, PORTAL);
    expect(second.record.resume.status, JSON.stringify({ n: second.record.notes, s: second.record.state, r: second.record.reason })).toBe("reused");
    expect(second.record.resume.filename).toBe(name);
    expect(second.record.resume.warnings.join(" ")).toMatch(/tailoring is off/i);
    expect((await uploads(second.page))[0]).toMatchObject({ field: "cv", name });
    expect(((await stored<ResumeDocument[]>(DOCS_KEY)) ?? []).length).toBe(1); // nothing new generated
  });

  test("no master resume: the run says so and uploads nothing", async () => {
    await seed({ [SETTINGS_KEY]: { tailoringEnabled: true, pageLimit: 1 } });
    const { record, page } = await runPortal(ext, PORTAL);
    expect(record.resume.status).toBe("none");
    expect(record.resume.warnings.join(" ")).toMatch(/master resume/i);
    expect(await uploads(page)).toEqual([]);
  });

  test("the popup's variant choice is passed to the run", async () => {
    const master = sampleMaster();
    const variants = defaultVariants(master);
    await setup(master, true, { [VARIANTS_KEY]: variants });
    await seedProfile(ext, testProfile());
    const chosen = variants[variants.length - 1]!;
    const page = await ext.context.newPage();
    await page.goto((await import("./support/extension")).portalUrl(PORTAL));
    const { tabIdFor } = await import("./support/extension");
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await popup.getByTestId("variant-select").selectOption(chosen.variantId);
    await popup.getByTestId("quick-apply").click();
    await expect.poll(async () => (await getRunRecord(popup, tabId))?.resume.status, { timeout: 30_000 }).toBe("tailored");
    const run = await getRunRecord(popup, tabId);
    expect(run.variantOverride).toBe(chosen.variantId);
    expect(run.resume).toMatchObject({ variantId: chosen.variantId, variantAuto: false });
    await expect(popup.getByTestId("resume-variant")).toContainText("your choice");
  });
});

test.describe("Phase 7: history, download and deletion", () => {
  test("the options page lists generated resumes with warnings, downloads them, and deleting removes the binaries too", async () => {
    await setup(sampleMaster(), true);
    const { record } = await runPortal(ext, PORTAL);
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await options.getByRole("tab", { name: "Resume" }).click();
    const doc = options.getByTestId("resume-document");
    await expect(doc).toHaveCount(1);
    await expect(doc).toContainText("Northwind Analytics");
    await expect(doc).toContainText("1 page(s) of 1 allowed");
    const [download] = await Promise.all([options.waitForEvent("download"), options.getByTestId("download-pdf").click()]);
    expect(download.suggestedFilename()).toBe(record.resume.filename);

    expect((await binaries()).length).toBeGreaterThanOrEqual(1);
    await options.getByTestId("delete-document").click();
    await expect(options.getByTestId("no-documents")).toBeVisible();
    expect(await binaries()).toEqual([]);
    expect(((await stored<ResumeDocument[]>(DOCS_KEY)) ?? [])).toEqual([]);
    expect(await stored(MASTER_KEY)).toBeTruthy(); // deleting a generated resume never touches the master
  });

  test("tailoring cannot be switched on without a master, and 'Delete all resume data' removes everything", async () => {
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await options.getByRole("tab", { name: "Resume" }).click();
    await expect(options.getByTestId("tailoring-toggle")).toBeDisabled();
    await setup(sampleMaster(), true);
    options.once("dialog", (d) => void d.accept());
    await options.reload();
    await options.getByRole("tab", { name: "Resume" }).click();
    await expect(options.getByTestId("tailoring-toggle")).toBeEnabled();
    await options.getByTestId("resume-delete-all").click();
    await expect.poll(async () => await stored(MASTER_KEY)).toBeUndefined();
    expect(await stored(SETTINGS_KEY)).toBeUndefined();
  });
});
