import { test, expect } from "@playwright/test";
import { launchExtension, type Ext } from "./support/extension";
import { buildDocx, buildScannedPdf, buildTextPdf, txtBytes } from "../fixtures/resumes/files";
import { MasterResumeSchema } from "../../src/resume/schema";

const MASTER_KEY = "applypilot.resume.master.v1";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

async function openResumeTab() {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await page.getByRole("tab", { name: "Resume" }).click();
  return page;
}
const masterInStorage = () => ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], MASTER_KEY);

test.describe("Phase 7: resume import and confirmation (real extension pages)", () => {
  test("a text PDF is parsed in the extension (pdf.js worker from the extension itself), reviewed, and becomes the master only on Confirm", async () => {
    const page = await openResumeTab();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.getByTestId("resume-file").setInputFiles({ name: "alex.pdf", mimeType: "application/pdf", buffer: Buffer.from(await buildTextPdf()) });
    await page.getByTestId("resume-parse").click();
    await expect(page.getByTestId("resume-review")).toBeVisible({ timeout: 20_000 });
    expect(await page.getByTestId("resume-section").count()).toBeGreaterThan(3);
    expect(await masterInStorage()).toBeUndefined(); // reading a file never creates the master

    await page.getByTestId("resume-confirm").click();
    await expect(page.getByTestId("resume-master-summary")).toBeVisible();
    const master = MasterResumeSchema.parse(await masterInStorage());
    expect(master.contact.name.text).toBe("Alex Example");
    expect(master.entries.length).toBeGreaterThan(2);
    const facts = [master.contact.name, ...master.entries.flatMap((e) => [e.heading, ...e.bullets])];
    for (const f of facts) expect(f.provenance.source).toBe("resume_import_approved");
    expect(master.importedFrom).toMatchObject({ filename: "alex.pdf", format: "pdf" });
    // No CDN: every request made while parsing stayed inside the extension.
    expect(requests.filter((u) => /^https?:/.test(u))).toEqual([]);
  });

  test("a scanned PDF gives the clear warning and offers no Confirm, so no garbage can become the master", async () => {
    const page = await openResumeTab();
    await page.getByTestId("resume-file").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await buildScannedPdf()) });
    await page.getByTestId("resume-parse").click();
    await expect(page.getByTestId("resume-warning")).toContainText("No extractable text in this PDF. OCR is not supported yet.");
    await expect(page.getByTestId("resume-confirm")).toHaveCount(0);
    expect(await masterInStorage()).toBeUndefined();
  });

  test("DOCX and TXT import the same way; editing a fact before Confirm keeps its id and is what gets saved", async () => {
    const page = await openResumeTab();
    await page.getByTestId("resume-file").setInputFiles({ name: "alex.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(await buildDocx()) });
    await page.getByTestId("resume-parse").click();
    await expect(page.getByTestId("resume-review")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("resume-delete-all").evaluate(() => undefined); // present, not clicked
    await page.getByTestId("resume-confirm").click();
    await expect(page.getByTestId("resume-master-summary")).toBeVisible();
    expect(MasterResumeSchema.parse(await masterInStorage()).importedFrom?.format).toBe("docx");

    await page.getByTestId("resume-file").setInputFiles({ name: "alex.txt", mimeType: "text/plain", buffer: Buffer.from(txtBytes()) });
    await page.getByTestId("resume-parse").click();
    await expect(page.getByTestId("resume-review")).toBeVisible({ timeout: 20_000 });
    const first = page.locator('[id^="fact-"]').first();
    const id = await first.getAttribute("id");
    await first.fill("Alex Q. Example");
    expect(await first.getAttribute("id")).toBe(id); // the fact keeps its identity
    await page.getByTestId("resume-confirm").click();
    await expect.poll(async () => MasterResumeSchema.parse(await masterInStorage()).importedFrom?.format).toBe("txt");
    expect(MasterResumeSchema.parse(await masterInStorage()).contact.name.text).toBe("Alex Q. Example");
  });
});
