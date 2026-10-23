import { isVisible, normalizeText } from "@/content/observer/dom";
import { JobContextSchema, type JobContext, type JobSource } from "./schema";
import {
  detectArrangement,
  detectEmploymentType,
  educationLines,
  eligibilityLines,
  experienceLines,
  looksLikeInjection,
  splitSections,
  type EmploymentType,
} from "./sections";
import { extractSkills } from "./skills";
import { companyFromSlug, companyFromTitle } from "./company";

export type ExtractOptions = { maxChars: number };
export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = { maxChars: 12_000 };

/* ----------------------------- text helpers ----------------------------- */

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE", "BR", "TR", "TABLE", "BLOCKQUOTE", "PRE", "HEADER", "FOOTER", "MAIN", "ASIDE", "DETAILS", "SUMMARY", "DT", "DD", "FIGURE", "FORM", "FIELDSET"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "CANVAS", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "OPTION", "OBJECT"]);

function tidy(text: string): string {
  return text
    .replace(/\xa0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n")
    .trim();
}

/** Own-visibility check for one element; ancestors are handled by the recursive walk. */
function selfHidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  const view = el.ownerDocument.defaultView;
  if (view) {
    const cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
  }
  // Closed <details>: everything except <summary> is not rendered.
  const parent = el.parentElement;
  if (parent?.tagName === "DETAILS" && !parent.hasAttribute("open") && el.tagName !== "SUMMARY") return true;
  return false;
}

/** Visible text only (SPEC 8.1), with block structure kept as line breaks. */
export function visibleText(root: Element, skip: (el: Element) => boolean = () => false): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || skip(el) || selfHidden(el)) return;
    const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
    if (block) parts.push("\n");
    if (el.tagName === "LI") parts.push("• ");
    if (el.tagName === "DETAILS" && !el.hasAttribute("open")) {
      // A closed <details> renders only its <summary>, including any bare text nodes it holds.
      Array.from(el.children).filter((c) => c.tagName === "SUMMARY").forEach(walk);
    } else el.childNodes.forEach(walk);
    if (block) parts.push("\n");
  };
  if (!selfHidden(root)) root.childNodes.forEach(walk);
  return tidy(parts.join(""));
}

/** HTML string (as found in JSON-LD descriptions) to text. Handles double-encoded markup. */
export function htmlToText(html: string): string {
  let src = html;
  for (let i = 0; i < 2; i++) {
    if (!/<\/?[a-z][^>]*>/i.test(src) && !/&(lt|gt|amp|#\d+);/i.test(src)) break;
    const doc = new DOMParser().parseFromString(src, "text/html");
    const parts: string[] = [];
    const walk = (n: Node): void => {
      if (n.nodeType === 3) parts.push(n.textContent ?? "");
      else if (n.nodeType === 1) {
        const el = n as Element;
        if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
        const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
        if (block) parts.push("\n");
        if (el.tagName === "LI") parts.push("• ");
        el.childNodes.forEach(walk);
        if (block) parts.push("\n");
      }
    };
    doc.body.childNodes.forEach(walk);
    src = parts.join("");
  }
  return tidy(src);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function similar(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

/* -------------------------------- noise -------------------------------- */

const NOISE_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "dialog", "alertdialog", "search", "menu", "menubar"]);
const NOISE_TOKENS = /(^|[-_\s])(nav|navbar|navigation|menu|breadcrumbs?|cookies?|cookie-?banner|consent|gdpr|advert(isement)?s?|ads?|ad-slot|sponsored|promo|related|similar|recommended|more-jobs|other-jobs|also-viewed|share|social|newsletter|subscribe|sidebar|footer|modal|popup|toast|skip-link)([-_\s]|$)/i;
const RELATED_HEADING = /\b((related|similar|recommended|other|more|suggested|featured) (jobs|roles|openings|positions|opportunities|listings)|jobs? (you (may|might) (also )?like)|you (may|might) also like|people also viewed|explore (more|other) (jobs|roles))\b/i;

function inBody(el: Element): boolean {
  return Boolean(el.closest("main, article, [role=main]"));
}

function formWithInputs(el: Element): boolean {
  return el.tagName === "FORM" && el.querySelectorAll("input:not([type=hidden]), textarea, select").length >= 2;
}

export function isNoiseElement(el: Element, related: Set<Element>): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === "NAV" || tag === "ASIDE" || tag === "DIALOG") return true;
  if ((tag === "HEADER" || tag === "FOOTER") && !inBody(el)) return true;
  if (formWithInputs(el)) return true;
  const role = el.getAttribute("role");
  if (role && NOISE_ROLES.has(role) && !(role === "banner" && inBody(el))) return true;
  if (el.getAttribute("aria-modal") === "true") return true;
  if (related.has(el)) return true;
  const tokens = `${el.id} ${typeof el.className === "string" ? el.className : ""}`;
  if (tokens.trim() && NOISE_TOKENS.test(tokens) && !/(^|[-_\s])(job-?)?(description|content|posting|details?)([-_\s]|$)/i.test(tokens)) return true;
  return false;
}

/** Blocks introduced by a "Similar jobs" style heading are noise, whatever they are called in the markup. */
function relatedBlocks(doc: Document): Set<Element> {
  const out = new Set<Element>();
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading],strong,b").forEach((h) => {
    const t = normalizeText(h.textContent);
    if (t.length > 80 || !RELATED_HEADING.test(t)) return;
    const block = h.closest("section, aside, div, ul, ol") ?? h.parentElement;
    if (block && block !== doc.body && block.tagName !== "MAIN" && block.tagName !== "ARTICLE") out.add(block);
  });
  return out;
}

/* ------------------------------ JSON-LD -------------------------------- */

type Json = Record<string, unknown>;

function parseJsonLd(doc: Document, warnings: string[]): Json[] {
  const found: Json[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const o = v as Json;
    const t = o["@type"];
    if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) found.push(o);
    if (o["@graph"]) visit(o["@graph"]);
    if (o["mainEntity"]) visit(o["mainEntity"]);
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    const raw = s.textContent ?? "";
    try {
      visit(JSON.parse(raw));
    } catch {
      try {
        // Common author mistakes: trailing commas and HTML comments.
        visit(JSON.parse(raw.replace(/<!--|-->/g, "").replace(/,\s*([}\]])/g, "$1")));
        warnings.push("JSON-LD needed repairs to parse");
      } catch {
        warnings.push("Malformed JSON-LD ignored");
      }
    }
  });
  return found;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function orgName(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return orgName(v[0]);
  if (v && typeof v === "object") return str((v as Json)["name"]) ?? str((v as Json)["legalName"]);
  return null;
}

function ldLocation(v: unknown): string | null {
  const one = (x: unknown): string | null => {
    if (typeof x === "string") return str(x);
    if (!x || typeof x !== "object") return null;
    const o = x as Json;
    const addr = (o["address"] ?? o) as Json | string;
    if (typeof addr === "string") return str(addr);
    const country = typeof addr["addressCountry"] === "object" ? str((addr["addressCountry"] as Json)["name"]) : str(addr["addressCountry"]);
    const parts = [str(addr["addressLocality"]), str(addr["addressRegion"]), country].filter(Boolean);
    return parts.length ? parts.join(", ") : str(o["name"]);
  };
  return Array.isArray(v) ? one(v[0]) : one(v);
}

const LD_EMPLOYMENT: Record<string, EmploymentType> = {
  FULL_TIME: "full_time", PART_TIME: "part_time", CONTRACTOR: "contract", TEMPORARY: "temporary", INTERN: "internship", OTHER: "other", VOLUNTEER: "other", PER_DIEM: "other",
};

/* ------------------------------ extraction ------------------------------ */

const COMPANY_SELECTORS = [
  '[itemprop="hiringOrganization"] [itemprop="name"]',
  '[itemprop="hiringOrganization"]',
  "[data-company], [data-employer]",
  ".company-name, .companyName, .employer-name, .job-company, .posting-company, .org-name",
  '[class*="company-name"], [class*="employer-name"], [class*="CompanyName"]',
];

function genericSegment(s: string): boolean {
  return /\b(careers?|jobs?|hiring|apply|openings?|opportunit\w+|vacanc\w+|recruit\w+|work with us|join us)\b/i.test(s);
}

export function extractJob(doc: Document, url: string, options: ExtractOptions = DEFAULT_EXTRACT_OPTIONS): JobContext {
  const warnings: string[] = [];
  const related = relatedBlocks(doc);
  const noise = (el: Element) => isNoiseElement(el, related);
  const conf = { title: 0, company: 0, description: 0 };
  const sources: { title: JobSource | null; company: JobSource | null; description: JobSource | null } = { title: null, company: null, description: null };

  /* ---- visible title (h1) ---- */
  let visibleTitle: string | null = null;
  for (const h of Array.from(doc.querySelectorAll("h1"))) {
    if (!isVisible(h) || h.closest("nav, aside, footer, dialog, [role=dialog]")) continue;
    const t = normalizeText(h.textContent);
    if (t && t.length <= 150) {
      visibleTitle = t;
      break;
    }
  }

  /* ---- JSON-LD ---- */
  const postings = parseJsonLd(doc, warnings);
  let ld: Json | null = null;
  if (postings.length > 0) {
    if (postings.length > 1) warnings.push(`${postings.length} JobPosting blocks found; chose the one matching the visible title`);
    ld = postings.find((p) => visibleTitle && str(p["title"]) && similar(str(p["title"])!, visibleTitle) >= 0.8) ?? postings[0]!;
  }

  /* ---- title ---- */
  let title: string | null = null;
  const ldTitle = ld ? str(ld["title"]) : null;
  if (ldTitle && visibleTitle && similar(ldTitle, visibleTitle) < 0.5) {
    warnings.push("JSON-LD title differs from the visible heading; using the visible heading");
    title = visibleTitle;
    sources.title = "heading";
    conf.title = 0.6;
  } else if (ldTitle) {
    title = ldTitle;
    sources.title = "json_ld";
    conf.title = visibleTitle ? 0.97 : 0.9;
  } else if (visibleTitle) {
    title = visibleTitle;
    sources.title = "heading";
    conf.title = 0.8;
  }
  const docTitle = normalizeText(doc.title);
  const ogTitle = normalizeText(doc.querySelector('meta[property="og:title"]')?.getAttribute("content"));
  if (!title) {
    const candidate = ogTitle || docTitle;
    if (candidate) {
      title = candidate.split(/\s+[|·•–—-]\s+|\s+at\s+/)[0]!.trim() || null;
      sources.title = ogTitle ? "open_graph" : "document_title";
      conf.title = 0.5;
      if (title) warnings.push("Title taken from page metadata, not a visible heading");
    }
  }

  /* ---- company ---- */
  let company: string | null = ld ? orgName(ld["hiringOrganization"]) : null;
  if (company) {
    sources.company = "json_ld";
    conf.company = 0.95;
  }
  if (!company) {
    for (const sel of COMPANY_SELECTORS) {
      const el = Array.from(doc.querySelectorAll(sel)).find((e) => isVisible(e) && normalizeText(e.textContent).length > 1 && normalizeText(e.textContent).length <= 80);
      if (el) {
        company = normalizeText((el as HTMLElement).getAttribute("content") || el.textContent);
        sources.company = sel.includes("itemprop") ? "microdata" : "page_selector";
        conf.company = sel.includes("itemprop") ? 0.9 : 0.75;
        break;
      }
    }
  }
  if (!company) {
    const site = str(doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content"));
    if (site && !genericSegment(site) && !/\b(greenhouse|lever|ashby|workable|smartrecruiters|linkedin|indeed|glassdoor)\b/i.test(site)) {
      company = site;
      sources.company = "open_graph";
      conf.company = 0.5;
      warnings.push("Company taken from the site name; it may be the job board, not the employer");
    }
  }
  if (!company) {
    // "Job Application for <role> at <Company>": the LAST " at " (a role title can contain one).
    const c = companyFromTitle(ogTitle || docTitle);
    if (c) {
      company = c;
      sources.company = "document_title";
      conf.company = 0.6;
      warnings.push("Company inferred from the page title");
    }
  }
  if (!company) {
    const parts = (ogTitle || docTitle).split(/\s+[|·•–—-]\s+|\s+at\s+/).map((p) => p.trim()).filter(Boolean);
    const rest = parts.filter((p) => !(title && similar(p, title) >= 0.8) && !genericSegment(p) && p.length >= 2 && p.length <= 60);
    if (rest.length > 0 && parts.length > 1) {
      company = rest[0]!;
      sources.company = "document_title";
      conf.company = 0.55;
      warnings.push("Company inferred from the page title");
    }
  }
  if (!company) {
    const slug = companyFromSlug(url);
    if (slug) {
      company = slug;
      sources.company = "url_slug";
      conf.company = 0.2;
      warnings.push("Company guessed from the job board address (low confidence)");
    }
  }

  /* ---- description ---- */
  let description = "";
  const ldDescription = ld ? htmlToText(str(ld["description"]) ?? "") : "";
  const scored = scoreMainContent(doc, noise);
  if (ldDescription.length >= 200 && !(scored.text.length > ldDescription.length * 3 && ldDescription.length < 600)) {
    description = ldDescription;
    sources.description = "json_ld";
    conf.description = 0.9;
  } else if (scored.text.length >= 80) {
    description = scored.text;
    sources.description = "main_content";
    conf.description = 0.6;
    if (ldDescription) warnings.push("JSON-LD description was too short; used the visible page content");
  } else if (ldDescription) {
    description = ldDescription;
    sources.description = "json_ld";
    conf.description = 0.5;
  }
  if (!description) warnings.push("No job description text could be identified");

  if (description.length > options.maxChars) {
    const cut = description.lastIndexOf("\n", options.maxChars);
    description = description.slice(0, cut > options.maxChars * 0.6 ? cut : options.maxChars).trim();
    warnings.push(`Description truncated to ${options.maxChars} characters`);
  }
  if (looksLikeInjection(description)) warnings.push("The posting contains instruction-like text; it was treated as data and ignored");

  /* ---- structure ---- */
  const sections = splitSections(description);
  const reqText = sections.required.join("\n");
  const prefText = sections.preferred.join("\n");
  const requiredSkills = sections.foundHeadings ? extractSkills(reqText) : [];
  const preferredSkills = (sections.foundHeadings ? extractSkills(prefText) : []).filter((s) => !requiredSkills.includes(s));
  if (!sections.foundHeadings && description) warnings.push("No requirement sections detected; skills are listed as keywords only");
  const titleSkills = title ? extractSkills(title) : [];
  const keywords = [...new Set([...titleSkills, ...extractSkills(description)])].slice(0, 60);

  /* ---- location, type, arrangement ---- */
  let location = ld ? ldLocation(ld["jobLocation"]) : null;
  if (!location) {
    const el = Array.from(doc.querySelectorAll('[itemprop="jobLocation"], .location, .job-location, [class*="job-location"], [data-location]')).find((e) => isVisible(e) && normalizeText(e.textContent).length <= 100);
    if (el) location = normalizeText(el.textContent).replace(/^location[:\s]*/i, "") || null;
  }
  const ldType = ld ? [ld["employmentType"]].flat().map((x) => (typeof x === "string" ? LD_EMPLOYMENT[x.toUpperCase().replace(/[- ]/g, "_")] : undefined)).find(Boolean) : undefined;
  const employmentType = ldType ?? detectEmploymentType(`${title ?? ""}\n${description.slice(0, 1500)}`);
  const arrangement =
    ld && str(ld["jobLocationType"])?.toUpperCase() === "TELECOMMUTE"
      ? "remote"
      : detectArrangement(`${location ?? ""}\n${title ?? ""}\n${description.slice(0, 1200)}`);

  const weights = { title: 0.35, company: 0.25, description: 0.4 };
  const confidence = Math.round((conf.title * weights.title + conf.company * weights.company + conf.description * weights.description) * 100) / 100;
  if (!title) warnings.push("Job title not found");
  if (!company) warnings.push("Company not found");

  return JobContextSchema.parse({
    jobTitle: title,
    company,
    jobUrl: url,
    descriptionText: description,
    requiredQualifications: sections.required,
    preferredQualifications: sections.preferred,
    responsibilities: sections.responsibilities,
    requiredSkills,
    preferredSkills,
    educationRequirements: educationLines(description),
    experienceRequirements: experienceLines(description),
    location,
    employmentType,
    workArrangement: arrangement,
    relevantKeywords: keywords,
    eligibilityNotes: eligibilityLines(description),
    sourceConfidence: confidence,
    sources,
    extractionWarnings: warnings.slice(0, 20),
  });
}

/** Picks the container that most likely holds the posting body, ignoring navigation, banners, ads and related-job blocks. */
function scoreMainContent(doc: Document, noise: (el: Element) => boolean): { text: string; el: Element | null } {
  const KEYWORDS = /(responsibilities|requirements|qualifications|what you(?:'|’)?ll|who you are|about the (?:role|job|position|internship)|skills|you will|we(?:'|’)?re looking for)/gi;
  const candidates = Array.from(doc.querySelectorAll("main, article, [role=main], section, div")).filter(
    (el) => !noise(el) && !el.closest("nav, aside, dialog, [role=dialog], footer") && (el.textContent ?? "").length >= 200 && isVisible(el),
  );
  if (doc.body) candidates.push(doc.body);
  const limited = candidates.slice(0, 400);

  type Scored = { el: Element; text: string; score: number };
  const scoredList: Scored[] = limited.map((el) => {
    const text = visibleText(el, noise);
    let linkChars = 0;
    el.querySelectorAll("a").forEach((a) => {
      if (!noise(a) && !a.closest("nav, aside, footer")) linkChars += normalizeText(a.textContent).length;
    });
    const density = Math.min(0.9, linkChars / Math.max(1, text.length));
    const kw = Math.min(6, (text.match(KEYWORDS) ?? []).length);
    return { el, text, score: text.length * (1 - density) + kw * 400 };
  });
  if (scoredList.length === 0) return { text: "", el: null };
  const best = scoredList.reduce((a, b) => (b.score > a.score ? b : a));
  // Tighten to the smallest container inside `best` that still holds nearly all of its content.
  const inside = scoredList.filter((s) => s.el !== best.el && best.el.contains(s.el) && s.score >= best.score * 0.9);
  const tight = inside.sort((a, b) => (a.el.contains(b.el) ? 1 : -1))[inside.length - 1];
  const chosen = tight ?? best;
  return { text: chosen.text, el: chosen.el };
}
