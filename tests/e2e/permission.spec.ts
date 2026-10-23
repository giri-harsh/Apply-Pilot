import { test, expect } from "@playwright/test";
import { getRunRecord, launchExtension, runPortal, type Ext } from "./support/extension";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

test.describe("Step A: per-origin optional host permission", () => {
  test("a cross-origin navigation blocks the run and the popup offers to allow exactly that site", async () => {
    const { page, popup, tabId, record } = await runPortal(ext, "crossorigin-1");
    expect(record.state).toBe("BLOCKED");
    expect(record.needsPermission).toBe(true);
    expect(record.reason).toMatch(/Permission lost after navigation/);
    expect(page.url()).toMatch(/^http:\/\/localhost:\d+\/multipage-2\.html$/);
    expect(await page.locator("#c").inputValue()).toBe(""); // nothing was filled on the page we may not read
    expect(record.report!.verified).toBeGreaterThanOrEqual(2); // page 1 work is kept

    // The popup (an extension page here, so no activeTab) is told which site by the hint, as automation would.
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}&grantOrigin=${encodeURIComponent(new URL(page.url()).origin)}`);
    await expect(popup.getByTestId("allow-site")).toBeVisible();

    // No grant has been requested or given without a click.
    const granted = await ext.worker.evaluate(async () => (await chrome.permissions.getAll()).origins ?? []);
    expect(granted.some((o) => o.includes("localhost"))).toBe(false);
    expect(await getRunRecord(popup, tabId)).toMatchObject({ state: "BLOCKED" });
  });

  test("a popup whose first run lookups are dropped (worker still waking) still shows the Allow button", async () => {
    const { page, popup, tabId } = await runPortal(ext, "crossorigin-1");
    await popup.addInitScript(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      let dropped = 0;
      (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = (m: { kind?: string }) =>
        m?.kind === "GET_RUN" && dropped++ < 2 ? Promise.reject(new Error("Receiving end does not exist")) : real(m);
    });
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}&grantOrigin=${encodeURIComponent(new URL(page.url()).origin)}`);
    await expect(popup.getByTestId("allow-site")).toBeVisible();
  });

  test("the manifest asks for nothing at install and the production build lists only the two API hosts", () => {
    for (const dir of ["dist", "dist-e2e"]) {
      const m = JSON.parse(fs.readFileSync(path.join(root, dir, "manifest.json"), "utf8"));
      expect(m.optional_host_permissions).toEqual(["https://*/*", "http://*/*"]);
    }
    const prod = JSON.parse(fs.readFileSync(path.join(root, "dist", "manifest.json"), "utf8"));
    expect(prod.host_permissions.sort()).toEqual(["https://api.groq.com/*", "https://generativelanguage.googleapis.com/*"]);
    expect(prod.permissions.sort()).toEqual(["activeTab", "offscreen", "scripting", "storage"]);
  });

  test("Site access list shows nothing by default and never lists install-time hosts", async () => {
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await options.getByRole("tab", { name: "Site access" }).click();
    await expect(options.getByTestId("no-sites")).toBeVisible();
    await expect(options.getByTestId("granted-origin")).toHaveCount(0);
  });

  test("Site access lists user-granted origins only and revokes exactly the one clicked", async () => {
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
    // Stand in for the browser's permission store (granting needs the real Chrome bubble).
    await options.evaluate(() => {
      const w = window as unknown as { __removed: unknown[]; __granted: string[] };
      w.__removed = [];
      w.__granted = ["https://api.groq.com/*", "http://127.0.0.1/*", "https://jobs.example.com/*", "https://*/*", "https://careers.other.org/*"];
      chrome.permissions.getAll = (() => Promise.resolve({ origins: w.__granted, permissions: [] })) as typeof chrome.permissions.getAll;
      chrome.permissions.remove = ((req: { origins: string[] }) => {
        w.__removed.push(req);
        w.__granted = w.__granted.filter((o) => !req.origins.includes(o));
        return Promise.resolve(true);
      }) as typeof chrome.permissions.remove;
    });
    await options.getByRole("tab", { name: "Site access" }).click();
    await expect(options.getByTestId("granted-origin")).toHaveText([/careers\.other\.org/, /jobs\.example\.com/]);
    await options.getByTestId("granted-origin").filter({ hasText: "jobs.example.com" }).getByTestId("revoke-origin").click();
    await expect(options.getByTestId("granted-origin")).toHaveCount(1);
    expect(await options.evaluate(() => (window as unknown as { __removed: unknown[] }).__removed)).toEqual([{ origins: ["https://jobs.example.com/*"] }]);
  });

  test("clicking Allow requests exactly one origin; what the browser answers decides, and the run resumes only after a grant", async () => {
    const { page, popup, tabId, record } = await runPortal(ext, "crossorigin-1");
    expect(record, JSON.stringify({ s: record.state, r: record.reason, n: record.notes, np: record.needsPermission })).toMatchObject({ state: "BLOCKED", needsPermission: true });
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}&grantOrigin=${encodeURIComponent(new URL(page.url()).origin)}`);
    // Record the exact payload handed to chrome.permissions.request, and answer "granted" or "denied" ourselves
    // (the real Chrome confirmation bubble cannot be clicked from automation: see PROGRESS.md, Needs user verification).
    await popup.evaluate(() => {
      const w = window as unknown as { __req: unknown[]; __answer: boolean };
      w.__req = [];
      w.__answer = false;
      chrome.permissions.request = ((req: unknown) => {
        w.__req.push(req);
        return Promise.resolve(w.__answer);
      }) as typeof chrome.permissions.request;
    });
    await popup.getByTestId("allow-site").click();
    await expect(popup.getByRole("alert")).toContainText("not granted");
    expect(await getRunRecord(popup, tabId)).toMatchObject({ state: "BLOCKED" }); // denied: stays stopped

    await popup.evaluate(() => ((window as unknown as { __answer: boolean }).__answer = true));
    await popup.getByTestId("allow-site").click();
    const req = await popup.evaluate(() => (window as unknown as { __req: { origins: string[] }[] }).__req);
    expect(req).toHaveLength(2);
    for (const r of req) expect(r).toEqual({ origins: [`http://localhost/*`] });

    // Resumed as a continuation. In the test build this origin is not really granted, so the run is blocked again,
    // honestly, instead of pretending to continue.
    await expect.poll(async () => (await getRunRecord(popup, tabId)).resumeCount).toBe(1);
  });
});
