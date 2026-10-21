/**
 * Framework-compatible value setting (SPEC 12.2).
 *
 * React (and similar libraries) install an instance-level `value` property to track controlled inputs.
 * Assigning `el.value = x` goes through that tracker and the following `input` event is then ignored as a
 * no-op. Calling the *prototype's* native setter bypasses the tracker, so the event is seen as a real change.
 */

function viewOf(el: Element): Window & typeof globalThis {
  const v = el.ownerDocument.defaultView;
  if (!v) throw new Error("Element is detached from any window");
  return v as Window & typeof globalThis;
}

export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const w = viewOf(el);
  let proto: object;
  if (el instanceof w.HTMLInputElement) proto = w.HTMLInputElement.prototype;
  else if (el instanceof w.HTMLTextAreaElement) proto = w.HTMLTextAreaElement.prototype;
  else proto = w.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("Native value setter unavailable");
  setter.call(el, value);
}

export function fire(el: Element, type: string, init: EventInit = {}): void {
  const w = viewOf(el);
  const Ev = type === "input" ? w.InputEvent : w.Event;
  el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: false, ...init }));
}

/** focus -> native set -> input -> change -> blur: the event sequence a user typing and tabbing away produces. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  el.scrollIntoView?.({ block: "nearest" });
  el.focus();
  setNativeValue(el, value);
  fire(el, "input", { inputType: "insertText", data: value } as InputEventInit);
  fire(el, "change");
  el.blur();
}

/** Radios and checkboxes change through a click on the input itself, which is what assistive tech and users do. */
export function clickToggle(el: HTMLInputElement, wantChecked: boolean): void {
  if (el.checked === wantChecked) return;
  el.scrollIntoView?.({ block: "nearest" });
  el.focus();
  el.click();
}

export function settle(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
