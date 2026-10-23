import { isVisible, normalizeText } from "./dom";

/** Helpers for custom dropdowns / comboboxes / autocompletes (SPEC 12.3 / 12.4). Read-only. */

/** True for non-native widgets: ARIA comboboxes, listbox popups and autocomplete inputs. */
export function isComboboxWidget(el: Element): boolean {
  const tag = el.tagName;
  const role = el.getAttribute("role");
  const popup = el.getAttribute("aria-haspopup");
  const ac = el.getAttribute("aria-autocomplete");
  if (tag === "INPUT") return role === "combobox" || ac === "list" || ac === "both" || popup === "listbox";
  if (tag === "SELECT" || tag === "TEXTAREA") return false;
  return role === "combobox" || popup === "listbox";
}

/** A non-input trigger (div/button/...) that behaves like a select. */
export function isCustomTrigger(el: Element): boolean {
  return !["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && isComboboxWidget(el);
}

/** True when another element explicitly claims this listbox through aria-controls / aria-owns. */
function claimedByOther(box: HTMLElement, trigger: HTMLElement): boolean {
  if (!box.id) return false;
  const doc = box.ownerDocument;
  return Array.from(doc.querySelectorAll<HTMLElement>("[aria-controls], [aria-owns]")).some(
    (e) => e !== trigger && ((e.getAttribute("aria-controls") ?? "") + " " + (e.getAttribute("aria-owns") ?? "")).split(/\s+/).includes(box.id),
  );
}

/**
 * The popup list for a trigger: aria-controls/owns first; otherwise a listbox right next to the trigger.
 * When the list is open (`includeHidden` false) the single visible listbox that nobody else claims also counts.
 */
export function listboxFor(el: HTMLElement, includeHidden = false): HTMLElement | null {
  const doc = el.ownerDocument;
  const ref = (el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns") ?? "").split(/\s+/)[0];
  if (ref) {
    const c = doc.getElementById(ref);
    if (c) return c;
  }
  // Proximity: a listbox inside one of the next two siblings (e.g. an empty slot that fills when opened).
  let sib: Element | null = el.nextElementSibling;
  for (let i = 0; i < 2 && sib; i++, sib = sib.nextElementSibling) {
    const box = sib.matches("[role=listbox]") ? (sib as HTMLElement) : sib.querySelector<HTMLElement>("[role=listbox]");
    if (box && !claimedByOther(box, el) && (includeHidden || isVisible(box))) return box;
  }
  if (includeHidden) return null;
  const boxes = Array.from(doc.querySelectorAll<HTMLElement>("[role=listbox]")).filter((b) => isVisible(b) && !claimedByOther(b, el));
  return boxes.length === 1 ? boxes[0]! : null;
}

export function optionElements(box: HTMLElement | null, onlyVisible: boolean): HTMLElement[] {
  if (!box) return [];
  return Array.from(box.querySelectorAll<HTMLElement>("[role=option]")).filter((o) => !onlyVisible || isVisible(o));
}

export const optionText = (o: Element): string => {
  // intl-tel-input rows hold the country name and the dial code in separate spans: the option's label is the name alone.
  const name = o.querySelector(".iti__country-name");
  return normalizeText(name ? name.textContent : o.textContent);
};

const PLACEHOLDER = /^(select|choose|pick|please|--|—|…|\.\.\.|none|no selection|search|type)\b/i;

/** What the control currently shows as its value; "" when it shows only placeholder text. */
export function displayedValue(el: HTMLElement): string {
  // intl-tel-input shows a flag and a dial code; the chosen country is in the button's title ("India: +91").
  if (el.classList.contains("iti__selected-country")) {
    const t = (el.getAttribute("title") ?? "").split(":")[0]!.trim();
    return /^select/i.test(t) ? "" : t;
  }
  const raw = el.tagName === "INPUT" ? (el as HTMLInputElement).value : normalizeText(el.textContent);
  const v = raw.trim();
  return !v || PLACEHOLDER.test(v) ? "" : v;
}

export function isExpanded(el: Element): boolean {
  return el.getAttribute("aria-expanded") === "true";
}
