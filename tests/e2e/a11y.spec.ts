import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { launchExtension, runPortal, seedProfile, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";
import { sampleMaster } from "../fixtures/resumes";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

type Finding = { page: string; id: string; impact: string | null | undefined; help: string; nodes: number };
const minor: Finding[] = [];

/** Runs axe against an extension page. Serious and critical violations fail the test; the rest are recorded. */
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const all: Finding[] = results.violations.map((v) => ({ page: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
  minor.push(...all.filter((f) => f.impact !== "serious" && f.impact !== "critical"));
  const bad = all.filter((f) => f.impact === "serious" || f.impact === "critical");
  expect(bad, `axe serious/critical on ${name}`).toEqual([]);
}

test.afterAll(() => {
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/a11y-minor.json", JSON.stringify(minor, null, 2));
});

const TABS = ["Personal", "Education", "Skills", "Projects", "Experience", "Certifications", "Preferences", "AI providers", "Site access", "Resume", "Diagnostics", "Import / Export"];

test.describe("accessibility (axe) on the extension's own pages", () => {
  test("popup: idle, and after a run with a report, steps and resume info", async () => {
    await seedProfile(ext, testProfile());
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
    await expect(page.getByTestId("quick-apply")).toBeVisible();
    await audit(page, "popup (idle)");
    await page.close();

    const o = await ext.context.newPage();
    await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await o.evaluate((m) => chrome.storage.local.set({ "applypilot.resume.master.v1": m, "applypilot.resume.settings.v1": { tailoringEnabled: true, pageLimit: 1 } }), sampleMaster());
    await o.close();
    const { popup } = await runPortal(ext, "resume-flow");
    await expect(popup.getByTestId("report")).toBeVisible();
    await audit(popup, "popup (after a tailored run)");
  });

  for (const tab of TABS) {
    test(`options: ${tab}`, async () => {
      const page = await ext.context.newPage();
      await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(300);
      await audit(page, `options / ${tab}`);
    });
  }

  test("options: Resume tab with a master loaded (editor, history, import)", async () => {
    const page = await ext.context.newPage();
    await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await page.evaluate((m) => chrome.storage.local.set({ "applypilot.resume.master.v1": m }), sampleMaster());
    await page.reload();
    await page.getByRole("tab", { name: "Resume" }).click();
    await expect(page.getByTestId("master-editor")).toBeVisible();
    await audit(page, "options / Resume (with master)");
  });
});
