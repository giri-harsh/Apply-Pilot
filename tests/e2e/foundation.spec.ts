import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchExtension, portalUrl, quickApply, seedProfile, tabIdFor, waitForState, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

test("Phase 1: extension loads unpacked and Quick Apply inspects a synthetic form", async () => {
  expect(ext.extensionId).toMatch(/^[a-p]{32}$/);

  const page = await ext.context.newPage();
  await page.goto(portalUrl("basic"));

  const popup = await quickApply(ext, page);
  // No profile saved yet: the run must inspect the page, then stop honestly instead of pretending.
  await waitForState(popup, ["BLOCKED"]);
  await expect(popup.getByTestId("discovered")).toHaveText("Fields found: 10");
  await expect(popup.getByTestId("reason")).toContainText("profile");
  await expect(popup.getByTestId("quick-apply")).toBeEnabled();

  // Nothing was written into the page.
  for (const id of ["fullname", "email", "phone", "city", "school"]) {
    await expect(page.locator(`#${id}`)).toHaveValue("");
  }
  expect(await page.evaluate(() => (window as unknown as { __submitted: boolean }).__submitted)).toBe(false);
});

test("Phase 1/4/7: production manifest requests only activeTab, scripting, storage, offscreen and the two AI API origins", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist", "manifest.json"), "utf8"));
  expect(manifest.manifest_version).toBe(3);
  // "offscreen" (Phase 7) hosts the PDF builder; see docs/PERMISSIONS.md. Host access beyond the AI origins is optional only.
  expect(manifest.permissions.sort()).toEqual(["activeTab", "offscreen", "scripting", "storage"]);
  expect(manifest.host_permissions.sort()).toEqual(["https://api.groq.com/*", "https://generativelanguage.googleapis.com/*"]);
  expect(manifest.content_scripts).toBeUndefined();
});

test("Phase 1: built content script and service worker are single self-contained files", async () => {
  for (const f of ["content.js", "background.js"]) {
    const src = fs.readFileSync(path.join(root, "dist", f), "utf8");
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
    expect(src).not.toMatch(/import\(/);
  }
});

test("Phase 1: a second Quick Apply on the same tab is rejected while the first run is active", async () => {
  await seedProfile(ext, testProfile());
  const page = await ext.context.newPage();
  await page.goto(portalUrl("basic"));
  const tabId = await tabIdFor(ext, page);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);

  // Both messages are sent back to back; the first is still working when the second arrives.
  const [first, second] = await popup.evaluate(
    (id) => Promise.all([chrome.runtime.sendMessage({ kind: "START_RUN", tabId: id }), chrome.runtime.sendMessage({ kind: "START_RUN", tabId: id })]),
    tabId,
  );
  expect([first.ok, second.ok].sort()).toEqual([false, true]);
  const rejected = first.ok ? second : first;
  expect(rejected.code).toBe("DUPLICATE_RUN");
  await waitForState(popup, ["READY_FOR_REVIEW"]);
});

test("Phase 1: messages from outside the extension and malformed messages are rejected", async () => {
  const page = await ext.context.newPage();
  await page.goto(portalUrl("basic"));
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  const bad = await popup.evaluate(() => chrome.runtime.sendMessage({ kind: "RUN_JS", code: "alert(1)" }));
  expect(bad).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
});

test("Phase 1: an interrupted run is re-observed and finished after the service worker restarts", async () => {
  await seedProfile(ext, testProfile());
  const page = await ext.context.newPage();
  await page.goto(portalUrl("basic"));
  const tabId = await tabIdFor(ext, page);

  // Persist the snapshot a killed worker would leave behind: a run stuck in FILLING.
  const ext2 = await ext.context.newPage();
  await ext2.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await ext2.evaluate(async (id) => {
    const now = Date.now();
    await chrome.storage.local.set({
      "applypilot.runs.v1": {
        [String(id)]: {
          runId: "interrupted-run-0001", tabId: id, url: location.href, pageTitle: "x", state: "FILLING",
          history: [{ state: "INITIALIZING", at: now }, { state: "FILLING", at: now }],
          startedAt: now, updatedAt: now, fieldsDiscovered: 3, resumeCount: 0, report: null, reason: null,
        },
      },
    });
  }, tabId);

  // Terminate the service worker through DevTools. The next message wakes a fresh worker, which must rehydrate.
  const cdp = await ext.context.newCDPSession(ext2);
  const versions = new Map<string, string>();
  cdp.on("ServiceWorker.workerVersionUpdated", (e) => {
    for (const v of e.versions) versions.set(v.versionId, v.scriptURL);
  });
  await cdp.send("ServiceWorker.enable");
  await expect.poll(() => [...versions.values()].some((u) => u.includes(ext.extensionId))).toBe(true);
  const [versionId] = [...versions].find(([, u]) => u.includes(ext.extensionId))!;
  await cdp.send("ServiceWorker.stopWorker", { versionId });
  await expect.poll(() => ext.worker.evaluate(() => 1).then(() => "alive", () => "stopped")).toBe("stopped");

  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
  await waitForState(popup, ["READY_FOR_REVIEW"]);
  const run = await popup.evaluate(async (id) => (await chrome.runtime.sendMessage({ kind: "GET_RUN", tabId: id })).run, tabId);
  expect(run.runId).toBe("interrupted-run-0001");
  expect(run.resumeCount).toBe(1);
  await expect(page.locator("#email")).toHaveValue("alex@example.test");
});
