import { chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserProfile } from "../../../src/shared/profile";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const EXTENSION_DIR = path.join(root, "dist-e2e");

export type Ext = { context: BrowserContext; extensionId: string; worker: Worker; userDataDir: string };

export function portalUrl(name: string): string {
  const base = process.env.PORTAL_BASE_URL;
  if (!base) throw new Error("PORTAL_BASE_URL not set (global setup did not run)");
  return `${base}/${name}.html`;
}

export function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "applypilot-pw-"));
}

/**
 * Launches Chromium with the built extension. Extensions need Chromium; `channel: "chromium"` selects the
 * new headless mode, which supports them.
 */
export async function launchExtension(userDataDir = freshUserDataDir()): Promise<Ext> {
  if (!fs.existsSync(path.join(EXTENSION_DIR, "manifest.json"))) throw new Error("Run `pnpm build:e2e` first");
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host; // read from the SW URL, never hard-coded
  return { context, extensionId, worker, userDataDir };
}

export async function seedProfile(ext: Ext, profile: UserProfile): Promise<void> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await page.evaluate((p) => chrome.storage.local.set({ "applypilot.profile.v1": p }), profile);
  await page.close();
}

export async function tabIdFor(ext: Ext, page: Page): Promise<number> {
  const url = page.url();
  const id = await ext.worker.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === u)?.id ?? -1;
  }, url);
  expect(id).toBeGreaterThan(-1);
  return id;
}

/** Opens the popup UI in its own tab, aimed at `page`, and clicks Quick Apply. */
export async function quickApply(ext: Ext, page: Page): Promise<Page> {
  const tabId = await tabIdFor(ext, page);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
  await popup.getByTestId("quick-apply").click();
  return popup;
}

export async function waitForState(popup: Page, states: string[]): Promise<string> {
  const status = popup.getByTestId("status");
  await expect.poll(async () => (await status.getAttribute("data-state")) ?? "", { timeout: 20_000 }).toMatch(new RegExp(`^(${states.join("|")})$`));
  return (await status.getAttribute("data-state")) ?? "";
}
