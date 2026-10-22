import { test, expect, type Page } from "@playwright/test";
import { configureAi, launchExtension, portalUrl, runPortal, type Ext } from "./support/extension";
import { installMockAi, item, textOf, type MockAi } from "./support/mock-ai";
import { profileStrings } from "../../src/diagnostics/redact";
import { testProfile } from "../fixtures/profile";

const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };
const LEARNED_KEY = "applypilot.learned.v1";

let ext: Ext;
let ai: MockAi;
test.beforeEach(async () => {
  ext = await launchExtension();
  ai = await installMockAi(ext.context);
});
test.afterEach(async () => {
  await ext.context.close();
});

const learned = () => ext.worker.evaluate(async (k) => ((await chrome.storage.local.get(k))[k] ?? []) as { kind: string; host: string; confidence: number; failures: number; successes: number; value: Record<string, string> }[], LEARNED_KEY);
const aiCalls = () => ai.calls.gemini + ai.calls.groq;
async function fresh(portal: string, prep?: (p: Page) => Promise<void>) {
  const page = await ext.context.newPage();
  await page.goto(portalUrl(portal));
  await prep?.(page);
  return runPortal(ext, "", { page }).then(async (r) => {
    await r.popup.close();
    return r;
  });
}

// Opaque labels: only the (mocked) AI can place these. Item 1 first name, 2 last name, 3 email, 4 phone.
const MAP: Record<string, [string, string]> = { "item 1": ["first_name", "personal.firstName"], "item 2": ["last_name", "personal.lastName"], "item 3": ["email", "personal.email"], "item 4": ["phone", "personal.phone"] };
const answer = (fields: Parameters<NonNullable<Parameters<MockAi["set"]>[1]["respond"]>>[0]) =>
  fields.map((f) => {
    const m = MAP[textOf(f).toLowerCase().split("|")[0]!.trim()];
    return m ? item(f.fieldId, m[0], m[1]) : item(f.fieldId, "unknown", "none", 0.1);
  });

test.describe("Phase 8b: verified learned strategies", () => {
  test("a field mapping the AI made and the page verified is learned; run 2 uses it with ZERO AI calls (cache cleared to prove it)", async () => {
    await configureAi(ext, { enabled: true, keys: KEYS });
    ai.set("gemini", { respond: answer });
    ai.set("groq", { respond: answer });

    const one = await fresh("fakeats/step1");
    expect(aiCalls()).toBeGreaterThan(0);
    expect(one.report.results.filter((r) => r.outcome === "filled_verified").length).toBeGreaterThanOrEqual(4);
    const rows = await learned();
    expect(rows.filter((r) => r.kind === "field_mapping").length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.confidence === 0.6 && r.failures === 0)).toBe(true);
    const json = JSON.stringify(rows).toLowerCase();
    for (const s of profileStrings(testProfile())) expect(json, `learned store leaks "${s}"`).not.toContain(s.toLowerCase());

    // the Phase 4 mapping cache would also answer run 2: clear it, so only the learned strategies can
    await one.page.close();
    const p = await ext.context.newPage();
    await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await p.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await p.close();

    const before = aiCalls();
    const two = await fresh("fakeats/step1");
    expect(aiCalls()).toBe(before); // no request at all
    expect(two.report.results.filter((r) => r.outcome === "filled_verified").length).toBeGreaterThanOrEqual(4);
    expect(two.record.ai.requests).toBe(0);
    expect((await learned()).filter((r) => r.kind === "field_mapping").every((r) => r.successes >= 2)).toBe(true); // confirmed by use
  });

  test("a changed page structure is not matched: the AI is asked again", async () => {
    await configureAi(ext, { enabled: true, keys: KEYS });
    ai.set("gemini", { respond: answer });
    ai.set("groq", { respond: answer });
    await (await fresh("fakeats/step1")).page.close();
    const p = await ext.context.newPage();
    await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await p.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await p.close();
    const before = aiCalls();
    // a redesign: half of the fields are gone and new ones appeared (similarity far below the tolerance)
    await fresh("fakeats/step1", (page) =>
      page.evaluate(() => {
        ["b", "d", "g"].forEach((id) => document.getElementById(id)?.remove());
        for (const l of Array.from(document.querySelectorAll("label[for=b],label[for=d],label[for=g]"))) l.remove();
        const f = document.querySelector("form")!;
        const added: [string, string][] = [["x1", "Item 9"], ["x2", "Item 10"], ["x3", "Item 11"]];
        for (const [id, label] of added) {
          const lab = document.createElement("label");
          lab.htmlFor = id;
          lab.textContent = label;
          const inp = document.createElement("input");
          inp.id = id;
          f.prepend(inp);
          f.prepend(lab);
        }
      }),
    );
    expect(aiCalls()).toBeGreaterThan(before);
  });

  test("a learned mapping whose use fails verification is demoted and no longer used", async () => {
    await configureAi(ext, { enabled: true, keys: KEYS });
    ai.set("gemini", { respond: answer });
    ai.set("groq", { respond: answer });
    await (await fresh("fakeats/step1")).page.close();
    const p = await ext.context.newPage();
    await p.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await p.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await p.close();

    // run 2: the page now wipes the email field whenever it changes, so the learned mapping's fill cannot be verified
    await fresh("fakeats/step1", (page) => page.evaluate(() => document.getElementById("c")!.addEventListener("input", (e) => ((e.target as HTMLInputElement).value = ""))));
    const emailRow = (await learned()).find((r) => r.value.semanticType === "email")!;
    expect(emailRow.failures).toBeGreaterThanOrEqual(1);
    expect(emailRow.confidence).toBeLessThan(0.5); // demoted: kept as evidence, never used

    await configureAi(ext, { enabled: true });
    const before = aiCalls();
    await fresh("fakeats/step1");
    expect(aiCalls()).toBeGreaterThan(before); // the demoted strategy was not used, so the AI is asked about that field again
  });

  test("an input strategy that recovery had to find (keyboard typing) becomes the first attempt next time: fewer actions, no retries", async () => {
    const one = await fresh("wizard-validation");
    expect(one.record.counters.retries).toBeGreaterThanOrEqual(1);
    const actions1 = one.record.counters.actions;
    expect((await learned()).some((r) => r.kind === "input_strategy" && r.value.inputStrategy === "keyboard")).toBe(true);
    await one.page.close();

    const two = await fresh("wizard-validation");
    expect(two.record.counters.retries).toBe(0);
    expect(two.record.counters.actions).toBeLessThan(actions1);
    expect(two.report.failed).toBe(0);
    expect(two.report.results.find((r) => r.label === "Email *")?.outcome ?? "filled_verified").toBe("filled_verified");
  });

  test("learning off: nothing is recorded and nothing is reused; the Diagnostics tab lists, deletes and switches learning", async () => {
    const o = await ext.context.newPage();
    await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await o.getByRole("tab", { name: "Diagnostics" }).click();
    await o.getByTestId("learning-toggle").click();
    await expect.poll(async () => ext.worker.evaluate(async () => (await chrome.storage.local.get("applypilot.learning.settings.v1"))["applypilot.learning.settings.v1"])).toEqual({ enabled: false });
    await (await fresh("wizard-validation")).page.close();
    expect(await learned()).toEqual([]);

    await o.getByTestId("learning-toggle").click();
    await expect.poll(async () => ext.worker.evaluate(async () => (await chrome.storage.local.get("applypilot.learning.settings.v1"))["applypilot.learning.settings.v1"])).toEqual({ enabled: true });
    await (await fresh("wizard-validation")).page.close();
    await o.reload();
    await o.getByRole("tab", { name: "Diagnostics" }).click();
    await expect(o.getByTestId("learned-row").first()).toContainText("keyboard");
    const before = await o.getByTestId("learned-row").count();
    await o.getByTestId("learned-delete").first().click();
    await expect(o.getByTestId("learned-row")).toHaveCount(before - 1);
    if (before - 1 > 0) await o.getByTestId("learned-delete-all").click();
    await expect(o.getByTestId("no-learned")).toBeVisible();
    expect(await learned()).toEqual([]);
  });
});
