import { chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserProfile } from "../../../src/shared/profile";
import type { RunRecord } from "../../../src/shared/run";
import { testProfile } from "../../fixtures/profile";

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

export type AiConfigInput = {
  enabled?: boolean;
  order?: ("gemini" | "groq")[];
  keys?: Partial<Record<"gemini" | "groq", string>>;
};

/** Configures AI through the same messages the options page uses. */
export async function configureAi(ext: Ext, cfg: AiConfigInput): Promise<void> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/options.html`);
  for (const [provider, secret] of Object.entries(cfg.keys ?? {})) {
    const r = await page.evaluate((a) => chrome.runtime.sendMessage({ kind: "AI_SET_KEY", provider: a.provider, secret: a.secret }), { provider, secret });
    expect(r).toMatchObject({ ok: true });
  }
  if (cfg.enabled !== undefined || cfg.order) {
    const r = await page.evaluate(
      (a) => chrome.runtime.sendMessage({ kind: "AI_SET_SETTINGS", aiEnabled: a.enabled, providerOrder: a.order }),
      { enabled: cfg.enabled ?? false, order: cfg.order ?? ["gemini", "groq"] },
    );
    expect(r).toMatchObject({ ok: true });
  }
  await page.close();
}

export async function getRunRecord(popup: Page, tabId: number): Promise<RunRecord> {
  return (await popup.evaluate(async (id) => (await chrome.runtime.sendMessage({ kind: "GET_RUN", tabId: id })).run, tabId)) as RunRecord;
}

/** Opens a portal, clicks Quick Apply once, waits for a final state, and returns what happened. */
export async function runPortal(ext: Ext, name: string, opts: { profile?: UserProfile; page?: Page } = {}) {
  await seedProfile(ext, opts.profile ?? testProfile());
  const page = opts.page ?? (await ext.context.newPage());
  if (!opts.page) await page.goto(portalUrl(name));
  const tabId = await tabIdFor(ext, page);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
  const previous = (await getRunRecord(popup, tabId))?.runId ?? null;
  await popup.getByTestId("quick-apply").click();
  const final = ["READY_FOR_REVIEW", "BLOCKED", "FAILED", "PARTIALLY_COMPLETED"];
  await expect
    .poll(async () => {
      const r = await getRunRecord(popup, tabId);
      return Boolean(r && r.runId !== previous && final.includes(r.state));
    }, { timeout: 25_000 })
    .toBe(true);
  const record = await getRunRecord(popup, tabId);
  return { page, popup, tabId, record, report: record.report! };
}
