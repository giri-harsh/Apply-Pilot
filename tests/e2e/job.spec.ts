import { test, expect } from "@playwright/test";
import { launchExtension, portalUrl, seedProfile, tabIdFor, runPortal, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";
import { JOB_FIXTURES } from "../fixtures/jobs";
import type { JobContext } from "../../src/job/schema";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

async function cachedJobs(popup: import("@playwright/test").Page): Promise<JobContext[]> {
  return popup.evaluate(async () => {
    const all = (await chrome.storage.local.get("applypilot.jobs.v1"))["applypilot.jobs.v1"] ?? {};
    return Object.values(all).map((e) => (e as { job: unknown }).job);
  }) as Promise<JobContext[]>;
}

function profileWithSkills() {
  const p = testProfile();
  const prov = p.education[0]!.provenance;
  for (const [i, name] of ["Python", "SQL", "Machine Learning"].entries()) {
    p.skills.push({ id: `s${i}`, name, category: "programming_languages", proficiency: "", evidence: "", lastVerified: "", provenance: prov });
  }
  return p;
}

test.describe("Phase 5: job description intelligence", () => {
  for (const fx of JOB_FIXTURES) {
    test(`${fx.file}: popup shows the real company and role; the extracted description matches and excludes decoys`, async () => {
      await seedProfile(ext, profileWithSkills());
      const page = await ext.context.newPage();
      await page.goto(portalUrl(`jobs/${fx.file}`));
      const tabId = await tabIdFor(ext, page);
      const popup = await ext.context.newPage();
      await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);

      await expect(popup.getByTestId("company")).toHaveText(fx.company);
      await expect(popup.getByTestId("role")).toHaveText(fx.title);
      await expect(popup.getByTestId("match")).toContainText("/100 (decision aid)");

      const [job] = await cachedJobs(popup);
      expect(job).toBeDefined();
      expect(job!.jobTitle).toBe(fx.title);
      expect(job!.company).toBe(fx.company);
      for (const s of fx.mustContain) expect(job!.descriptionText, `should contain ${s}`).toContain(s);
      for (const s of fx.mustNotContain) expect(job!.descriptionText, `should NOT contain ${s}`).not.toContain(s);
      expect([...job!.requiredSkills].sort()).toEqual([...fx.required].sort());
      expect([...job!.preferredSkills].sort()).toEqual([...fx.preferred].sort());
      // A preview reads the page only: nothing was filled or clicked.
      expect(await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)).toEqual([]);
    });
  }

  test("Quick Apply on a job page records the job on the run, even with no form on the page", async () => {
    const { record, popup } = await runPortal(ext, "jobs/jsonld", { profile: profileWithSkills() });
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/No form fields/);
    expect(record.job).toMatchObject({ title: "Machine Learning Intern", company: "Northwind Analytics" });
    expect(record.job!.matchScore).toBeGreaterThan(0);
    expect(record.history.map((h) => h.state)).toContain("EXTRACTING_JOB");
    await expect(popup.getByTestId("company")).toHaveText("Northwind Analytics");
  });

  test("a job page that also has the form: fills the form and keeps the form text out of the description", async () => {
    const { record, page } = await runPortal(ext, "jobs/noisy", { profile: profileWithSkills() });
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#n")).toHaveValue("Alex Example");
    expect(record.job).toMatchObject({ company: "Globex Corporation" });
    expect(record.job!.warnings.join(" ")).toMatch(/Company inferred from the page title/);
  });

  test("the job context is cached per URL: the second read is a cache hit", async () => {
    await seedProfile(ext, profileWithSkills());
    const page = await ext.context.newPage();
    await page.goto(portalUrl("jobs/no-jsonld") + "?utm_source=newsletter");
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await expect(popup.getByTestId("role")).toHaveText("Data Science Intern");
    const again = await popup.evaluate((id) => chrome.runtime.sendMessage({ kind: "PREVIEW_JOB", tabId: id }), tabId);
    expect(again).toMatchObject({ ok: true, kind: "job_preview", job: { fromCache: true, title: "Data Science Intern" } });
    expect((await cachedJobs(popup)).length).toBe(1);
  });

  test("a page with no job shows Unknown, not an invented company or role", async () => {
    await seedProfile(ext, testProfile());
    const page = await ext.context.newPage();
    await page.goto(portalUrl("jobs/not-a-job"));
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await expect(popup.getByTestId("profile-status")).toHaveText("Ready");
    await expect(popup.getByTestId("company")).toHaveText("Unknown");
    await expect(popup.getByTestId("role")).toHaveText("Unknown");
  });

  test("adversarial posting: warned, treated as data, no sensitive action, no injected skills", async () => {
    const { page, popup } = await (async () => {
      await seedProfile(ext, profileWithSkills());
      const pg = await ext.context.newPage();
      await pg.goto(portalUrl("jobs/adversarial-jd"));
      const tabId = await tabIdFor(ext, pg);
      const pp = await ext.context.newPage();
      await pp.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
      await expect(pp.getByTestId("company")).toHaveText("Initech");
      return { page: pg, popup: pp };
    })();
    await expect(popup.getByTestId("job-warnings")).toContainText("instruction-like");
    const [job] = await cachedJobs(popup);
    expect(JSON.stringify(job!.requiredSkills)).not.toContain("Quantum");
    expect(await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)).toEqual([]);
  });
});
