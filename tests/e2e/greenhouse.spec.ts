import { test, expect, type Page } from "@playwright/test";
import { launchExtension, portalUrl, runPortal, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

const P = "greenhouse-invisible-recaptcha";
const val = (p: Page, sel: string) => p.locator(sel).inputValue();

test.describe("Greenhouse-style board with invisible reCAPTCHA (real-portal bug)", () => {
  test("the invisible badge, its anchor, the 0x0 frames and the response textarea do not block; the form is filled and the declaration is left alone", async () => {
    const { page, popup, record, report } = await runPortal(ext, `${P}/index`);
    expect(record.state).not.toBe("BLOCKED");
    expect(record.state).toMatch(/READY_FOR_REVIEW|PARTIALLY_COMPLETED/);
    expect(record.counters.actions, JSON.stringify(report.results.map((r) => [r.label, r.outcome, r.reason.slice(0, 60)]))).toBeGreaterThanOrEqual(7); // six text fields plus the country

    expect(await val(page, "#first_name")).toBe("Alex");
    expect(await val(page, "#last_name")).toBe("Example");
    expect(await val(page, "#preferred_name")).toBe("Lex");
    expect(await val(page, "#email")).toBe("alex@example.test");
    expect(await val(page, "#phone")).toBe("+91 98765 43210");
    expect(await val(page, "#question_69658288")).toBe("https://www.linkedin.com/in/alex-example");

    // the country control was driven through its own list and shows India's flag and dial code
    expect(await page.locator("#country").getAttribute("title")).toBe("India: +91");
    expect(await page.locator("#country .iti__selected-dial-code").textContent()).toBe("+91");
    expect(await page.evaluate(() => (window as unknown as { __country?: string }).__country)).toBe("in");

    // the declaration is never typed; it and the resume file are reported as required and unresolved
    expect(await val(page, "#question_69658289")).toBe("");
    const ack = report.results.find((r) => /Acknowledgement/.test(r.label))!;
    expect(ack.outcome).not.toBe("filled_verified");
    expect(ack.required).toBe(true);
    expect(report.requiredUnresolved).toBeGreaterThanOrEqual(2);

    // company comes from "Job Application for <role> at <Company>": the LAST " at "
    expect(record.job?.company).toBe("Acme Robotics");
    await expect(popup.getByTestId("company")).toHaveText("Acme Robotics");
    const clicked = await page.evaluate(() => (window as unknown as { __events: { id: string | null }[] }).__events.map((e) => e.id));
    expect(clicked).not.toContain("submit");
  });

  test("a phone stored without a country code is not given one", async () => {
    const profile = testProfile();
    profile.personal.phone = "98765 43210";
    const { page } = await runPortal(ext, `${P}/index`, { profile });
    expect(await val(page, "#phone")).toBe("98765 43210");
  });

  test("a hidden or off-screen badge never blocks (visibility hidden, display none, moved away)", async () => {
    for (const css of ["visibility:hidden", "display:none", "position:fixed;left:-9999px;top:-9999px"]) {
      const page = await ext.context.newPage();
      await page.goto(portalUrl(`${P}/index`));
      await page.evaluate((c) => ((document.querySelector(".grecaptcha-badge") as HTMLElement).style.cssText += `;${c}`), css);
      const { record } = await runPortal(ext, "", { page });
      expect(record.state, css).not.toBe("BLOCKED");
      await page.close();
    }
  });

  test("a visible reCAPTCHA v2 checkbox next to the badge blocks before anything is filled", async () => {
    const { page, record } = await runPortal(ext, `${P}/visible-v2`);
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/CAPTCHA/);
    expect(record.counters.actions).toBe(0);
    expect(await val(page, "#first_name")).toBe("");
  });

  test("an invisible anchor that escalates to a visible challenge after the first fill pauses the run and reports the progress made", async () => {
    const { page, record, report } = await runPortal(ext, `${P}/escalates`);
    expect(record.state).toBe("BLOCKED");
    expect(record.reason).toMatch(/CAPTCHA/);
    expect(record.reason).toMatch(/appeared during the run, after \d+ field\(s\) were filled/);
    expect(report.verified).toBeGreaterThanOrEqual(1);
    expect(await val(page, "#first_name")).toBe("Alex"); // what was filled stays, nothing is undone
    const clicked = await page.evaluate(() => (window as unknown as { __events: { id: string | null }[] }).__events.map((e) => e.id));
    expect(clicked).not.toContain("submit");
  });
});
