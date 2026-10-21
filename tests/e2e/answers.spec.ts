import { test, expect, type Page } from "@playwright/test";
import { configureAi, launchExtension, runPortal, type Ext } from "./support/extension";
import { answerItem, installMockAi, type AnswerPayload, type MockAi } from "./support/mock-ai";
import { richProfile } from "../fixtures/profile";

const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };
type Probe = { __submitted: boolean; __events: { type: string; id: string | null }[] };

let ext: Ext;
let ai: MockAi;
test.beforeEach(async () => {
  ext = await launchExtension();
  ai = await installMockAi(ext.context);
});
test.afterEach(async () => {
  await ext.context.close();
});

const WHY = "I want to join Northwind Analytics because my Sales Forecaster project reduced forecast error by 18% using Python, and at Acme Labs I wrote SQL reports. I would like to apply that experience to your forecasting work.";
const PROJECT =
  "My Resume Parser project extracts structured fields from resumes. I wrote the parsing rules and the web API in Python with spaCy and Docker, and it parsed 500 sample resumes. It is deployed publicly.";
const STRENGTHS = "I am strong at building data pipelines in Python and writing clear SQL reports, as I did at Acme Labs.";

const wordsOf = (s: string) => s.trim().split(/\s+/).length;
/** A model that answers every supported question faithfully, citing every evidence id it was given for that question. */
function faithful(p: AnswerPayload) {
  return p.questions.map((x) => {
    const text = /join us/i.test(x.question) ? WHY : /project/i.test(x.question) ? PROJECT : /strength/i.test(x.question) ? STRENGTHS : "I enjoy learning new tools.";
    return answerItem(x.id, text, x.evidenceIds);
  });
}

async function enableAi() {
  await configureAi(ext, { enabled: true, keys: KEYS });
}
async function value(page: Page, sel: string) {
  return page.locator(sel).inputValue();
}
const probe = (page: Page) => page.evaluate(() => ({ s: (window as unknown as Probe).__submitted, e: (window as unknown as Probe).__events }));

test.describe("Phase 6: grounded answers for open-ended questions (HTTP mocked)", () => {
  test("supported questions get grounded answers inserted and verified, shown as AI-written with their evidence", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const { page, popup, report, record } = await runPortal(ext, "open-ended", { profile: richProfile() });

    expect(record.state).toBe("READY_FOR_REVIEW");
    expect(await value(page, "#why")).toBe(WHY);
    expect(await value(page, "#proj")).toBe(PROJECT);
    expect(wordsOf(WHY)).toBeLessThanOrEqual(60);
    expect(PROJECT.length).toBeLessThanOrEqual(400);
    await expect(page.locator("#why-count")).toHaveText(`${wordsOf(WHY)} / 60 words`); // the page's own counter saw real input events
    await expect(page.locator("#proj-count")).toHaveText(`${PROJECT.length}/400`);

    expect(report).toMatchObject({ aiWritten: 2, failed: 0 });
    const written = report.results.filter((r) => r.aiWritten);
    expect(written).toHaveLength(2);
    expect(written.every((r) => r.outcome === "filled_verified" && r.evidence!.length > 0)).toBe(true);
    expect(written.flatMap((r) => r.evidence!).some((e) => /Sales Forecaster|Resume Parser/.test(e))).toBe(true);
    expect(record.ai.requests).toBe(1);

    await expect(popup.getByTestId("answers")).toContainText("AI-written answers: review before submitting");
    await expect(popup.getByTestId("answers")).toContainText("Evidence used:");
    await expect(popup.getByTestId("report")).toContainText("AI-written, review: 2");

    // One batched request carried both questions; it contained no contact details and no keys.
    expect(ai.answerRequests).toHaveLength(1);
    expect(ai.answerRequests[0]!.payload.questions).toHaveLength(2);
    const sent = ai.bodies.gemini.join("\n");
    expect(sent).not.toMatch(/alex@example\.test|98765|411001|linkedin|AIza-test/);
    const p = await probe(page);
    expect(p.s).toBe(false);
    expect(p.e).toEqual([]);
  });

  test("a fabricated metric is rejected, the retry names the violation, and a second failure leaves the field empty", async () => {
    await enableAi();
    ai.set("gemini", {
      answers: (p) => p.questions.map((x) => answerItem(x.id, "My Sales Forecaster project reduced forecast error by 45% and served 2 million users.", x.evidenceIds)),
    });
    const { page, report } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("");
    expect(await value(page, "#proj")).toBe("");
    expect(ai.answerRequests.map((r) => r.kind)).toEqual(["generation", "regeneration"]);
    expect(ai.answerRequests[1]!.user).toMatch(/45%/);
    expect(ai.answerRequests[1]!.user).toMatch(/rejected for these specific problems/);
    const why = report.results.find((r) => /join us/.test(r.label))!;
    expect(why.outcome).toBe("unresolved");
    expect(why.reason).toMatch(/Ungrounded answer rejected: unsupported_number/);
    expect(report.aiWritten).toBe(0);
  });

  test("a fabricated tool is rejected, but a faithful retry is accepted", async () => {
    await enableAi();
    ai.set("gemini", {
      answers: (p, kind) =>
        p.questions.map((x) =>
          answerItem(x.id, kind === "generation" ? "I built the Sales Forecaster pipeline with Kubernetes and Python." : "I built the Sales Forecaster pipeline in Python.", x.evidenceIds),
        ),
    });
    const { page, report } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("I built the Sales Forecaster pipeline in Python.");
    expect(report.aiWritten).toBe(2);
    expect(ai.answerRequests.map((r) => r.kind)).toEqual(["generation", "regeneration"]);
    expect(ai.answerRequests[1]!.user).toMatch(/Kubernetes/);
  });

  test("claiming a job from a project, or production for an undeployed project, is rejected", async () => {
    await enableAi();
    ai.set("gemini", {
      answers: (p) =>
        p.questions.map((x) =>
          answerItem(x.id, /join us/.test(x.question) ? "During my internship I shipped the Sales Forecaster in Python." : "I deployed the Sales Forecaster to production for real users.", x.evidenceIds.filter((id) => /^P/.test(id))),
        ),
    });
    const { page, report } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("");
    expect(await value(page, "#proj")).toBe("");
    const reasons = report.results.filter((r) => r.outcome === "unresolved").map((r) => r.reason).join(" ");
    expect(reasons).toMatch(/employment_from_project/);
    expect(reasons).toMatch(/unsupported_production/);
  });

  test("a model that cites evidence it was never given is rejected", async () => {
    await enableAi();
    ai.set("gemini", { answers: (p) => p.questions.map((x) => answerItem(x.id, "I built the Sales Forecaster in Python.", ["P9", ...x.evidenceIds.slice(0, 1)])) });
    const { page } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("");
    expect(ai.answerRequests[1]!.user).toMatch(/P9/);
  });

  test("word limit: an over-length answer is shortened once, never truncated, and verified against the page", async () => {
    await enableAi();
    const long = `${WHY} ${"I also enjoy building reliable systems with Python and SQL. ".repeat(6)}`;
    expect(wordsOf(long)).toBeGreaterThan(60);
    ai.set("gemini", {
      answers: (p, kind) => p.questions.map((x) => answerItem(x.id, /join us/.test(x.question) ? (kind === "generation" ? long : WHY) : PROJECT, x.evidenceIds)),
    });
    const { page } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(ai.answerRequests.map((r) => r.kind)).toEqual(["generation", "shortening"]);
    expect(ai.answerRequests[1]!.user).toMatch(/over their length limit/);
    expect(ai.answerRequests[1]!.payload.questions.map((x) => x.id)).toHaveLength(1); // only the over-length one
    expect(await value(page, "#why")).toBe(WHY); // exactly the model's shorter text, not a cut of the long one
    expect(wordsOf(await value(page, "#why"))).toBeLessThanOrEqual(60);
  });

  test("maxlength and counter limits are read from the page; an answer that stays too long is left empty, never cut", async () => {
    await enableAi();
    const tooLong = `${PROJECT} ${"It also handles many edge cases carefully and reports clear errors to the caller. ".repeat(6)}`;
    expect(tooLong.length).toBeGreaterThan(400);
    ai.set("gemini", { answers: (p) => p.questions.map((x) => answerItem(x.id, /project/.test(x.question) ? tooLong : WHY, x.evidenceIds)) });
    const { page, report } = await runPortal(ext, "open-ended", { profile: richProfile() });
    const limits = Object.fromEntries(ai.answerRequests[0]!.payload.questions.map((x) => [x.question.slice(0, 12), x.length]));
    expect(limits["Why do you w"]).toMatch(/at most 60 words/);
    expect(limits["Describe a r"]).toMatch(/at most 400 chars/);
    expect(await value(page, "#proj")).toBe(""); // not truncated to 400 and called done
    expect(await value(page, "#why")).toBe(WHY);
    expect(report.results.find((r) => /project/.test(r.label))!.reason).toMatch(/Still over the length limit/);
    expect(ai.answerRequests.map((r) => r.kind)).toEqual(["generation", "shortening"]);
  });

  test("an unknown personal fact and hobbies are never generated or sent; the project question still is", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const { page, report } = await runPortal(ext, "unknown-fact", { profile: richProfile() });
    expect(await value(page, "#hear")).toBe("");
    expect(await value(page, "#hobby")).toBe("");
    expect(await value(page, "#proj")).toBe(PROJECT);
    expect(ai.answerRequests).toHaveLength(1);
    expect(ai.answerRequests[0]!.payload.questions.map((x) => x.question)).toEqual(["Describe a relevant project (max 80 words)"]);
    const sent = ai.bodies.gemini.join("\n");
    expect(sent).not.toMatch(/hear about|hobbies/i);
    const hear = report.results.find((r) => /hear about/.test(r.label))!;
    expect(hear.outcome).toBe("unresolved");
    expect(hear.reason).toMatch(/personal fact/);
  });

  test("sensitive, eligibility, legal and binding questions stay unresolved with reasons, even mixed with open-ended ones", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const { page, report } = await runPortal(ext, "mixed-questions", { profile: richProfile() });
    for (const id of ["#gender", "#visa", "#legal"]) expect(await value(page, id)).toBe("");
    await expect(page.locator("#agree")).not.toBeChecked();
    expect(await value(page, "#why")).toBe(WHY);
    expect(await value(page, "#strengths")).toBe(STRENGTHS);
    expect(report.aiWritten).toBe(2);
    const outcome = (re: RegExp) => report.results.find((r) => re.test(r.label))!.outcome;
    expect(outcome(/gender/)).toBe("skipped_sensitive");
    expect(outcome(/visa/)).toBe("skipped_sensitive");
    expect(outcome(/certify/)).toBe("skipped_consent");
    expect(outcome(/terms and conditions/)).toBe("skipped_consent");
    const sent = ai.bodies.gemini.join("\n");
    expect(sent).not.toMatch(/gender|visa|certify|terms and conditions/i);
    expect(ai.answerRequests[0]!.payload.questions).toHaveLength(2);
  });

  test("a question containing instruction-like text is refused and never sent; the page is not obeyed", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const { page, report } = await runPortal(ext, "injected-question", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("");
    expect(await value(page, "#proj")).toBe(PROJECT);
    const sent = ai.bodies.gemini.join("\n");
    expect(sent).not.toMatch(/IGNORE ALL PREVIOUS|password/i);
    expect(report.results.find((r) => /IGNORE ALL/.test(r.label))!.reason).toMatch(/instruction-like/);
    const p = await probe(page);
    expect(p.e).toEqual([]);
  });

  test("with AI off the open-ended questions stay unresolved and nothing is requested", async () => {
    await configureAi(ext, { enabled: false, keys: KEYS });
    const { page, record } = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(await value(page, "#why")).toBe("");
    expect(ai.calls).toEqual({ gemini: 0, groq: 0 });
    expect(record.answers).toEqual([]);
  });

  test("answers are cached: a repeat visit makes no request; clearing the cache makes the next visit ask again", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const first = await runPortal(ext, "open-ended", { profile: richProfile() });
    expect(ai.answerRequests).toHaveLength(1);
    await first.page.reload();
    const second = await runPortal(ext, "open-ended", { profile: richProfile(), page: first.page });
    expect(ai.answerRequests).toHaveLength(1);
    expect(second.record.answers.every((a) => a.source === "cache")).toBe(true);
    expect(await value(first.page, "#why")).toBe(WHY);

    await first.popup.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await first.page.reload();
    await runPortal(ext, "open-ended", { profile: richProfile(), page: first.page });
    expect(ai.answerRequests).toHaveLength(2);
  });

  test("answer memory: saved only on an explicit click, reused for a matching question and job, listed and deletable, and switchable off", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const first = await runPortal(ext, "open-ended", { profile: richProfile() });
    // Nothing is saved automatically.
    const none = await first.popup.evaluate(() => chrome.runtime.sendMessage({ kind: "LIST_ANSWERS" }));
    expect(none).toMatchObject({ ok: true, kind: "answers", answers: [] });

    const fieldId = first.record.answers.find((a) => /join us/.test(a.label))!.fieldId;
    await first.popup.getByTestId(`save-answer-${fieldId}`).click();
    await expect(first.popup.getByTestId(`save-answer-${fieldId}`)).toHaveText("Saved for reuse");

    // Clear the generated-answer cache so the next run can only be served by approved memory.
    await first.popup.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await first.page.reload();
    const before = ai.answerRequests.length;
    const again = await runPortal(ext, "open-ended", { profile: richProfile(), page: first.page });
    const reused = again.record.answers.find((a) => /join us/.test(a.label))!;
    expect(reused.source).toBe("memory");
    expect(await value(first.page, "#why")).toBe(WHY);
    // The other question (not saved) had to be regenerated: one request, carrying only that question.
    expect(ai.answerRequests.length).toBe(before + 1);
    expect(ai.answerRequests.at(-1)!.payload.questions.map((x) => x.question)).toEqual(["Describe a relevant project"]);

    // Options page lists it; memory can be switched off; deleting removes it.
    const options = await ext.context.newPage();
    await options.goto(`chrome-extension://${ext.extensionId}/options.html`);
    await options.getByRole("tab", { name: "AI providers" }).click();
    await expect(options.getByTestId("saved-answer")).toHaveCount(1);
    await expect(options.getByTestId("saved-answer")).toContainText("Why do you want to join us?");

    await options.locator('[name="ai.answerMemory"]').uncheck();
    await expect(options.getByTestId("ai-settings-note")).toHaveText("Saved");
    await first.popup.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));
    await first.page.reload();
    const off = await runPortal(ext, "open-ended", { profile: richProfile(), page: first.page });
    expect(off.record.answers.find((a) => /join us/.test(a.label))!.source).toBe("generated");

    await options.getByRole("button", { name: "Delete" }).click();
    await expect(options.getByTestId("no-saved-answers")).toBeVisible();
  });

  test("a saved answer is not reused for a different company on a job-specific question", async () => {
    await enableAi();
    ai.set("gemini", { answers: faithful });
    const first = await runPortal(ext, "open-ended", { profile: richProfile() });
    const fieldId = first.record.answers.find((a) => /join us/.test(a.label))!.fieldId;
    await first.popup.getByTestId(`save-answer-${fieldId}`).click();
    await expect(first.popup.getByTestId(`save-answer-${fieldId}`)).toHaveText("Saved for reuse");
    await first.popup.evaluate(() => chrome.runtime.sendMessage({ kind: "AI_CLEAR_CACHE" }));

    // Same question wording on a page for a different company (injected-question has company Initech and a different 'why' text,
    // so use unknown-fact's project question for the generic path and mixed-questions for a different-company why-question).
    const other = await runPortal(ext, "mixed-questions", { profile: richProfile() });
    const why = other.record.answers.find((a) => /join us/.test(a.label));
    expect(why?.source).toBe("generated"); // the saved one was for Northwind Analytics on a different question text/signature
  });
});

test("the production bundle has no answer-test hooks or keys", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
  for (const f of readdirSync(dist).filter((n) => n.endsWith(".js"))) {
    expect(readFileSync(path.join(dist, f), "utf8"), f).not.toMatch(/mock[_-]?provider|testmock|AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}/i);
  }
});
