import { LengthLimit, parseLimitFromText } from "@/answers/limits";
import { isVisible, normalizeText, textOfIds } from "./dom";

const COUNTER_SELECTOR = "[class*=counter], [class*=char-count], [class*=charcount], [class*=word-count], [class*=hint], [class*=help], [data-counter], small";

/**
 * Finds the length limit a page imposes on an answer field: the `maxlength` attribute, "max 300 words" style text
 * in the label, description, hint or the next few siblings, and live "0/500" counters. Strictest wins.
 */
export function detectLimit(el: HTMLElement, label: string): LengthLimit | null {
  const found: LengthLimit[] = [];
  const doc = el.ownerDocument;

  const ml = (el as HTMLTextAreaElement | HTMLInputElement).maxLength;
  if (typeof ml === "number" && ml > 0 && ml < 100000) found.push({ unit: "chars", max: ml, source: "maxlength" });

  const words = Number(el.getAttribute("data-max-words") ?? el.getAttribute("data-maxwords") ?? "");
  if (words > 0) found.push({ unit: "words", max: words, source: "text" });
  const chars = Number(el.getAttribute("data-maxlength") ?? el.getAttribute("data-max-length") ?? "");
  if (chars > 0) found.push({ unit: "chars", max: chars, source: "text" });

  const texts: { text: string; counter: boolean }[] = [{ text: label, counter: false }];
  texts.push({ text: textOfIds(doc, el.getAttribute("aria-describedby")), counter: false });
  texts.push({ text: el.getAttribute("placeholder") ?? "", counter: false });

  let sib: Element | null = el.nextElementSibling;
  for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
    if (sib.matches("input,select,textarea,label,button,fieldset")) break;
    if (isVisible(sib)) texts.push({ text: normalizeText(sib.textContent).slice(0, 200), counter: true });
  }
  // A hint placed just before the field (up to two siblings), stopping at the previous control or label.
  let prev: Element | null = el.previousElementSibling;
  for (let i = 0; i < 2 && prev; i++, prev = prev.previousElementSibling) {
    if (prev.matches("input,select,textarea,label,button,fieldset")) break;
    if (isVisible(prev)) texts.push({ text: normalizeText(prev.textContent).slice(0, 200), counter: true });
  }
  // A counter or hint wrapped inside the field's own container, but only when that container holds this one field.
  const wrap = el.parentElement;
  if (wrap && wrap.querySelectorAll("input,select,textarea").length === 1) {
    wrap.querySelectorAll(COUNTER_SELECTOR).forEach((n) => {
      if (n !== el && isVisible(n)) texts.push({ text: normalizeText(n.textContent).slice(0, 200), counter: true });
    });
  }

  for (const t of texts) {
    const l = parseLimitFromText(t.text);
    if (l) found.push(l);
  }
  if (found.length === 0) return null;
  const scale = (l: LengthLimit) => (l.unit === "words" ? l.max * 6 : l.max);
  return found.reduce((a, b) => (scale(b) < scale(a) ? b : a));
}
