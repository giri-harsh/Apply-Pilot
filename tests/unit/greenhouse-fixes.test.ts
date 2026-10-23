import { describe, expect, it } from "vitest";
import { interactiveCaptcha, detectBlockers } from "@/content/blockers";
import { classifyField } from "@/content/mapping/classify";
import { observeForm } from "@/content/observer/observe";
import { displayedValue, optionText } from "@/content/observer/widgets";
import { companyFromSlug, companyFromTitle } from "@/job/company";
import { extractJob } from "@/job/extract";

const set = (html: string, head = "") => {
  document.head.innerHTML = head;
  document.body.innerHTML = html;
};
const blocks = () => detectBlockers(document).blockers.some((b) => b.type === "captcha");

describe("CAPTCHA detection blocks only on an interactive challenge", () => {
  it.each([
    ["the badge div", `<div class="grecaptcha-badge" style="width:256px;height:60px"></div>`],
    ["the invisible anchor inside the badge", `<div class="grecaptcha-badge"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/enterprise/anchor?k=x&size=invisible"></iframe></div>`],
    ["an invisible anchor outside the badge", `<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"></iframe>`],
    ["a hidden challenge frame", `<iframe src="https://www.google.com/recaptcha/api2/bframe" style="display:none"></iframe>`],
    ["a visibility:hidden challenge frame", `<iframe src="https://www.google.com/recaptcha/api2/bframe" style="visibility:hidden"></iframe>`],
    ["the response textarea", `<textarea id="g-recaptcha-response-100000" class="g-recaptcha-response" style="display:none"></textarea>`],
    ["a captcha-named textarea that is visible", `<textarea id="g-recaptcha-response" name="g-recaptcha-response"></textarea>`],
    ["a hidden challenge container", `<div id="recaptcha-container" style="display:none">x</div>`],
    ["an invisible-size widget", `<div class="g-recaptcha" data-sitekey="k" data-size="invisible"></div>`],
    ["a long form that merely mentions a security check", `<form>${"<p>Tell us about yourself and your experience. </p>".repeat(30)}<p>This site has a security check for abuse.</p><input></form>`],
  ])("does not block for %s", (_name, html) => {
    set(html, `<script src="https://www.google.com/recaptcha/enterprise.js?render=x"></script>`);
    expect(interactiveCaptcha(document)).toBe(false);
    expect(blocks()).toBe(false);
  });

  it.each([
    ["a reCAPTCHA v2 checkbox anchor", `<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal"></iframe>`],
    ["a visible challenge frame", `<iframe src="https://www.google.com/recaptcha/api2/bframe?hl=en"></iframe>`],
    ["an hCaptcha frame", `<iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html"></iframe>`],
    ["a Turnstile frame", `<iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0"></iframe>`],
    ["a visible g-recaptcha widget", `<div class="g-recaptcha" data-sitekey="k"></div>`],
    ["an hcaptcha widget", `<div class="h-captcha" data-sitekey="k"></div>`],
    ["a full-page interstitial", `<p>Please verify you're a human to continue</p>`],
  ])("blocks for %s", (_name, html) => {
    set(html);
    expect(interactiveCaptcha(document)).toBe(true);
    expect(blocks()).toBe(true);
  });

  it("the badge being present does not hide a real v2 checkbox next to it", () => {
    set(`<div class="grecaptcha-badge"><iframe title="reCAPTCHA" src="/recaptcha/enterprise/anchor?size=invisible"></iframe></div><div class="g-recaptcha" data-sitekey="k"><iframe title="reCAPTCHA" src="/recaptcha/api2/anchor?size=normal"></iframe></div>`);
    expect(blocks()).toBe(true);
  });
});

describe("company fallbacks", () => {
  it("title pattern: the LAST ' at ' wins", () => {
    expect(companyFromTitle("Job Application for Senior Engineer at Acme Robotics")).toBe("Acme Robotics");
    expect(companyFromTitle("Job Application for Engineer at Scale Team at Acme")).toBe("Acme");
    expect(companyFromTitle("Engineer at Scale Team at Acme | Careers")).toBe("Acme");
    expect(companyFromTitle("Staff Engineer")).toBeNull();
    expect(companyFromTitle(" at Acme")).toBeNull();
    expect(companyFromTitle("Engineer at ")).toBeNull();
  });

  it("slug: only known job-board hosts, title-cased, never a number or a reserved word", () => {
    expect(companyFromSlug("https://job-boards.greenhouse.io/mdbgeneralreferrals/jobs/8258280")).toBe("Mdbgeneralreferrals");
    expect(companyFromSlug("https://boards.greenhouse.io/acme-robotics/jobs/1")).toBe("Acme Robotics");
    expect(companyFromSlug("https://boards.greenhouse.io/embed/job_app?for=acme_corp&token=1")).toBe("Acme Corp");
    expect(companyFromSlug("https://jobs.lever.co/some-company/abc")).toBe("Some Company");
    expect(companyFromSlug("https://example.com/acme/jobs/1")).toBeNull();
    expect(companyFromSlug("https://job-boards.greenhouse.io/jobs/123")).toBeNull();
    expect(companyFromSlug("not a url")).toBeNull();
  });

  const run = (head: string, url: string, body = "<main><h1>Platform Engineer</h1><p>Build things. Requirements: Python.</p></main>") => {
    document.head.innerHTML = head;
    document.body.innerHTML = body;
    return extractJob(document, url);
  };

  it("order: JSON-LD, then og:site_name, then the title pattern, then the slug (low confidence), else Unknown (null)", () => {
    const ld = `<script type="application/ld+json">{"@type":"JobPosting","title":"Platform Engineer","hiringOrganization":{"name":"LD Corp"},"description":"Build things"}</script>`;
    const gh = "https://job-boards.greenhouse.io/boardtoken/jobs/1";
    expect(run(`<title>Job Application for X at Title Co</title><meta property="og:site_name" content="Site Co">${ld}`, gh).company).toBe("LD Corp");
    const og = run(`<title>Job Application for X at Title Co</title><meta property="og:site_name" content="Site Co">`, gh);
    expect(og.company).toBe("Site Co");
    expect(og.sources.company).toBe("open_graph");
    const byTitle = run(`<title>Job Application for Engineer at Scale Team at Acme</title>`, gh);
    expect(byTitle.company).toBe("Acme");
    expect(byTitle.sources.company).toBe("document_title");
    const bySlug = run(`<title>Careers</title>`, gh);
    expect(bySlug.company).toBe("Boardtoken");
    expect(bySlug.sources.company).toBe("url_slug");
    expect(bySlug.extractionWarnings.join(" ")).toMatch(/low confidence/);
    expect(run(`<title>Platform Engineer</title>`, "https://example.test/careers/1").company).toBeNull(); // never made up
    // a job-board name is not an employer
    expect(run(`<title>Careers</title><meta property="og:site_name" content="Greenhouse">`, "https://example.test/x").company).toBeNull();
  });
});

describe("country and name fields from a real board", () => {
  it("'Preferred First Name' is the preferred-name field, not a first-name conflict; a real conflict stays ambiguous", () => {
    set(`<label for="p">Preferred First Name</label><input id="p" name="preferred_name"><label for="f">First Name*</label><input id="f" name="first_name">`);
    const [pref, first] = observeForm(document).fields;
    expect(pref).toMatchObject({ semanticType: "preferred_name", ambiguous: false });
    expect(first).toMatchObject({ semanticType: "first_name", ambiguous: false });
    const conflict = classifyField([{ source: "explicit_label", text: "Email" }, { source: "aria_label", text: "Phone" }], "text", "");
    expect(conflict.ambiguous).toBe(true);
  });

  it("an intl-tel-input row's option label is the country name, and the trigger shows the chosen country from its title", () => {
    set(`<button class="iti__selected-country" title="India: +91"><span class="iti__selected-dial-code">+91</span></button><button class="iti__selected-country" id="empty" title="Select a country"></button>
         <ul><li id="row"><span class="iti__flag"></span><span class="iti__country-name">India</span><span class="iti__dial-code">+91</span></li></ul>`);
    expect(optionText(document.getElementById("row")!)).toBe("India");
    expect(displayedValue(document.querySelector(".iti__selected-country") as HTMLElement)).toBe("India");
    expect(displayedValue(document.getElementById("empty") as HTMLElement)).toBe("");
  });
});
