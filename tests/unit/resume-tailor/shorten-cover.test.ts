import { describe, expect, it } from "vitest";
import { AIError } from "@/ai/errors";
import { hashMaster } from "@/resume/hash";
import type { TailoredLine } from "@/resume/schema";
import { generateCoverLetter, indexMaster, makeShorten, tailor } from "@/resume/tailor";
import { testProfile } from "../../fixtures/profile";
import { deepFreeze, jobFixture, masterFixture, variantFixture } from "./fixtures";
import { aiWith, promptItems, scripted } from "./mock-ai";

const XB1 = "Wrote SQL reports in Python for the analytics team, cutting weekly reporting time by 4 hours";
const XB2 = "Automated a weekly sales report with Python and SQL, saving 4 hours per week";
const P1A = "Built a forecasting model in PyTorch that reduced forecast error by 18%";

const line = (lineId: string, text: string, sourceFactIds: string[], over: Partial<TailoredLine> = {}): TailoredLine => ({
  lineId, role: "bullet", text, sourceFactIds, origin: "master", relevance: 0.5, protected: false, onlyEvidenceForRequiredQualification: false, ...over,
});
const target = { reduceLines: 2, reason: "one page" };

describe("makeShorten", () => {
  const master = deepFreeze(masterFixture());
  const setup = (reply: Parameters<typeof scripted>[0], ai = true) => {
    const provider = scripted(reply);
    const budget = { remaining: 6 };
    return { provider, budget, fn: makeShorten({ master, job: jobFixture(), ai: ai ? aiWith(provider) : null, budget }) };
  };
  const input = () => [
    line("l_exp1_b1", XB1, ["exp1_b1"]),
    line("l_proj1_b1", P1A, ["proj1_b1"]),
    line("h", "Alex Example", ["c_name"], { role: "name", protected: true }),
  ];
  const shortenReply = (map: Record<string, string>) => ({ user }: { user: string }) => ({ items: promptItems(user).map((b) => ({ lineId: b.lineId, text: map[b.text] ?? b.text, evidenceFactIds: [b.lineId], claims: [] })) });

  it("makes ONE request (category resume_shortening) and returns valid shorter, grounded replacements", async () => {
    const t = setup(shortenReply({ [XB1]: "Wrote SQL reports in Python for analytics, cutting weekly reporting time by 4 hours" }));
    const out = await t.fn(input(), target);
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0]!.category).toBe("resume_shortening");
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ lineId: "l_exp1_b1", origin: "rewritten", masterText: XB1, sourceFactIds: ["exp1_b1"] });
    expect(out[0]!.text.length).toBeLessThan(XB1.length);
    expect(out[1]!.text).toBe(P1A); // unchanged
    expect(out[2]!.text).toBe("Alex Example"); // never sent, never changed
    expect(t.provider.calls[0]!.user).not.toContain("Alex Example");
  });

  it("discards replacements that are not shorter, add a number, add a tool, or stuff a keyword", async () => {
    const t = setup(shortenReply({ [XB1]: `${XB1} every single week of the term`, [P1A]: "Built a PyTorch forecasting model that cut error by 28%" }));
    const out = await t.fn(input(), target);
    expect(out[0]!.text).toBe(XB1);
    expect(out[1]!.text).toBe(P1A);

    const t2 = setup(shortenReply({ [XB1]: "Wrote SQL reports in Python and Docker, cutting weekly time by 4 hours", [XB2]: "Automated weekly sales reports, improving stakeholder communication" }));
    const out2 = await t2.fn([line("l_exp1_b1", XB1, ["exp1_b1"]), line("l_exp1_b2", XB2, ["exp1_b2"])], target);
    expect(out2.map((l) => l.text)).toEqual([XB1, XB2]);
  });

  it("an ungrounded line keeps the original while a valid one in the same batch is still applied", async () => {
    const t = setup(shortenReply({ [XB1]: "Wrote SQL reports in Python for analytics, cutting weekly time by 40 hours", [P1A]: "Built a PyTorch forecasting model that cut forecast error by 18%" }));
    const out = await t.fn(input(), target);
    expect(out[0]!.text).toBe(XB1);
    expect(out[1]!.text).toBe("Built a PyTorch forecasting model that cut forecast error by 18%");
    expect(t.provider.calls).toHaveLength(1);
  });

  it("returns the lines unchanged without AI, on an AI error, on invalid output, and when the budget is spent", async () => {
    expect(await setup(shortenReply({}), false).fn(input(), target)).toEqual(input());
    const err = setup(() => new AIError("network", "http_500"));
    expect(await err.fn(input(), target)).toEqual(input());
    expect(err.provider.calls).toHaveLength(1);
    const bad = setup(() => ({ items: 5 }));
    expect(await bad.fn(input(), target)).toEqual(input());
    expect(bad.provider.calls).toHaveLength(1);
    const spent = setup(shortenReply({}));
    spent.budget.remaining = 0;
    expect(await spent.fn(input(), target)).toEqual(input());
    expect(spent.provider.calls).toHaveLength(0);
  });

  it("skips lines that cannot be shortened safely (contact, skills rows, lines with unknown sources)", async () => {
    const t = setup(shortenReply({}));
    const lines = [line("n", "Alex Example", ["c_name"], { role: "name" }), line("sk", "Languages: Python, SQL, Java", ["sk_py"], { role: "skills_row" }), line("x", "A made up long line with no source", ["ghost"])];
    expect(await t.fn(lines, target)).toEqual(lines);
    expect(t.provider.calls).toHaveLength(0);
  });

  it("validates against the MASTER fact even when the current line was already reworded", async () => {
    const reworded = line("l_exp1_b2", "Automated a weekly sales report with Python and SQL, saving 4 hours", ["exp1_b2", "exp1_h"], { origin: "rewritten", masterText: XB2 });
    const t = setup(shortenReply({ [reworded.text]: "Automated weekly sales reports with Python and SQL" }));
    const out = await t.fn([reworded], target);
    expect(out[0]).toMatchObject({ text: "Automated weekly sales reports with Python and SQL", origin: "rewritten", masterText: XB2 });
  });
});

describe("tailor + shorten stay within their request budgets together", () => {
  it("a tailor run uses at most 2 requests and a shorten call exactly 1 more", async () => {
    const provider = scripted(({ user, category }) => ({ items: promptItems(user).map((b) => ({ lineId: b.lineId, text: category === "resume_rewrite" ? "Improved accuracy by 99% using Kubernetes" : b.text, evidenceFactIds: [b.lineId], claims: [] })) }));
    const budget = { remaining: 6 };
    const master = masterFixture();
    const ai = aiWith(provider);
    const out = await tailor({ master, variant: variantFixture(), job: jobFixture(), match: null, profile: testProfile(), ai, budget });
    expect(provider.calls.length).toBe(2);
    const shorten = makeShorten({ master, job: jobFixture(), ai, budget });
    await shorten([line("l_exp1_b1", XB1, ["exp1_b1"])], target);
    expect(provider.calls.length).toBe(3);
    expect(out.report.ai.requests).toBe(2);
    expect(budget.remaining).toBe(3);
  });
});

describe("generateCoverLetter", () => {
  const goodBody = [
    "I am applying for the Machine Learning Intern role because forecasting models for retail data are exactly what I have been building.",
    "Built a forecasting model in PyTorch that reduced forecast error by 18%, and during my internship I wrote SQL reports in Python for the analytics team.",
    "I would welcome the chance to bring this experience to the team.",
  ];
  const coverReply = (texts: string[], cite: boolean | string = true) => ({ user }: { user: string }) => {
    const block = JSON.parse(user.split("<<<PAGE_DATA_START\n")[1]!.split("\nPAGE_DATA_END>>>")[0]!) as { evidence: { id: string; text: string }[] };
    // `cite` true = cite everything, false = cite nothing, string = cite only the evidence whose text contains it.
    const ids = block.evidence.filter((e) => typeof cite === "string" ? e.text.includes(cite) : cite).map((e) => e.id);
    return { paragraphs: texts.map((text) => ({ text, evidenceIds: ids, claims: [] })) };
  };
  const make = (reply: Parameters<typeof scripted>[0]) => {
    const provider = scripted(reply);
    const master = deepFreeze(masterFixture());
    const budget = { remaining: 6 };
    return { provider, master, budget, run: () => generateCoverLetter({ master, job: jobFixture(), ai: aiWith(provider), budget }) };
  };

  it("produces a 'summary' section titled 'Cover letter' whose paragraphs all cite existing master facts", async () => {
    const t = make(coverReply(goodBody));
    const before = await hashMaster(t.master);
    const letter = await t.run();
    expect(letter).not.toBeNull();
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0]!.category).toBe("cover_letter");
    expect(letter!.sections).toHaveLength(1);
    expect(letter!.sections[0]).toMatchObject({ key: "summary", title: "Cover letter" });
    const known = new Set(indexMaster(t.master).byFact.keys());
    const paragraphs = letter!.sections[0]!.entries[0]!.lines;
    expect(paragraphs).toHaveLength(3);
    for (const p of paragraphs) {
      expect(p.role).toBe("paragraph");
      expect(p.sourceFactIds.length).toBeGreaterThan(0);
      for (const id of p.sourceFactIds) expect(known.has(id)).toBe(true);
    }
    expect(letter!.masterHash).toBe(before);
    expect(await hashMaster(t.master)).toBe(before);
    expect(t.provider.calls[0]!.user).not.toContain("alex@example.test");
  });

  it("returns null when the model fabricates (one regeneration, then null), never an ungrounded letter", async () => {
    const t = make(coverReply([...goodBody.slice(0, 2), "At Globex Corporation I led a team of 12 engineers and improved revenue by 300% using Kubernetes in production."]));
    expect(await t.run()).toBeNull();
    expect(t.provider.calls).toHaveLength(2);
    expect(t.provider.calls[1]!.user).toContain("paragraph 3");
  });

  it("is rescued by the regeneration when the second answer is grounded", async () => {
    const t = make((c, n) => coverReply(n === 1 ? [goodBody[0]!, "I improved forecast error by 45% in my project.", goodBody[2]!] : goodBody)(c));
    expect(await t.run()).not.toBeNull();
    expect(t.provider.calls).toHaveLength(2);
  });

  it("rejects an employment claim made from a project and a paragraph that cites nothing", async () => {
    expect(await make(coverReply(["I worked as a professional engineer for years on the Resume Parser project and I am a good fit.", goodBody[1]!, goodBody[2]!], "Resume Parser")).run()).toBeNull();
    expect(await make(coverReply(goodBody, false)).run()).toBeNull();
  });

  it("returns null without AI, on an AI error, on invalid output and with no budget", async () => {
    const master = masterFixture();
    expect(await generateCoverLetter({ master, job: jobFixture(), ai: null, budget: { remaining: 3 } })).toBeNull();
    expect(await generateCoverLetter({ master, job: jobFixture(), ai: aiWith(scripted(() => ({ paragraphs: "x" }))), budget: { remaining: 3 } })).toBeNull();
    const err = scripted(() => new AIError("timeout", "t"));
    expect(await generateCoverLetter({ master, job: jobFixture(), ai: aiWith(err), budget: { remaining: 3 } })).toBeNull();
    expect(err.calls).toHaveLength(1);
    const none = scripted(coverReply(goodBody));
    expect(await generateCoverLetter({ master, job: jobFixture(), ai: aiWith(none), budget: { remaining: 0 } })).toBeNull();
    expect(none.calls).toHaveLength(0);
  });
});
