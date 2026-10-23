import { documentHasLayout, isVisible, normalizeText } from "./observer/dom";

/**
 * Things the agent must never try to get past (SPEC 3.2 / 17.2): CAPTCHA, MFA / verification codes, login walls.
 * Detection only. The harness stops with BLOCKED and a reason; nothing here ever interacts with these widgets.
 */

export type BlockerType = "captcha" | "mfa" | "login";
export type Blocker = { type: BlockerType; detail: string };

export type FrameInfo = { origin: string; accessible: boolean; visible: boolean; width: number; height: number };

export type BlockerReport = { blockers: Blocker[]; frames: FrameInfo[] };

const CAPTCHA_FRAME = /(recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha|captcha|geetest|px-captcha)/i;
const CAPTCHA_TEXT = /(i'?m not a robot|i am not a robot|verify (that )?you(?:'| a)?re (a )?human|prove you(?:'| a)?re (a )?human|complete the (captcha|security check)|select all (images|squares)|security check)/i;
const MFA_LABEL = /(verification code|security code|one[- ]time (code|password|passcode)|authenticator (app|code)|two[- ]factor|2fa|multi[- ]factor|mfa|otp\b|enter the code|6[- ]digit code|sms code)/i;

function safeOrigin(src: string, base: string): string {
  try {
    return new URL(src, base).origin;
  } catch {
    return "unknown";
  }
}

export function detectFrames(doc: Document): FrameInfo[] {
  const out: FrameInfo[] = [];
  for (const f of Array.from(doc.querySelectorAll("iframe, frame"))) {
    const src = f.getAttribute("src") ?? "";
    const origin = src ? safeOrigin(src, doc.baseURI) : doc.location?.origin ?? "same";
    let accessible: boolean;
    try {
      accessible = Boolean((f as HTMLIFrameElement).contentDocument);
    } catch {
      accessible = false;
    }
    const r = (f as HTMLElement).getBoundingClientRect();
    out.push({ origin, accessible, visible: isVisible(f), width: Math.round(r.width), height: Math.round(r.height) });
  }
  return out;
}

const MIN_W = 100;
const MIN_H = 40;

/** True when the element is rendered, on screen, and at least w x h (layout-less documents, as in jsdom, count as large enough). */
function shownAtLeast(doc: Document, el: Element, w: number, h: number): boolean {
  if (!isVisible(el)) return false;
  if (!documentHasLayout(doc)) return true;
  const r = el.getBoundingClientRect();
  const view = doc.defaultView;
  const onScreen = r.right > 0 && r.bottom > 0 && (!view || (r.left < view.innerWidth && r.top < view.innerHeight));
  return onScreen && r.width >= w && r.height >= h;
}

const isFormControl = (el: Element) => /^(TEXTAREA|INPUT|SELECT)$/.test(el.tagName);

/**
 * The user would have to act: a reCAPTCHA v2 checkbox (anchor without size=invisible), a reCAPTCHA challenge (bframe), a visible
 * hCaptcha or Turnstile widget, a visible provider widget of a real size, or a full-page "verify you are human" interstitial.
 * NOT: `.grecaptcha-badge`, an invisible anchor, tiny/hidden/off-screen frames, `g-recaptcha-response` textareas, the script.
 */
export function interactiveCaptcha(doc: Document): boolean {
  for (const f of Array.from(doc.querySelectorAll("iframe"))) {
    const src = f.getAttribute("src") ?? "";
    const title = f.getAttribute("title") ?? "";
    if (f.closest(".grecaptcha-badge")) continue; // the badge's own anchor frame
    if (!CAPTCHA_FRAME.test(`${src} ${title}`)) continue;
    if (/size=invisible/i.test(src)) continue;
    if (/recaptcha/i.test(src) && /\/bframe/i.test(src)) {
      if (shownAtLeast(doc, f, 1, 1)) return true; // a challenge that is on screen (the badge stays small, the challenge is large)
      continue;
    }
    if (shownAtLeast(doc, f, MIN_W, MIN_H)) return true; // checkbox anchor, hCaptcha, Turnstile, other providers
  }
  for (const w of Array.from(doc.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [class*="captcha" i], [id*="captcha" i]'))) {
    if (isFormControl(w) || w.closest(".grecaptcha-badge") || w.classList.contains("grecaptcha-badge")) continue;
    if (/invisible/i.test(w.getAttribute("data-size") ?? "")) continue;
    if (shownAtLeast(doc, w, MIN_W, MIN_H)) return true;
  }
  // A full-page interstitial: the wording on a page that is mostly just that message (not a long form that mentions it).
  const text = normalizeText(doc.body?.innerText ?? doc.body?.textContent ?? "").slice(0, 8000);
  if (CAPTCHA_TEXT.test(text) && text.length < 700) return true;
  return false;
}

export function detectBlockers(doc: Document): BlockerReport {
  const blockers: Blocker[] = [];

  // CAPTCHA: only a challenge the user would actually have to act on (see interactiveCaptcha). An invisible reCAPTCHA badge,
  // a 0x0 or off-screen frame, a response textarea or the script alone never blocks.
  if (interactiveCaptcha(doc)) blockers.push({ type: "captcha", detail: "A CAPTCHA or human-verification check is on this page" });

  // MFA / verification code: a visible one-time-code input or a code label.
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>("input")).filter(isVisible);
  const mfa = inputs.find((i) => i.autocomplete === "one-time-code" || MFA_LABEL.test(`${i.name} ${i.id} ${i.getAttribute("aria-label") ?? ""} ${i.placeholder} ${labelFor(i)}`));
  if (mfa) blockers.push({ type: "mfa", detail: "A verification code (MFA / one-time code) is required" });

  // Login wall: a visible password field.
  if (inputs.some((i) => i.type === "password")) blockers.push({ type: "login", detail: "This page asks you to sign in" });

  return { blockers, frames: detectFrames(doc) };
}

function labelFor(i: HTMLInputElement): string {
  const l = i.labels?.[0] ?? (i.id ? i.ownerDocument.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null);
  return normalizeText(l?.textContent);
}
