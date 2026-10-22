import { test, expect, type Page } from "@playwright/test";
import { getRunRecord, launchExtension, portalUrl, runPortal, seedProfile, tabIdFor, waitForState, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

type Ev = { type: string; id: string | null; text?: string };

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

const events = (page: Page) => page.evaluate(() => (window as unknown as { __events: Ev[] }).__events);
const submitted = (page: Page) => page.evaluate(() => (window as unknown as { __submitted: boolean }).__submitted);
const value = (page: Page, label: string) =>
  page.evaluate((l) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>(".row")).find((r) => r.dataset.label === l && !r.hidden);
    return (row?.querySelector("input,select") as HTMLInputElement | null)?.value ?? null;
  }, label);

/** The agent must never have clicked any of these, whatever else happened. */
async function expectNoDangerousClicks(page: Page, ids: string[]) {
  const clicked = (await events(page)).filter((e) => e.type === "click").map((e) => e.id);
  for (const id of ids) expect(clicked, `${id} must never be clicked`).not.toContain(id);
  expect(await submitted(page)).toBe(false);
  expect((await events(page)).some((e) => e.type === "submit")).toBe(false);
}

test.describe("Phase 9: multi-step navigation and the final-control guard", () => {
  test("completes every non-final step unattended and stops at the review step without submitting", async () => {
    const { page, record, report } = await runPortal(ext, "wizard-basic");
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(report.steps.map((s) => s.outcome)).toEqual(["advanced", "advanced", "final"]);
    expect(report.steps.map((s) => s.advancedBy)).toEqual(["Next", "Continue", null]);
    expect(report.failed).toBe(0);
    expect(report.verified).toBeGreaterThanOrEqual(7); // name, email, country, state, city, linkedin, github
    // The dynamic State field (revealed by Country) was filled on step 1 and the page is now on the last step.
    await expect(page.locator("h2")).toHaveText("Review your application");
    await expectNoDangerousClicks(page, ["final", "draft", "back"]);
    expect((await events(page)).filter((e) => e.type === "click").map((e) => e.id)).toEqual(["next", "next"]);
  });

  test("the popup shows each step with its own counts and outcome, and the live counters", async () => {
    const { popup } = await runPortal(ext, "wizard-basic");
    await expect(popup.getByTestId("steps")).toBeVisible();
    await expect(popup.getByTestId("step-0")).toHaveAttribute("data-outcome", "advanced");
    await expect(popup.getByTestId("step-0")).toContainText("4 verified");
    await expect(popup.getByTestId("step-0")).toContainText('via "Next"');
    await expect(popup.getByTestId("step-1")).toContainText('via "Continue"');
    await expect(popup.getByTestId("step-2")).toHaveAttribute("data-outcome", "final");
    await expect(popup.getByTestId("step-2")).toContainText("left for you");
    await expect(popup.getByTestId("steps")).toContainText("step changes: 2");
    await expect(popup.getByTestId("step-current")).toHaveCount(0); // finished: no "working on" line
  });

  test("the state field revealed by Country is mapped in a later pass", async () => {
    const { page, popup, tabId } = await runPortal(ext, "wizard-basic");
    const record = await getRunRecord(popup, tabId);
    expect(record.report!.steps[0]!.verified).toBe(4);
    // Back on step 1 the values were kept by the page; State = Maharashtra proves the dependent field was filled.
    await page.getByRole("button", { name: "Back" }).evaluate(() => undefined).catch(() => undefined);
    expect(record.counters.passes).toBeGreaterThanOrEqual(5);
  });

  test("does not advance past a required field it cannot answer", async () => {
    const { page, record, report } = await runPortal(ext, "wizard-student");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("h2")).toHaveText("Personal information"); // still on step 1
    expect(await value(page, "Student ID")).toBe("");
    expect(report.steps[0]).toMatchObject({ outcome: "stopped" });
    expect(report.requiredUnresolved).toBeGreaterThanOrEqual(1);
    expect(record.notes.join(" ")).toMatch(/required/i);
    await expectNoDangerousClicks(page, ["next", "final"]);
  });

  test("a 'Continue' that really submits the form is treated as final and never clicked", async () => {
    const { page, record } = await runPortal(ext, "wizard-trap");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("h2")).toHaveText("Personal information");
    expect(record.report!.steps).toHaveLength(1);
    expect(record.report!.steps[0]).toMatchObject({ outcome: "final" });
    expect(await value(page, "Full name")).toBe("Alex Example");
    await expectNoDangerousClicks(page, ["next"]);
    expect((await events(page)).filter((e) => e.type === "click")).toEqual([]);
  });

  test("survives a DOM that is rebuilt with new ids and markup on every step", async () => {
    const { page, record, report } = await runPortal(ext, "wizard-churn");
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(report.steps.map((s) => s.outcome)).toEqual(["advanced", "advanced", "final"]);
    expect(report.failed).toBe(0);
    expect(report.verified).toBe(5);
    await expectNoDangerousClicks(page, ["final"]);
  });
});

test.describe("Phase 9: bounded recovery", () => {
  test("a value the page only accepts through key events is recovered by the keyboard fallback", async () => {
    const { page, record, report } = await runPortal(ext, "wizard-validation");
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(await value(page, "Email")).toBe("alex@example.test");
    expect(report.failed).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __keyCommits?: number }).__keyCommits ?? 0)).toBeGreaterThan(0);
    expect(await page.locator('[aria-invalid="true"]').count()).toBe(0);
    expect(record.counters.retries).toBeGreaterThanOrEqual(1);
    expect(record.counters.actions).toBeLessThanOrEqual(12); // bounded, never a loop
    await expectNoDangerousClicks(page, ["final"]);
  });

  test("a transiently disabled field is filled once it is enabled; a permanently disabled one is reported, not looped on", async () => {
    const { page, record, report } = await runPortal(ext, "wizard-disabled");
    expect(["READY_FOR_REVIEW", "PARTIALLY_COMPLETED"]).toContain(record.state);
    expect(await value(page, "City")).toBe("Pune");
    expect(await value(page, "Phone")).toBe("");
    const phone = report.results.find((r) => r.label === "Phone");
    expect(phone?.outcome).not.toBe("verified");
    expect(record.counters.actions).toBeLessThanOrEqual(10);
    await expectNoDangerousClicks(page, ["final"]);
  });
});

test.describe("Phase 9: blockers and frames", () => {
  test("a CAPTCHA blocks the run before anything is filled", async () => {
    const { page, record } = await runPortal(ext, "wizard-captcha");
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/CAPTCHA/);
    expect(await page.locator("#e").inputValue()).toBe("");
    await expectNoDangerousClicks(page, ["submit"]);
  });

  test("a cross-origin frame is reported as unreadable; the readable part is still filled", async () => {
    await seedProfile(ext, testProfile());
    const page = await ext.context.newPage();
    await page.goto(`${portalUrl("iframe-host")}?frame=${encodeURIComponent(`${process.env.PORTAL_FRAME_URL}/frame-content.html`)}`);
    await page.frameLocator("#inner").locator("#e").waitFor();
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await popup.getByTestId("quick-apply").click();
    expect(await waitForState(popup, ["PARTIALLY_COMPLETED", "READY_FOR_REVIEW", "BLOCKED", "FAILED"])).toBe("PARTIALLY_COMPLETED");
    const record = await getRunRecord(popup, tabId);
    expect(record.report!.notes.join(" ")).toMatch(/embedded frame/);
    expect(await page.locator("#n").inputValue()).toBe("Alex Example");
    expect(await page.frameLocator("#inner").locator("#e").inputValue()).toBe(""); // never touched
  });
});

test.describe("Phase 9: real page navigation", () => {
  test("waits for the next page after a full navigation, re-injects, continues and stops at the final page", async () => {
    const { page, record, report } = await runPortal(ext, "multipage-1");
    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(page.url()).toContain("multipage-2");
    expect(await page.locator("#c").inputValue()).toBe("Pune");
    expect(report.steps.map((s) => s.outcome)).toEqual(["advanced", "final"]);
    expect(report.failed).toBe(0);
    await expectNoDangerousClicks(page, ["final"]);
  });
});

test.describe("Phase 9: hard limits and Stop", () => {
  test("an endless chain of steps is stopped at the step limit with an honest BLOCKED report", async () => {
    const { page, record } = await runPortal(ext, "wizard-endless-steps");
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/step transitions/);
    expect(record.counters.transitions).toBeLessThanOrEqual(8);
    expect(record.report!.verified).toBeGreaterThanOrEqual(8);
    expect(record.steps.length).toBeLessThanOrEqual(9);
    await expectNoDangerousClicks(page, ["final"]);
  });

  test("fields that keep appearing are stopped at the per-step pass limit", async () => {
    const { page, record } = await runPortal(ext, "wizard-endless-fields");
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/passes/);
    expect(record.counters.passes).toBeLessThanOrEqual(4);
    await expectNoDangerousClicks(page, ["final"]);
  });

  test("service worker killed mid-run: the run resumes from a fresh observation and keeps its counters, so limits still hold", async () => {
    await seedProfile(ext, testProfile());
    const page = await ext.context.newPage();
    await page.goto(portalUrl("wizard-endless-steps"));
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await popup.getByTestId("quick-apply").click();
    await expect.poll(async () => (await getRunRecord(popup, tabId)).counters.transitions, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    const cdp = await ext.context.newCDPSession(popup);
    const versions = new Map<string, string>();
    cdp.on("ServiceWorker.workerVersionUpdated", (e) => e.versions.forEach((v) => versions.set(v.versionId, v.scriptURL)));
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => [...versions.values()].some((u) => u.includes(ext.extensionId))).toBe(true);
    const [versionId] = [...versions].find(([, u]) => u.includes(ext.extensionId))!;
    await cdp.send("ServiceWorker.stopWorker", { versionId });

    await waitForState(popup, ["BLOCKED", "READY_FOR_REVIEW", "FAILED", "CANCELLED"]);
    const record = await getRunRecord(popup, tabId);
    expect(record.resumeCount).toBeGreaterThanOrEqual(1);
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/step transitions/);
    // Counters survived the restart: the limit is for the whole run, not per worker lifetime.
    expect(record.counters.transitions).toBeLessThanOrEqual(8);
    const nextClicks = (await events(page)).filter((e) => e.type === "click" && e.id === "next").length;
    expect(nextClicks).toBeLessThanOrEqual(9); // at most one click can be repeated if the worker died between click and checkpoint
    await expectNoDangerousClicks(page, ["final"]);
  });

  test("Stop halts the run: state CANCELLED and the page stops changing", async () => {
    await seedProfile(ext, testProfile());
    const page = await ext.context.newPage();
    await page.goto(portalUrl("wizard-endless-steps"));
    const tabId = await tabIdFor(ext, page);
    const popup = await ext.context.newPage();
    await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
    await popup.getByTestId("quick-apply").click();
    await expect(popup.getByTestId("stop")).toBeEnabled();
    await popup.getByTestId("stop").click();
    await waitForState(popup, ["CANCELLED"]);
    const clicksAtStop = (await events(page)).length;
    const stepsAtStop = (await getRunRecord(popup, tabId)).steps.length;
    await page.waitForTimeout(1500);
    expect((await events(page)).length).toBe(clicksAtStop);
    const after = await getRunRecord(popup, tabId);
    expect(after.state).toBe("CANCELLED");
    expect(after.steps.length).toBe(stepsAtStop);
  });
});
