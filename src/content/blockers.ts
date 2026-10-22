import { isVisible, normalizeText } from "./observer/dom";

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

export function detectBlockers(doc: Document): BlockerReport {
  const blockers: Blocker[] = [];

  // CAPTCHA: known provider frames/widgets, or the typical "I'm not a robot" text next to a control.
  const frameSrcs = Array.from(doc.querySelectorAll("iframe")).map((f) => `${f.getAttribute("src") ?? ""} ${f.getAttribute("title") ?? ""}`);
  const widget = doc.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [class*="captcha" i], [id*="captcha" i]');
  const text = normalizeText(doc.body?.innerText ?? doc.body?.textContent ?? "").slice(0, 8000);
  if (frameSrcs.some((s) => CAPTCHA_FRAME.test(s)) || (widget && isVisible(widget)) || CAPTCHA_TEXT.test(text)) {
    blockers.push({ type: "captcha", detail: "A CAPTCHA or human-verification check is on this page" });
  }

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
