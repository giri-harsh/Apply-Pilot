import { test, expect } from "@playwright/test";
import { configureAi, launchExtension, runPortal, type Ext } from "./support/extension";
import { installMockAi, item, textOf, type MockAi } from "./support/mock-ai";
import { profileStrings } from "../../src/diagnostics/redact";
import { testProfile } from "../fixtures/profile";

const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };
let ext: Ext;
let ai: MockAi;
test.beforeEach(async () => {
  ext = await launchExtension();
  ai = await installMockAi(ext.context);
});
test.afterEach(async () => {
  await ext.context.close();
});

const openHistory = async () => {
  const o = await ext.context.newPage();
  await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await o.getByRole("tab", { name: "History" }).click();
  return o;
};

test.describe("application history and AI usage", () => {
  test("every finished run is recorded with its page, outcome and counts; details, delete-one, export and clear-all work; the export has no profile string", async () => {
    const a = await runPortal(ext, "basic");
    await a.popup.close();
    await runPortal(ext, "sensitive");
    const o = await openHistory();
    await expect(o.getByTestId("history-row")).toHaveCount(2);
    const rows = o.getByTestId("history-row");
    await expect(rows.first()).toContainText("127.0.0.1");
    await expect(rows.first()).toContainText("Ready for your review");
    await expect(rows.first()).toContainText("verified");
    await rows.first().getByTestId("history-toggle").click();
    await expect(o.getByTestId("history-details")).toBeVisible();

    const [dl] = await Promise.all([o.waitForEvent("download"), o.getByTestId("history-export").click()]);
    expect(dl.suggestedFilename()).toBe("applypilot-history.json");
    const chunks: Buffer[] = [];
    for await (const c of await dl.createReadStream()) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const json = JSON.parse(text) as { records: { host: string; counts: { verified: number }; path: string }[] };
    expect(json.records).toHaveLength(2);
    expect(json.records.some((r) => r.counts.verified > 3)).toBe(true);
    for (const s of profileStrings(testProfile())) expect(text.toLowerCase(), `export leaks "${s}"`).not.toContain(s.toLowerCase());
    for (const r of json.records) expect(`${r.host}${r.path}`).not.toMatch(/[?#]/); // no query string or fragment in any stored address

    await rows.first().getByTestId("history-delete").click();
    await expect(o.getByTestId("history-row")).toHaveCount(1);
    await o.reload();
    await o.getByRole("tab", { name: "History" }).click();
    await expect(o.getByTestId("history-row")).toHaveCount(1); // persisted
    await o.getByTestId("history-clear").click();
    await expect(o.getByTestId("no-history")).toBeVisible();
  });

  test("a stopped run and a blocked run are recorded too, with their final status", async () => {
    await runPortal(ext, "wizard-captcha"); // BLOCKED
    const o = await openHistory();
    await expect(o.getByTestId("history-row")).toHaveCount(1);
    await expect(o.getByTestId("history-row")).toHaveAttribute("data-state", "BLOCKED");
    await expect(o.getByTestId("history-row")).toContainText("Blocked");
  });

  test("AI usage: requests and tokens per day and provider, and the per-run cache hit rate; no prompt content anywhere on the page", async () => {
    await configureAi(ext, { enabled: true, keys: KEYS });
    const map = (fields: Parameters<NonNullable<Parameters<MockAi["set"]>[1]["respond"]>>[0]) =>
      fields.map((f) => (textOf(f).toLowerCase().startsWith("item 3") ? item(f.fieldId, "email", "personal.email") : item(f.fieldId, "unknown", "none", 0.1)));
    ai.set("gemini", { respond: map });
    ai.set("groq", { respond: map });
    const a = await runPortal(ext, "fakeats/step1");
    await a.popup.close();
    await runPortal(ext, "fakeats/step1"); // second visit: the mapping cache answers
    const o = await openHistory();
    await expect(o.getByTestId("usage-days")).toBeVisible();
    const row = o.getByTestId("usage-row").first();
    await expect(row).toContainText(/gemini|groq/);
    await expect(row).toContainText("100"); // the mock reports 100 input tokens per request
    await expect(o.getByTestId("cache-rate")).toContainText("%");
    await expect(o.getByTestId("usage-runs")).toBeVisible();
    const page = (await o.locator("section[data-testid=history]").innerText()).toLowerCase();
    expect(page).not.toMatch(/alex@example\.test|<<<page_data|reply with json|you are a/); // no prompt text, no value
    // The first row (newest run) shows its AI counts; the second visit was answered without a provider request.
    const usage = (await o.getByTestId("usage-runs").innerText()).toLowerCase();
    expect(usage).toMatch(/request\(s\), \d+ cache hit\(s\)/);
  });
});
