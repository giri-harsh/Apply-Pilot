import { test, expect, type Page } from "@playwright/test";
import { launchExtension, runPortal, type Ext } from "./support/extension";
import { profileStrings } from "../../src/diagnostics/redact";
import { testProfile } from "../fixtures/profile";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

async function stored(): Promise<unknown[]> {
  const p = await ext.context.newPage();
  await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
  const rows = await p.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("applypilot-diagnostics");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("captures")) return resolve([]);
          const all = db.transaction("captures", "readonly").objectStore("captures").getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
  await p.close();
  return rows;
}
const diag = async () => {
  const o = await ext.context.newPage();
  await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await o.getByRole("tab", { name: "Diagnostics" }).click();
  return o;
};
const noLeak = (rows: unknown[]) => {
  const json = JSON.stringify(rows).toLowerCase();
  for (const s of profileStrings(testProfile())) expect(json, `capture leaks "${s}"`).not.toContain(s.toLowerCase());
};

test.describe("portal capture (phase-8 prep)", () => {
  test("popup button captures a FILLED page: structure is stored locally, no profile value is, and it can be viewed, exported and deleted", async () => {
    const { popup, page } = await runPortal(ext, "basic"); // the run filled the form with the profile first
    expect(await page.locator("input").evaluateAll((els) => els.some((e) => (e as HTMLInputElement).value === "Alex Example"))).toBe(true);
    await popup.getByTestId("capture-page").click();
    await expect(popup.getByTestId("capture-note")).toContainText("Captured");

    const rows = await stored();
    expect(rows).toHaveLength(1);
    noLeak(rows);
    const c = rows[0] as { page: { host: string }; fields: { label: string; control: string }[]; controls: { text: string }[]; lastRun: { state: string } };
    expect(c.page.host).toBe(new URL(page.url()).hostname);
    expect(c.fields.length).toBeGreaterThan(3);
    expect(c.controls.length).toBeGreaterThan(0);
    expect(c.lastRun.state).toBe("READY_FOR_REVIEW");

    const o = await diag();
    await expect(o.getByTestId("capture-row")).toHaveCount(1);
    await o.getByTestId("capture-view").click();
    await expect(o.getByTestId("capture-json")).toContainText('"fields"');
    const [download] = await Promise.all([o.waitForEvent("download"), o.getByTestId("capture-export").click()]);
    expect(download.suggestedFilename()).toMatch(/^capture-.*\.json$/);
    const [all] = await Promise.all([o.waitForEvent("download"), o.getByTestId("capture-export-all").click()]);
    expect(all.suggestedFilename()).toBe("applypilot-captures.json");
    await o.getByTestId("capture-delete").click();
    await expect(o.getByTestId("no-captures")).toBeVisible();
    expect(await stored()).toEqual([]);
  });

  test("'capture each step' stores one redacted snapshot per step of a multi-step run; off by default", async () => {
    const off = await runPortal(ext, "wizard-basic");
    expect(await stored()).toEqual([]); // nothing is captured unless asked
    await off.page.close();
    await off.popup.close();

    const o = await diag();
    await o.getByTestId("capture-each-step").click();
    await expect.poll(async () => ext.worker.evaluate(async () => (await chrome.storage.local.get("applypilot.diagnostics.settings.v1"))["applypilot.diagnostics.settings.v1"])).toEqual({ captureEachStep: true });
    await runPortal(ext, "wizard-basic");
    const rows = (await stored()) as { step: number | null }[];
    expect(rows.map((r) => r.step).sort()).toEqual([0, 1, 2]);
    noLeak(rows);
    await o.reload();
    await o.getByRole("tab", { name: "Diagnostics" }).click();
    await o.getByTestId("capture-delete-all").click();
    expect(await stored()).toEqual([]);
  });

  test("a capture makes no network request and the manifest has no downloads permission", async () => {
    const requests: string[] = [];
    ext.context.on("request", (r) => /^https?:/.test(r.url()) && !r.url().endsWith("/favicon.ico") && requests.push(r.url()));
    const { popup } = await runPortal(ext, "basic");
    const before = requests.length;
    await popup.getByTestId("capture-page").click();
    await expect(popup.getByTestId("capture-note")).toContainText("Captured");
    expect(requests.length).toBe(before);
    const perms = await ext.worker.evaluate(() => chrome.runtime.getManifest().permissions);
    expect(perms).not.toContain("downloads");
    void (null as unknown as Page);
  });
});
