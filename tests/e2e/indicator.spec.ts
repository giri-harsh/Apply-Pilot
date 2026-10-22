import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getRunRecord, launchExtension, portalUrl, seedProfile, tabIdFor, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

const HOST = "#applypilot-indicator-host";
const FINAL = ["READY_FOR_REVIEW", "PARTIALLY_COMPLETED", "BLOCKED", "FAILED", "CANCELLED"];

/** Opens a portal and a popup aimed at it, and starts Quick Apply WITHOUT waiting for the run to finish. */
async function start(portal: string, prep?: (p: Page) => Promise<void>) {
  await seedProfile(ext, testProfile());
  const page = await ext.context.newPage();
  await page.goto(portalUrl(portal));
  await prep?.(page);
  const tabId = await tabIdFor(ext, page);
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html?targetTabId=${tabId}`);
  await popup.getByTestId("quick-apply").click();
  const state = async () => (await getRunRecord(popup, tabId))?.state ?? "";
  return { page, popup, tabId, state };
}

/** Rectangles of the pill and of every visible control, measured in one page evaluation. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const host = document.getElementById("applypilot-indicator-host");
    const pill = host?.shadowRoot?.querySelector(".pill") as HTMLElement | null;
    if (!pill) return null;
    const p = pill.getBoundingClientRect();
    const hit = Array.from(document.querySelectorAll("input,select,textarea,button,a[href],[role=button]"))
      .filter((e) => e !== host)
      .map((e) => ({ id: (e as HTMLElement).id || e.tagName, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight)
      .filter(({ r }) => !(p.right < r.left || p.left > r.right || p.bottom < r.top || p.top > r.bottom))
      .map((x) => x.id);
    return { hit, w: p.width, h: p.height };
  });

test.describe("in-page status indicator (SPEC 5.3)", () => {
  test("shows the state during a run, ends with 'Ready for your review', and removes itself afterwards", async () => {
    const { page, state } = await start("wizard-basic");
    await expect(page.locator(HOST)).toHaveCount(1, { timeout: 10_000 });
    const labels = new Set<string>();
    await expect
      .poll(async () => {
        const t = await page.locator(`${HOST} .label`).first().textContent({ timeout: 500 }).catch(() => null);
        if (t) labels.add(t);
        return FINAL.includes(await state());
      }, { timeout: 30_000, intervals: [50] })
      .toBe(true);
    await expect(page.locator(`${HOST} .label`)).toHaveText("Ready for your review");
    await expect(page.locator(`${HOST} .stop`)).toBeHidden(); // nothing left to stop
    expect([...labels].some((l) => /Inspecting|Mapping|Filling|Verifying|Moving/.test(l))).toBe(true);
    await expect(page.locator(HOST)).toHaveCount(0, { timeout: 15_000 }); // auto-removed
  });

  test("Stop on the page halts the run immediately: CANCELLED, no more steps, and the pill says so", async () => {
    const { page, popup, tabId } = await start("wizard-endless-steps");
    await expect(page.locator(`${HOST} .stop`)).toBeVisible({ timeout: 10_000 });
    await page.locator(`${HOST} .stop`).click();
    await expect.poll(async () => (await getRunRecord(popup, tabId))?.state).toBe("CANCELLED");
    const clicks = () => page.evaluate(() => (window as unknown as { __events: unknown[] }).__events.length);
    const at = await clicks();
    const steps = (await getRunRecord(popup, tabId))!.steps.length;
    await page.waitForTimeout(1500);
    expect(await clicks()).toBe(at); // no further clicks on the page
    expect((await getRunRecord(popup, tabId))!.steps.length).toBe(steps);
    await expect(page.locator(`${HOST} .label`)).toHaveText("Stopped");
  });

  for (const portal of ["basic", "required-optional", "sensitive", "dynamic-conditional", "wizard-basic", "wizard-validation", "react-controlled"]) {
    test(`never covers a field or button while it runs on ${portal}`, async () => {
      const { page, state } = await start(portal);
      let samples = 0;
      const seen: string[] = [];
      await expect
        .poll(async () => {
          const m = await measure(page);
          if (m) {
            samples++;
            seen.push(...m.hit);
          }
          return FINAL.includes(await state());
        }, { timeout: 30_000, intervals: [40] })
        .toBe(true);
      expect(samples).toBeGreaterThan(0); // it was there to be measured
      expect(seen, `the indicator overlapped: ${[...new Set(seen)].join(", ")}`).toEqual([]);
    });
  }

  test("page CSS cannot hide or restyle it, and it does not restyle the page", async () => {
    // A hostile stylesheet: everything below <html> is hidden, blown up and made transparent, and the host is targeted by id.
    const { page } = await start("wizard-endless-steps", async (p) => {
      await p.addStyleTag({ content: "html { font-size: 90px !important } div, span, button { font-size: 90px !important; opacity: 0.05 !important } #applypilot-indicator-host, div#applypilot-indicator-host { display: none !important; visibility: hidden !important; opacity: 0 !important; transform: scale(0) !important }" });
    });
    await expect(page.locator(`${HOST} .pill`)).toBeVisible({ timeout: 10_000 });
    const m = await measure(page);
    expect(m!.w).toBeLessThan(320); // not blown up by the page's font-size
    // our CSS did not leak into the page: the page's own button keeps the page's computed style
    const pageButtonFont = await page.evaluate(() => getComputedStyle(document.querySelector("#next")!).fontSize);
    expect(pageButtonFont).toBe("90px"); // the page's own rules still apply to the page's own button (our CSS stayed inside the shadow root)
    await page.locator(`${HOST} .stop`).click();
  });

  test("collapse works, and the setting turns the indicator off completely", async () => {
    const a = await start("wizard-endless-steps");
    await expect(a.page.locator(`${HOST} .ghost`)).toBeVisible({ timeout: 10_000 });
    await a.page.locator(`${HOST} .ghost`).click();
    await expect(a.page.locator(`${HOST} .pill.collapsed`)).toHaveCount(1);
    await a.page.locator(`${HOST} .stop`).dispatchEvent("click");
    await expect.poll(async () => (await getRunRecord(a.popup, a.tabId))?.state).toBe("CANCELLED");
    await a.page.close();
    await a.popup.close();

    const o = await ext.context.newPage();
    await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await o.getByRole("tab", { name: "Diagnostics" }).click();
    await o.getByTestId("indicator-toggle").click();
    await expect.poll(async () => ext.worker.evaluate(async () => (await chrome.storage.local.get("applypilot.indicator.settings.v1"))["applypilot.indicator.settings.v1"])).toEqual({ enabled: false });
    const b = await start("wizard-basic");
    await expect.poll(b.state, { timeout: 30_000 }).toBe("READY_FOR_REVIEW");
    await expect(b.page.locator(HOST)).toHaveCount(0);
  });

  test("a web page cannot use the Stop channel, and the pill has no accessibility violations", async () => {
    const { page, popup, tabId } = await start("wizard-endless-steps");
    await expect(page.locator(`${HOST} .stop`)).toBeVisible({ timeout: 10_000 });
    const axe = await new AxeBuilder({ page }).include(HOST).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    // page script has no chrome.runtime to message the extension with
    const reachable = await page.evaluate(() => typeof (window as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage);
    expect(reachable).toBe("undefined");
    expect((await getRunRecord(popup, tabId))?.state).not.toBe("CANCELLED");
    await page.locator(`${HOST} .stop`).click();
  });
});
