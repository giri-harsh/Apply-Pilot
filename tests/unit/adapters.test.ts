import { beforeEach, describe, expect, it } from "vitest";
import { FAKEATS } from "@/adapters/fakeats";
import { adapterMatchesHost, hostMatchesRule, hostnameOf } from "@/adapters/match";
import { applyFieldHint, routePage } from "@/adapters/router";
import { classifyControls, pickNext } from "@/content/navigation/classify";
import { observeForm } from "@/content/observer/observe";

const GOOD = "http://fakeats.test:5173/apply/step1.html";
const STEP1 = `
  <h2>Step 1 of 3</h2>
  <form data-automation-id="fakeatsApplication">
    <label for="a">Item 1</label><input id="a" data-automation-id="legalName.first">
    <label for="c">Item 3</label><input id="c" data-automation-id="contact.email">
    <label for="g">Gender</label><select id="g" data-automation-id="eeo.gender"><option value="">Select</option><option>Female</option></select>
    <button type="button" data-automation-id="bottom-navigation-next-button">Go on</button>
  </form>`;
const page = (body = STEP1, generator = "FakeATS 1.0") => {
  document.head.innerHTML = generator ? `<meta name="generator" content="${generator}">` : "";
  document.body.innerHTML = body;
};

describe("adapter host matching is strict", () => {
  it.each([
    ["http://fakeats.test/a", true],
    ["http://FAKEATS.TEST./a", true], // case and trailing dot
    ["http://jobs.fakeats.test/a", true], // explicit subdomain label
    ["http://careers.fakeats.test:8080/a", true],
    ["http://www.fakeats.test/a", false], // a subdomain nobody listed
    ["http://a.b.fakeats.test/a", false], // two labels
    ["http://evilfakeats.test/a", false], // suffix trick
    ["http://fakeats.test.evil.com/a", false], // prefix trick
    ["http://fakeats.test@evil.com/a", false], // userinfo trick
    ["http://evil.com/fakeats.test", false], // host in the path
    ["http://evil.com/?u=fakeats.test", false],
    ["ftp://fakeats.test/a", false],
    ["not a url", false],
  ])("%s -> %s", (url, ok) => {
    expect(adapterMatchesHost(FAKEATS, url)).toBe(ok);
  });

  it("https is required unless the adapter allows http (synthetic portals only)", () => {
    expect(adapterMatchesHost({ ...FAKEATS, allowHttp: false }, "http://fakeats.test/")).toBe(false);
    expect(adapterMatchesHost({ ...FAKEATS, allowHttp: false }, "https://fakeats.test/")).toBe(true);
  });

  it("a subdomain rule never matches the bare domain or an unlisted label", () => {
    const r = { kind: "subdomains" as const, domain: "ats.example", labels: ["jobs"] };
    expect(hostMatchesRule("ats.example", r)).toBe(false);
    expect(hostMatchesRule("jobs.ats.example", r)).toBe(true);
    expect(hostMatchesRule("x.jobs.ats.example", r)).toBe(false);
    expect(hostnameOf("https://u:p@x.test/")).toBeNull();
  });
});

describe("router: adapter only when host, signals and structure all match", () => {
  beforeEach(() => page());

  it("recognised host + page signals + structure -> adapter path", () => {
    const r = routePage(document, GOOD);
    expect(r.decision).toMatchObject({ path: "adapter", adapterId: "fakeats", adapterVersion: 1 });
    expect(r.adapter).toBe(FAKEATS);
  });

  it("the same host with a different structure -> general path, with the reason", () => {
    page(`<form class="v2"><label for="a">Item 1</label><input id="a"><button>Go on</button></form>`, "FakeATS 2.0");
    const r = routePage(document, GOOD);
    expect(r.decision.path).toBe("general");
    expect(r.decision.reason).toMatch(/does not look like it/);
  });

  it("recognised but with its structural assumptions broken -> general path", () => {
    page(`<form data-automation-id="fakeatsApplication"><label for="a">Item 1</label><input id="a"></form>`);
    const r = routePage(document, GOOD);
    expect(r.decision.path).toBe("general");
    expect(r.decision.reason).toMatch(/assumptions no longer hold/);
  });

  it.each(["http://fakeats.test.evil.com/x", "http://evilfakeats.test/x", "http://127.0.0.1:5173/x", "http://fakeats.test@evil.com/x"])(
    "a lookalike host never matches, even with a perfect page: %s",
    (url) => {
      expect(routePage(document, url).decision).toMatchObject({ path: "general", reason: "No adapter matches this host" });
    },
  );

  it("a page without the generator meta tag is not the portal, whatever the host", () => {
    page(STEP1, "");
    expect(routePage(document, GOOD).decision.path).toBe("general");
  });
});

describe("hints are evidence only", () => {
  it("fill unknown fields on the adapter path, but not on the general path", () => {
    page();
    const general = observeForm(document).fields;
    expect(general.find((f) => f.label === "Item 1")!.semanticType).toBe("unknown");
    const withAdapter = observeForm(document, { adapter: FAKEATS }).fields;
    expect(withAdapter.find((f) => f.label === "Item 1")).toMatchObject({ semanticType: "first_name", adapterHint: "fakeats" });
    expect(withAdapter.find((f) => f.label === "Item 3")).toMatchObject({ semanticType: "email", adapterHint: "fakeats" });
    expect(withAdapter.find((f) => f.label === "Item 1")!.confidence).toBeLessThanOrEqual(0.92);
  });

  it("a wrong hint on a sensitive question is ignored: sensitive stays sensitive and risky", () => {
    page();
    const g = observeForm(document, { adapter: FAKEATS }).fields.find((f) => f.label === "Gender")!;
    expect(g.semanticType).not.toBe("full_name");
    expect(g.adapterHint).toBeUndefined();
    expect(["high", "restricted"]).toContain(g.risk);
  });

  it("applyFieldHint: a confident general classification that disagrees wins; sensitive, consent and third-party never change", () => {
    expect(applyFieldHint({ semanticType: "email", confidence: 0.95, ambiguous: false }, { semanticType: "city", confidence: 0.9 }).use).toBe(false);
    expect(applyFieldHint({ semanticType: "unknown", confidence: 0, ambiguous: false }, { semanticType: "city", confidence: 0.99 })).toMatchObject({ use: true, semanticType: "city", confidence: 0.92 });
    expect(applyFieldHint({ semanticType: "consent", confidence: 0.2, ambiguous: false }, { semanticType: "city", confidence: 0.9 }).use).toBe(false);
    expect(applyFieldHint({ semanticType: "unknown", confidence: 0, ambiguous: false }, { semanticType: "consent", confidence: 0.9 }).use).toBe(false);
    expect(applyFieldHint({ semanticType: "city", confidence: 0.9, ambiguous: true }, { semanticType: "city", confidence: 0.8 }).use).toBe(true);
  });

  it("the next-button hint only resolves an UNRECOGNISED button; it never overrides the final-control guard", () => {
    page();
    expect(pickNext(classifyControls(document).report)).toBeNull(); // general: "Go on" is unrecognised, so treated as final
    const hinted = classifyControls(document, FAKEATS).report;
    expect(pickNext(hinted)).toMatchObject({ text: "Go on", role: "next" });
    expect(hinted.controls.find((c) => c.text === "Go on")!.reasons[0]).toMatch(/adapter hint/);

    // final wording with the same selector stays final
    page(`<form data-automation-id="fakeatsApplication"><button type="button" data-automation-id="bottom-navigation-next-button">Submit application</button></form>`);
    expect(classifyControls(document, FAKEATS).report.controls[0]!.role).toBe("final");
    // a posting form's submit button stays final
    page(`<form data-automation-id="fakeatsApplication" action="/api" method="post"><button data-automation-id="bottom-navigation-next-button">Go on</button></form>`);
    expect(classifyControls(document, FAKEATS).report.controls[0]!.role).toBe("final");
    // the last step stays final
    page(`<p>Step 3 of 3</p> <form data-automation-id="fakeatsApplication"><button type="button" data-automation-id="bottom-navigation-next-button">Go on</button></form>`);
    expect(pickNext(classifyControls(document, FAKEATS).report)).toBeNull();
  });
});
