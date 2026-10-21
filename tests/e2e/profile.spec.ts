import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { freshUserDataDir, launchExtension, portalUrl, quickApply, waitForState, type Ext } from "./support/extension";
import { testProfile } from "../fixtures/profile";

const optionsUrl = (e: Ext) => `chrome-extension://${e.extensionId}/options.html`;

async function fill(page: Page, name: string, value: string) {
  await page.locator(`[name="${name}"]`).fill(value);
}
async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}
async function save(page: Page) {
  await page.getByTestId("save").click();
}
async function storedProfile(page: Page) {
  return page.evaluate(async () => (await chrome.storage.local.get("applypilot.profile.v1"))["applypilot.profile.v1"]);
}

test.describe("Phase 2: profile vault", () => {
  test("full CRUD across every section persists across a browser restart and feeds autofill", async () => {
    const dir = freshUserDataDir();
    let ext = await launchExtension(dir);
    let page = await ext.context.newPage();
    await page.goto(optionsUrl(ext));

    // Personal
    await fill(page, "personal.fullName", "Priya Sharma");
    await fill(page, "personal.firstName", "Priya");
    await fill(page, "personal.lastName", "Sharma");
    await fill(page, "personal.email", "priya@example.test");
    await fill(page, "personal.phone", "+91 90000 11111");
    await fill(page, "personal.city", "Mumbai");
    await fill(page, "personal.country", "India");
    await fill(page, "personal.githubUrl", "https://github.com/priya");

    // Education
    await tab(page, "Education");
    await page.getByTestId("add-education").click();
    await fill(page, "education.0.institution", "Mumbai Institute");
    await fill(page, "education.0.degree", "Bachelor of Technology");
    await fill(page, "education.0.expectedGraduationDate", "2027-05");
    // Skills
    await tab(page, "Skills");
    await page.getByTestId("add-skills").click();
    await fill(page, "skills.0.name", "Python");
    await page.locator('[name="skills.0.category"]').selectOption("programming_languages");
    // Projects
    await tab(page, "Projects");
    await page.getByTestId("add-projects").click();
    await fill(page, "projects.0.name", "Resume Parser");
    await fill(page, "projects.0.technologies", "Python\nSpaCy");
    await fill(page, "projects.0.metrics", "Parsed 500 resumes | own benchmark, README");
    // Experience
    await tab(page, "Experience");
    await page.getByTestId("add-experience").click();
    await fill(page, "experience.0.employer", "Acme Labs");
    await fill(page, "experience.0.position", "ML Intern");
    await page.locator('[name="experience.0.current"]').check();
    // Certifications
    await tab(page, "Certifications");
    await page.getByTestId("add-certifications").click();
    await fill(page, "certifications.0.title", "Deep Learning Specialization");
    await fill(page, "certifications.0.issuer", "Coursera");
    // Preferences
    await tab(page, "Preferences");
    await page.locator('[name="preferences.workArrangement"]').selectOption("hybrid");
    await fill(page, "preferences.availabilityDate", "2027-06-01");

    await save(page);
    await expect(page.getByTestId("message")).toHaveText("Saved");

    // Update and delete are real too: rename the skill, add a second one, delete it again.
    await tab(page, "Skills");
    await fill(page, "skills.0.name", "Python 3");
    await page.getByTestId("add-skills").click();
    await fill(page, "skills.1.name", "Temp skill");
    await page.getByRole("button", { name: "Delete this record" }).nth(1).click();
    await save(page);
    await expect(page.getByTestId("message")).toHaveText("Saved");

    // Simulate closing and reopening the browser.
    await ext.context.close();
    ext = await launchExtension(dir);
    page = await ext.context.newPage();
    await page.goto(optionsUrl(ext));

    await expect(page.locator('[name="personal.email"]')).toHaveValue("priya@example.test");
    const stored = await storedProfile(page);
    expect(stored.personal.fullName).toBe("Priya Sharma");
    expect(stored.personal.provenance.email.source).toBe("user_entered");
    expect(stored.education[0].institution).toBe("Mumbai Institute");
    expect(stored.skills.map((s: { name: string }) => s.name)).toEqual(["Python 3"]);
    expect(stored.projects[0].metrics).toEqual([{ text: "Parsed 500 resumes", source: "own benchmark, README" }]);
    expect(stored.experience[0]).toMatchObject({ employer: "Acme Labs", current: true });
    expect(stored.certifications[0].title).toBe("Deep Learning Specialization");
    expect(stored.preferences.workArrangement).toBe("hybrid");
    await tab(page, "Education");
    await expect(page.locator('[name="education.0.degree"]')).toHaveValue("Bachelor of Technology");

    // The autofill engine reads the persisted profile: Quick Apply fills the form from it.
    const portal = await ext.context.newPage();
    await portal.goto(portalUrl("basic"));
    const popup = await quickApply(ext, portal);
    await waitForState(popup, ["READY_FOR_REVIEW"]);
    await expect(portal.locator("#fullname")).toHaveValue("Priya Sharma");
    await expect(portal.locator("#email")).toHaveValue("priya@example.test");
    await expect(portal.locator("#school")).toHaveValue("Mumbai Institute");
    await expect(portal.locator("#gradyear")).toHaveValue("2027");
    await ext.context.close();
  });

  test("invalid data shows visible errors and is not saved", async () => {
    const ext = await launchExtension();
    const page = await ext.context.newPage();
    await page.goto(optionsUrl(ext));

    await fill(page, "personal.email", "not-an-email");
    await save(page);
    await expect(page.getByTestId("message")).toContainText("Not saved");
    await expect(page.locator('[data-error-for="personal.email"]')).toHaveText("Not a valid email address");
    await expect(page.getByTestId("error-list")).toContainText("personal.email");
    expect(await storedProfile(page)).toBeUndefined();

    await fill(page, "personal.email", "ok@example.test");
    await tab(page, "Education");
    await page.getByTestId("add-education").click(); // blank institution is invalid
    await save(page);
    await expect(page.locator('[data-error-for="education.0.institution"]')).toHaveText("Institution is required");
    expect(await storedProfile(page)).toBeUndefined();
    await ext.context.close();
  });

  test("import rejects invalid files visibly and accepts a valid export; export downloads valid JSON", async () => {
    const ext = await launchExtension();
    const page = await ext.context.newPage();
    await page.goto(optionsUrl(ext));
    await tab(page, "Import / Export");

    await page.setInputFiles("#import-file", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{not json") });
    await expect(page.getByTestId("message")).toContainText("not valid JSON");

    const bad = { ...testProfile(), personal: { ...testProfile().personal, email: "nope" } };
    await page.setInputFiles("#import-file", { name: "bad2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
    await expect(page.getByTestId("message")).toContainText("Import rejected");
    await expect(page.getByTestId("error-list")).toContainText("personal.email");
    expect(await storedProfile(page)).toBeUndefined();

    await page.setInputFiles("#import-file", { name: "good.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(testProfile())) });
    await expect(page.getByTestId("message")).toHaveText("Imported and saved");
    expect((await storedProfile(page)).personal.fullName).toBe("Alex Example");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
    const exported = JSON.parse(fs.readFileSync((await download.path())!, "utf8"));
    expect(exported.personal.email).toBe("alex@example.test");
    expect(exported.schemaVersion).toBe(1);
    await ext.context.close();
  });
});
