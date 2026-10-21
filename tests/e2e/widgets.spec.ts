import { test, expect, type Page } from "@playwright/test";
import { launchExtension, runPortal, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

type Probe = { __submitted: boolean; __events: { type: string; id: string | null }[] };

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchExtension();
});
test.afterEach(async () => {
  await ext.context.close();
});

const probe = (page: Page) => page.evaluate(() => ({ s: (window as unknown as Probe).__submitted, e: (window as unknown as Probe).__events }));

test.describe("Phase 4b: custom dropdowns and autocomplete", () => {
  test("custom dropdowns: opens, reads the real options, picks by label, and verifies the displayed value", async () => {
    const { page, report, record } = await runPortal(ext, "custom-dropdowns");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#n")).toHaveValue("Alex Example");
    // A div-based combobox whose options already exist in the DOM...
    await expect(page.locator("#ctry")).toHaveText("India");
    await expect(page.locator("#ctry-value")).toHaveValue("IN");
    await expect(page.locator("#ctry")).toHaveAttribute("aria-expanded", "false");
    // ...and a button whose list is created only when it is opened.
    await expect(page.locator("#deg")).toHaveText("Bachelor of Technology");
    await expect(page.locator("#deg-value")).toHaveValue("bachelors");
    expect(report).toMatchObject({ filled: 3, verified: 3, failed: 0 });
    expect(report.results.filter((r) => r.outcome === "filled_verified").map((r) => r.semanticType).sort()).toEqual(["country", "degree", "full_name"]);

    // Only the two dropdown triggers were clicked (plus their options); the submit control never was.
    const p = await probe(page);
    expect(p.s).toBe(false);
    expect(p.e.some((x) => x.id === "submit")).toBe(false);
  });

  test("a profile value with no matching option is reported as failed and the page is left unchanged", async () => {
    const profile = testProfile();
    profile.education[0]!.degree = "Bachelor of Wizardry";
    const { page, report } = await runPortal(ext, "custom-dropdowns", { profile });
    await expect(page.locator("#deg")).toHaveText("Choose a degree");
    await expect(page.locator("#deg-value")).toHaveValue("");
    await expect(page.locator("#deg")).toHaveAttribute("aria-expanded", "false"); // the list was closed again
    await expect(page.locator("#deg-list")).toBeHidden();
    const deg = report.results.find((r) => r.semanticType === "degree")!;
    expect(deg.outcome).toBe("failed");
    expect(deg.reason).toMatch(/No option matches/);
    await expect(page.locator("#ctry")).toHaveText("India"); // the other control still worked
    expect(report).toMatchObject({ filled: 2, verified: 2, failed: 1 });
  });

  test("autocomplete: types, waits for suggestions, selects the exact suggestion and the page registers it", async () => {
    const { page, report, record } = await runPortal(ext, "autocomplete");
    expect(record.state).toBe("READY_FOR_REVIEW");
    await expect(page.locator("#uni")).toHaveValue("Example Institute of Technology");
    await expect(page.locator("#uni-id")).toHaveValue("u1"); // a real selection, not just typed text
    await expect(page.locator("#city")).toHaveValue("Pune"); // exact match, not "Pune Cantonment"
    await expect(page.locator("#city-id")).toHaveValue("c1");
    await expect(page.locator("#uni-msg")).toHaveText("");
    await expect(page.locator("#city-msg")).toHaveText("");
    expect(report).toMatchObject({ filled: 3, verified: 3, failed: 0 });
    const p = await probe(page);
    expect(p.s).toBe(false);
    expect(p.e.some((x) => x.id === "submit")).toBe(false);
  });

  test("autocomplete: typed-but-not-selected is detected, the typed text is removed, and the report says so", async () => {
    const profile = testProfile();
    profile.education[0]!.institution = "Unlisted College of Nothing";
    const { page, report } = await runPortal(ext, "autocomplete", { profile });
    await expect(page.locator("#uni")).toHaveValue(""); // not left looking filled
    await expect(page.locator("#uni-id")).toHaveValue("");
    await expect(page.locator("#uni-msg")).toHaveText(""); // and no stray validation error
    const uni = report.results.find((r) => r.semanticType === "institution")!;
    expect(uni.outcome).toBe("failed");
    expect(uni.reason).toMatch(/No suggestions appeared|not a selection/);
    await expect(page.locator("#city")).toHaveValue("Pune");
    expect(report).toMatchObject({ filled: 2, verified: 2, failed: 1 });
  });

  test("autocomplete: a suggestion that exists only as a prefix is not accepted as a match", async () => {
    const profile = testProfile();
    profile.education[0]!.institution = "Example Institute"; // suggestions exist, but none equals this text exactly
    const { page, report } = await runPortal(ext, "autocomplete", { profile });
    await expect(page.locator("#uni")).toHaveValue("");
    await expect(page.locator("#uni-id")).toHaveValue("");
    const uni = report.results.find((r) => r.semanticType === "institution")!;
    expect(uni.outcome).toBe("failed");
    expect(uni.reason).toMatch(/Typed text is not a selection/);
  });
});
