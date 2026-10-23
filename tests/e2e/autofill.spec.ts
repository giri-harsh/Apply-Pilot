import { test, expect, type Page } from "@playwright/test";
import { launchExtension, portalUrl, seedProfile, tabIdFor, waitForState, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";
import type { RunRecord } from "../../src/shared/run";
import type { UserProfile } from "../../src/shared/profile";

type Probe = { __submitted: boolean; __events: { type: string; id: string | null }[] };

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

/** Opens a portal, runs Quick Apply (the only click), and records every http(s) request made during the run. */
async function run(name: string, profile: UserProfile = testProfile()) {
  await seedProfile(ext, profile);
  const page = await ext.context.newPage();
  await page.goto(portalUrl(name));
  const tabId = await tabIdFor(ext, page);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);

  const requests: string[] = [];
  ext.context.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  // Counted by name, ignoring the favicon: the browser may add its own entry at any moment (same fragility as the request monitor test).
  const resourceCount = () => page.evaluate(() => performance.getEntriesByType("resource").filter((e) => !e.name.endsWith("/favicon.ico")).length);
  const resourcesBefore = await resourceCount();
  await popup.getByTestId("quick-apply").click();
  await waitForState(popup, ["READY_FOR_REVIEW", "BLOCKED", "FAILED", "PARTIALLY_COMPLETED"]);
  const record = (await popup.evaluate(async (id) => (await chrome.runtime.sendMessage({ kind: "GET_RUN", tabId: id })).run, tabId)) as RunRecord;
  const resourcesAfter = await resourceCount();
  return { page, popup, record, report: record.report!, requests, newResources: resourcesAfter - resourcesBefore };
}

async function probe(page: Page) {
  return page.evaluate(() => ({ submitted: (window as unknown as Probe).__submitted, events: (window as unknown as Probe).__events }));
}
async function expectUntouched(page: Page, selectors: string[]) {
  for (const s of selectors) {
    const el = page.locator(s);
    const type = await el.getAttribute("type");
    if (type === "checkbox" || type === "radio") await expect(el).not.toBeChecked();
    else await expect(el).toHaveValue("");
  }
}

test.describe("Phase 3: deterministic autofill on synthetic portals", () => {
  test("basic form: Quick Apply fills and verifies common fields with one click, no network, no submit", async () => {
    const { page, popup, record, report, requests, newResources } = await run("basic");
    expect(record.state).toBe("READY_FOR_REVIEW");

    await expect(page.locator("#fullname")).toHaveValue("Alex Example");
    await expect(page.locator("#email")).toHaveValue("alex@example.test");
    await expect(page.locator("#phone")).toHaveValue("+91 98765 43210");
    await expect(page.locator("#city")).toHaveValue("Pune");
    await expect(page.locator("#country")).toHaveValue("IN");
    await expect(page.locator("#linkedin")).toHaveValue("https://www.linkedin.com/in/alex-example");
    await expect(page.locator("#github")).toHaveValue("https://github.com/alex-example");
    await expect(page.locator("#school")).toHaveValue("Example Institute of Technology");
    await expect(page.locator("#degree")).toHaveValue("Bachelor of Technology");
    await expect(page.locator("#gradyear")).toHaveValue("2027");

    expect(report).toMatchObject({ totalFields: 10, filled: 10, verified: 10, failed: 0, skippedSensitive: 0, ambiguous: 0, unresolved: 0 });
    await expect(popup.getByTestId("report")).toContainText("Fields filled: 10");
    await expect(popup.getByTestId("report")).toContainText("Fields verified: 10");

    // Zero AI / network calls and the application was not submitted.
    expect(requests).toEqual([]);
    expect(newResources).toBe(0);
    const p = await probe(page);
    expect(p.submitted).toBe(false);
    expect(p.events).toEqual([]);
  });

  test("unusual labels: resolves aria/wrapping/placeholder/autocomplete signals and stays conservative on weak ones", async () => {
    const { page, report, record } = await run("unusual-labels");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator('input[name="q_17"]')).toHaveValue("Alex"); // wrapping label "Given name"
    await expect(page.locator('input[name="q_18"]')).toHaveValue("Example"); // "Surname"
    await expect(page.locator('input[name="f3"]')).toHaveValue("alex@example.test"); // aria-label
    await expect(page.locator('input[name="f4"]')).toHaveValue("+91 98765 43210"); // aria-labelledby
    await expect(page.locator('input[name="f5"]')).toHaveValue("Pune"); // placeholder
    await expect(page.locator('input[name="f6"]')).toHaveValue("411001"); // autocomplete token
    // "GitHub profile" is only in nearby text (low confidence) and "Favourite colour" is unknown: both left alone and reported.
    await expectUntouched(page, ['input[name="f7"]', 'input[name="colour"]']);
    expect(report.filled).toBe(6);
    expect(report.verified).toBe(6);
    expect(report.unresolved).toBe(2);
  });

  test("duplicate labels: reference-section fields and indistinguishable duplicates are not filled", async () => {
    const { page, report, record } = await run("duplicate-labels");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#a-name")).toHaveValue("Alex Example");
    await expect(page.locator("#a-email")).toHaveValue("alex@example.test");
    await expect(page.locator("#a-email2")).toHaveValue("alex@example.test"); // deliberate confirmation field
    await expectUntouched(page, ["#r-name", "#r-email", "#r-phone", "#x1", "#x2"]);
    expect(report.filled).toBe(3);
    expect(report.ambiguous).toBe(2);
    expect(report.results.filter((r) => r.outcome === "skipped_third_party")).toHaveLength(3);
  });

  test("React-controlled inputs: React state updates, not just the DOM value", async () => {
    const { page, report, record } = await run("react-controlled");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#rname")).toHaveValue("Alex Example");
    // These <output> elements render React state; they only change if React processed a real change event.
    await expect(page.getByTestId("state-name")).toHaveText("Alex Example");
    await expect(page.getByTestId("state-email")).toHaveText("alex@example.test");
    await expect(page.getByTestId("state-phone")).toHaveText("+91 98765 43210");
    await expect(page.getByTestId("state-country")).toHaveText("IN");
    await expect(page.locator("#remail-err")).toHaveText("");
    expect(report).toMatchObject({ filled: 4, verified: 4, failed: 0 });
  });

  test("React-controlled inputs: a field-level validation message is detected and reported, not claimed as success", async () => {
    const profile = testProfile();
    profile.personal.email = "alex@example.co"; // passes the vault format check but fails this portal stricter TLD rule
    const { page, report } = await run("react-controlled", profile);
    await expect(page.locator("#remail")).toHaveValue("alex@example.co");
    await expect(page.locator("#remail-err")).toHaveText("Enter a valid email");
    const email = report.results.find((r) => r.semanticType === "email")!;
    expect(email.outcome).toBe("failed");
    expect(email.reason).toContain("Enter a valid email");
    expect(report.verified).toBe(report.filled - 1);
    expect(report.failed).toBe(1);
  });

  test("required/optional mix: existing values kept, disabled/hidden untouched, required gaps reported", async () => {
    const { page, report, record } = await run("required-optional");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#n")).toHaveValue("Alex Example");
    await expect(page.locator("#e")).toHaveValue("alex@example.test");
    await expect(page.locator("#p")).toHaveValue("+91 98765 43210");
    await expect(page.locator("#sel")).toHaveValue("bachelors");
    await expect(page.locator("#pre")).toHaveValue("Existing Value"); // not overwritten
    await expectUntouched(page, ["#ce", "#why", "#dis", "#trap"]);
    expect(report.totalFields).toBe(8); // the hidden control is not counted
    expect(report.filled).toBe(4);
    expect(report.verified).toBe(4);
    expect(report.requiredUnresolved).toBe(2); // current employer + why
  });

  test("sensitive eligibility: nothing sensitive is answered, salary and consent are left alone", async () => {
    const { page, report, record } = await run("sensitive");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#n")).toHaveValue("Alex Example");
    await expect(page.locator("#e")).toHaveValue("alex@example.test");
    for (const s of ["#auth", "#gender", "#vet", "#dis", "#race"]) await expect(page.locator(s)).toHaveValue("");
    await expectUntouched(page, ["#crim", "#sal", "#dob", "#consent", 'input[name="sponsor"][value="yes"]', 'input[name="sponsor"][value="no"]']);
    expect(report.filled).toBe(2);
    expect(report.skippedSensitive).toBe(9);
    expect(report.results.find((r) => r.semanticType === "salary")!.outcome).toBe("skipped_sensitive");
    expect(report.results.find((r) => r.semanticType === "consent")!.outcome).toBe("skipped_consent");
  });

  test("adversarial page text is data: nothing outside the allowed actions happens and submit is never clicked", async () => {
    const { page, report, record, requests } = await run("adversarial");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#n")).toHaveValue("Alex Example"); // not "HACKED"
    await expect(page.locator("#e")).toHaveValue("alex@example.test");
    await expectUntouched(page, ["#ssn", "#notes", "#hp", "#agree"]);
    const honeypot = await page.locator("#hp").evaluate((el) => (el as HTMLInputElement).value);
    expect(honeypot).toBe("");
    expect(report.filled).toBe(2);

    const p = await probe(page);
    expect(p.submitted).toBe(false);
    expect(p.events).toEqual([]); // no button, link or submit control was clicked
    expect(requests.filter((u) => !u.startsWith(process.env.PORTAL_BASE_URL!))).toEqual([]);
    expect(requests).toEqual([]);
    // The injected "reveal profile" text produced no copy of profile data in the page.
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("alex-example");
  });

  test("Quick Apply is idempotent: running again keeps values and reports them as already correct", async () => {
    const { page, popup } = await run("basic");
    await popup.getByTestId("quick-apply").click();
    await expect.poll(async () => (await popup.getByTestId("report").textContent()) ?? "").toContain("Fields filled: 0");
    await expect(page.locator("#email")).toHaveValue("alex@example.test");
    const record = (await popup.evaluate(async (id) => (await chrome.runtime.sendMessage({ kind: "GET_RUN", tabId: id })).run, await tabIdFor(ext, page))) as RunRecord;
    expect(record.report!.alreadyCorrect).toBe(10);
    expect(record.report!.failed).toBe(0);
  });
});

test("the request monitor used by the no-network assertions really observes traffic", async () => {
  const page = await ext.context.newPage();
  await page.goto(portalUrl("basic"));
  const seen: string[] = [];
  ext.context.on("request", (r) => {
    // The browser may fetch /favicon.ico for the page at any moment; it is not traffic this test causes.
    if (/^https?:/.test(r.url()) && !r.url().endsWith("/favicon.ico")) seen.push(r.url());
  });
  // Compare by name, not by count: the browser may add its own entry (for example the favicon) at any moment.
  const names = () => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => !n.endsWith("/favicon.ico")));
  const before = await names();
  await page.evaluate(() => fetch("/basic.html").then((r) => r.text()));
  expect(seen).toHaveLength(1);
  const after = await names();
  expect(after.slice(before.length)).toEqual([expect.stringMatching(/\/basic\.html$/)]);
});
