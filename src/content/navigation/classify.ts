import { isEnabled, isVisible, normalizeText } from "../observer/dom";

/**
 * SPEC 15.2 final-control classifier. The agent may only click a control it can positively identify as ordinary
 * progression ("next"). Anything that submits, finalizes, certifies or sends is "final", and anything it is not
 * sure about is treated as final too: when unsure, stop and hand over to the user.
 */

export type ControlRole = "next" | "final" | "back" | "other";

export type ControlInfo = {
  id: string;
  text: string;
  role: ControlRole;
  reasons: string[];
};

export type ControlsReport = {
  controls: ControlInfo[];
  isLastStep: boolean;
  hasReviewSummary: boolean;
  stepIndicator: { current: number; total: number } | null;
};

const FINAL_TEXT = /\b(submit|send( my)? application|apply( now| for this (job|role|position))?|finish|finali[sz]e|confirm|complete (my )?(application|submission|registration)|place (my )?order|certify|i (certify|agree|accept|confirm)|sign (and|&) submit|e-?sign|send|publish|post|pay(?:ment)?|check ?out|purchase|buy|register|enrol+|enroll)\b/i;
const NEXT_TEXT = /^(?:save (?:and|&) )?(?:next|continue|proceed|go to next|next step|continue to [\w\s&-]{2,40}|next:? [\w\s&-]{2,40}|review( (your )?(application|answers|details))?|add(itional)? (info|information|details)|education|experience|work history|skills|documents|questions|contact( info)?|personal( info| details)?|step \d+)\b/i;
const BACK_TEXT = /\b(back|previous|prev|cancel|go back|edit|start over|exit|discard|close|skip)\b/i;
const REVIEW_HEADING = /\b(review (your )?(application|answers|details|information)|confirm (your )?(application|details|submission)|application summary|summary of your|please review|check your (answers|details)|ready to submit)\b/i;

/** "Step 2 of 4", "2 / 4", aria progress, aria-current step. */
export function findStepIndicator(doc: Document): { current: number; total: number } | null {
  const text = normalizeText(doc.body?.innerText ?? doc.body?.textContent ?? "").slice(0, 6000);
  const m = /\bstep\s*(\d+)\s*(?:of|\/)\s*(\d+)\b/i.exec(text);
  if (m) return { current: Number(m[1]), total: Number(m[2]) };
  const bar = doc.querySelector<HTMLElement>("[role=progressbar][aria-valuenow][aria-valuemax]");
  if (bar) {
    const now = Number(bar.getAttribute("aria-valuenow"));
    const max = Number(bar.getAttribute("aria-valuemax"));
    if (max > 1 && now >= 0) return { current: now, total: max };
  }
  return null;
}

/** A page summarising entered answers (review step): a review heading plus a summary list/table. */
export function hasReviewSummary(doc: Document): boolean {
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3,legend,[role=heading]")).filter(isVisible);
  const hasHeading = headings.some((h) => REVIEW_HEADING.test(normalizeText(h.textContent)));
  const hasSummary = Boolean(Array.from(doc.querySelectorAll("dl, table, [class*=summary], [data-review]")).find(isVisible));
  return hasHeading && hasSummary;
}

function textOf(el: Element): string {
  const t = el.tagName === "INPUT" ? (el as HTMLInputElement).value : el.textContent;
  return normalizeText(t || el.getAttribute("aria-label") || el.getAttribute("title") || "");
}

/** A submit button of a form whose own `action` posts somewhere: pressing it sends the form, whatever it says. */
function realSubmit(el: HTMLElement): boolean {
  const type = (el.getAttribute("type") ?? (el.tagName === "BUTTON" ? "submit" : "")).toLowerCase();
  if (type !== "submit" && type !== "image") return false;
  const form = el.closest("form") ?? (el as HTMLButtonElement).form;
  if (!form) return false;
  const action = (form.getAttribute("action") ?? "").trim();
  const method = (form.getAttribute("method") ?? "get").toLowerCase();
  const formaction = (el.getAttribute("formaction") ?? "").trim();
  return (action !== "" && action !== "#" && !action.startsWith("javascript:")) || method === "post" || formaction !== "";
}

function classifyOne(el: HTMLElement, ctx: { lastStep: boolean; review: boolean }): { role: ControlRole; reasons: string[] } {
  const text = textOf(el);
  const reasons: string[] = [];
  if (BACK_TEXT.test(text) && !FINAL_TEXT.test(text)) return { role: "back", reasons: ["back / cancel wording"] };
  if (FINAL_TEXT.test(text)) return { role: "final", reasons: [`final wording "${text.slice(0, 40)}"`] };
  if (realSubmit(el)) return { role: "final", reasons: ["submit button of a form that posts to a server"] };
  if (ctx.review) return { role: "final", reasons: ["page is a review summary"] };
  if (ctx.lastStep) return { role: "final", reasons: ["control on the last step"] };
  if (NEXT_TEXT.test(text)) {
    reasons.push("progression wording");
    return { role: "next", reasons };
  }
  // Unknown wording on a button: never assume it is safe. Plain links and icons are "other".
  const tag = el.tagName;
  if (tag === "BUTTON" || (tag === "INPUT" && /^(submit|button)$/i.test(el.getAttribute("type") ?? ""))) {
    return { role: "final", reasons: ["unrecognised button; treated as final when unsure"] };
  }
  return { role: "other", reasons: ["not a button"] };
}

/** Classifies every visible, enabled action control. Read-only. */
export function classifyControls(doc: Document): { report: ControlsReport; elements: Map<string, HTMLElement> } {
  const indicator = findStepIndicator(doc);
  const review = hasReviewSummary(doc);
  const lastStep = indicator !== null && indicator.current >= indicator.total;
  const els = Array.from(doc.querySelectorAll<HTMLElement>("button, input[type=submit], input[type=button], input[type=image], [role=button], a[role=button]")).filter(
    (e) => isVisible(e) && isEnabled(e) && !e.closest("nav, header, footer, [role=navigation], dialog, [role=dialog]") && !(e.getAttribute("role") === "tab"),
  );
  const elements = new Map<string, HTMLElement>();
  const controls: ControlInfo[] = els.map((el, i) => {
    const id = `ctl_${String(i + 1).padStart(3, "0")}`;
    elements.set(id, el);
    const c = classifyOne(el, { lastStep, review });
    return { id, text: textOf(el).slice(0, 80), role: c.role, reasons: c.reasons };
  });
  return { report: { controls, isLastStep: lastStep, hasReviewSummary: review, stepIndicator: indicator }, elements };
}

/**
 * The single control the agent may click to advance, or null. Requires exactly one "next" control and no final
 * control that could be confused with it (a page with both "Continue" and "Submit" is a final step).
 */
export function pickNext(report: ControlsReport): ControlInfo | null {
  const nexts = report.controls.filter((c) => c.role === "next");
  if (nexts.length !== 1) return null;
  if (report.isLastStep || report.hasReviewSummary) return null;
  // Any control that is final for a stated reason (wording, a posting form, a review page) makes this a final step.
  // An unrecognised extra button (Help, Save draft) does not by itself veto a clearly worded "Next".
  const explicitFinal = report.controls.some((c) => c.role === "final" && !c.reasons[0]?.startsWith("unrecognised"));
  if (explicitFinal) return null;
  return nexts[0]!;
}
