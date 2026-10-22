import { test, expect, type Page } from "@playwright/test";
import { launchExtension, portalUrl, portalUrlOnHost, runPortal, type Ext } from "./support/extension";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

const events = (p: Page) => p.evaluate(() => (window as unknown as { __events: { type: string; id: string | null }[] }).__events);
async function open(url: string) {
  const page = await ext.context.newPage();
  await page.goto(url);
  return runPortal(ext, "", { page });
}
const val = (p: Page, sel: string) => p.locator(sel).inputValue();

test.describe("Phase 8a: adapter router (synthetic FakeATS family only)", () => {
  test("recognised host + signals + structure: the adapter path fills opaque labels and moves through all three pages, and never submits", async () => {
    const { page, popup, record } = await open(portalUrlOnHost("fakeats.test", "fakeats/step1"));
    expect(record.route).toMatchObject({ path: "adapter", adapterId: "fakeats", adapterVersion: 1 });
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(page.url()).toContain("fakeats/step3"); // "Go on" (an unrecognised label) was resolved by the adapter's next hint, twice
    expect(record.report!.steps.map((s) => s.outcome)).toEqual(["advanced", "advanced", "final"]);
    await expect(popup.getByTestId("route")).toContainText("Portal adapter: fakeats v1");
    // what step 1 and 2 received is reported per field (the pages were left, so read the report)
    const filled = record.report!.results.filter((r) => r.outcome === "filled_verified").map((r) => r.label).sort();
    expect(filled).toEqual(["Item 1", "Item 2", "Item 3", "Item 4", "Item 6", "Item 7"]);
    // the review page's Submit button (it even carries the same next-button attribute) was never clicked
    const clicked = (await events(page)).filter((e) => e.type === "click").map((e) => e.id);
    expect(clicked).not.toContain("final");
    expect((await events(page)).some((e) => e.type === "submit")).toBe(false);
  });

  test("the sensitive 'Gender' select carries a deliberately wrong adapter hint and is still left alone", async () => {
    // stay on step 1 by running on a copy whose next button is unreachable: read the field state after the run on step 1 only
    const page = await ext.context.newPage();
    await page.goto(portalUrlOnHost("fakeats.test", "fakeats/step1"));
    await page.evaluate(() => document.querySelector("[data-automation-id='bottom-navigation-next-button']")!.remove());
    const { record } = await runPortal(ext, "", { page });
    expect(record.route?.path).toBe("adapter");
    expect(await page.locator("#g").evaluate((e) => (e as HTMLSelectElement).value)).toBe("");
    const gender = record.report!.results.find((r) => r.label === "Gender")!;
    expect(gender.outcome).toMatch(/skipped_sensitive|unresolved/);
    expect(await val(page, "#a")).toBe("Alex");
    expect(await val(page, "#b")).toBe("Example");
    expect(await val(page, "#c")).toBe("alex@example.test");
  });

  test("the same pages on another host take the general path: opaque labels stay empty and the run stops at the unrecognised button", async () => {
    const { page, record } = await open(portalUrl("fakeats/step1")); // 127.0.0.1, not a FakeATS host
    expect(record.route).toMatchObject({ path: "general", adapterId: null });
    expect(record.route!.reason).toMatch(/No adapter matches this host/);
    expect(page.url()).toContain("fakeats/step1");
    expect(await val(page, "#a")).toBe("");
    expect(await val(page, "#c")).toBe("");
    expect(record.report!.steps[0]!.outcome).toBe("final"); // "Go on" is unrecognised, so treated as final
  });

  test("same host, same generator tag, redesigned structure: the general path, with the reason", async () => {
    const { record, page } = await open(portalUrlOnHost("fakeats.test", "fakeats/redesign"));
    expect(record.route).toMatchObject({ path: "general" });
    expect(record.route!.reason).toMatch(/does not look like it/);
    expect(await val(page, "#a")).toBe("");
  });

  for (const host of ["fakeats.test.evil.test", "evilfakeats.test", "www.fakeats.test", "a.jobs.fakeats.test"]) {
    test(`lookalike or unlisted host ${host} is never matched`, async () => {
      const { record } = await open(portalUrlOnHost(host, "fakeats/step1"));
      expect(record.route).toMatchObject({ path: "general", adapterId: null });
      expect(record.route!.reason).toMatch(/No adapter matches this host/);
    });
  }

  test("an explicitly listed subdomain (jobs.fakeats.test) is matched", async () => {
    const { record } = await open(portalUrlOnHost("jobs.fakeats.test", "fakeats/step1"));
    expect(record.route).toMatchObject({ path: "adapter", adapterId: "fakeats" });
  });
});
