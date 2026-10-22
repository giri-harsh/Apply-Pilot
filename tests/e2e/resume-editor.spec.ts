import { test, expect } from "@playwright/test";
import { launchExtension, type Ext } from "./support/extension";
import { sampleMaster } from "../fixtures/resumes";
import { defaultVariants } from "../../src/resume/variants";
import type { MasterResume, ResumeVariant } from "../../src/resume/schema";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});
const get = <T>(k: string) => ext.worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], k) as Promise<T>;

test("master editor: an edit is marked user_edited, a delete is removed from variants with a warning, tailoring data is untouched otherwise", async () => {
  const master = sampleMaster();
  const bullet = master.entries.find((e) => e.bullets.length > 1)!.bullets[0]!;
  const variants = defaultVariants(master).map((v, i) => (i === 0 ? { ...v, pinnedFactIds: [bullet.factId] } : v));
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await page.evaluate((i) => chrome.storage.local.set(i), { "applypilot.resume.master.v1": master, "applypilot.resume.variants.v1": variants });
  await page.reload();
  await page.getByRole("tab", { name: "Resume" }).click();

  const row = page.locator(`[data-fact-id="${bullet.factId}"]`);
  await row.locator("input").fill("Rewritten by the user");
  await row.getByTestId("master-fact-save").click();
  await expect(row).toHaveAttribute("data-source", "user_edited");
  const edited = await get<MasterResume>("applypilot.resume.master.v1");
  const f = edited.entries.flatMap((e) => e.bullets).find((b) => b.factId === bullet.factId)!;
  expect(f).toMatchObject({ text: "Rewritten by the user", provenance: { source: "user_edited" } });

  await row.getByTestId("master-fact-delete").click();
  await expect(page.getByTestId("master-editor-note")).toContainText("Removed from the");
  await expect(page.locator(`[data-fact-id="${bullet.factId}"]`)).toHaveCount(0);
  const after = await get<MasterResume>("applypilot.resume.master.v1");
  expect(after.entries.flatMap((e) => e.bullets).some((b) => b.factId === bullet.factId)).toBe(false);
  const vs = await get<ResumeVariant[]>("applypilot.resume.variants.v1");
  expect(vs.every((v) => !v.pinnedFactIds.includes(bullet.factId))).toBe(true);
});
