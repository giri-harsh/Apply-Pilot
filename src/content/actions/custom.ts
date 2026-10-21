import { normalizeText } from "../observer/dom";
import { isExpanded, listboxFor, optionElements, optionText } from "../observer/widgets";
import { fire, setNativeValue, settle } from "./native";

/**
 * Interaction with custom dropdowns and autocompletes (SPEC 12.3 / 12.4):
 * open -> observe the real options -> pick by label -> confirm the list closed. Verification of the
 * displayed value happens separately in the verifier. Every wait is bounded; failures restore the page
 * to a clean state instead of leaving "typed but not selected" text behind.
 */

const norm = (s: string) => normalizeText(s).toLowerCase();

export async function waitFor(cond: () => boolean, timeoutMs: number, stepMs = 40): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cond()) return true;
    await settle(stepMs);
  }
  return cond();
}

/** Controls that would submit, finalize or certify must never be clicked, even as a dropdown trigger. */
export function mayClick(el: HTMLElement): { ok: true } | { ok: false; reason: string } {
  const tag = el.tagName;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (tag === "INPUT" && ["submit", "image", "reset"].includes(type)) return { ok: false, reason: "Control is a submit/reset button" };
  if (tag === "BUTTON" && type !== "button" && el.closest("form")) return { ok: false, reason: "Button could submit the form" };
  if (/\b(submit|finalize|certify|apply)\b/i.test(normalizeText(el.textContent)) && tag !== "LI") return { ok: false, reason: "Control looks like a submit action" };
  return { ok: true };
}

/** pointerdown -> mousedown -> pointerup -> mouseup -> click, as a person would; many widgets select on mousedown. */
export function fullClick(el: HTMLElement): void {
  const w = el.ownerDocument.defaultView!;
  el.scrollIntoView?.({ block: "nearest" });
  el.focus?.();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

async function closeList(trigger: HTMLElement): Promise<void> {
  if (!isExpanded(trigger) && optionElements(listboxFor(trigger), true).length === 0) return;
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(60);
  if (isExpanded(trigger) && mayClick(trigger).ok) {
    fullClick(trigger);
    await settle(60);
  }
}

function visibleOptions(trigger: HTMLElement): HTMLElement[] {
  return optionElements(listboxFor(trigger), true);
}

function pickExact(options: HTMLElement[], label: string): HTMLElement {
  const want = norm(label);
  const hits = options.filter((o) => norm(optionText(o)) === want);
  if (hits.length === 0) throw new Error("No option matches the value");
  if (hits.length > 1) throw new Error("Several options match the value");
  return hits[0]!;
}

export async function selectCustomOption(trigger: HTMLElement, optionLabel: string): Promise<void> {
  const g = mayClick(trigger);
  if (!g.ok) throw new Error(g.reason);
  if (!isExpanded(trigger)) fullClick(trigger);
  const opened = await waitFor(() => visibleOptions(trigger).length > 0, 2000);
  if (!opened) {
    await closeList(trigger);
    throw new Error("The dropdown did not show any options");
  }
  let option: HTMLElement;
  try {
    option = pickExact(visibleOptions(trigger), optionLabel);
  } catch (e) {
    await closeList(trigger);
    throw e;
  }
  fullClick(option);
  const closed = await waitFor(() => !isExpanded(trigger) && visibleOptions(trigger).length === 0, 1500);
  if (!closed) {
    await closeList(trigger);
    throw new Error("The dropdown stayed open after choosing");
  }
  await settle();
}

export async function fillAutocomplete(input: HTMLInputElement, query: string, optionLabel: string): Promise<void> {
  const previous = input.value;
  input.scrollIntoView?.({ block: "nearest" });
  input.focus();
  setNativeValue(input, query);
  fire(input, "input", { inputType: "insertText", data: query } as InputEventInit);

  const restore = async () => {
    setNativeValue(input, previous);
    fire(input, "input", { inputType: "deleteContentBackward" } as InputEventInit);
    await closeList(input);
    input.blur();
  };

  const appeared = await waitFor(() => visibleOptions(input).length > 0, 2500);
  if (!appeared) {
    await restore();
    throw new Error("No suggestions appeared");
  }
  let option: HTMLElement;
  try {
    option = pickExact(visibleOptions(input), optionLabel);
  } catch (e) {
    await restore();
    throw new Error(`Typed text is not a selection: ${(e as Error).message}`, { cause: e });
  }
  fullClick(option);
  const closed = await waitFor(() => !isExpanded(input) && visibleOptions(input).length === 0, 1500);
  if (!closed) {
    await restore();
    throw new Error("The suggestion list stayed open after choosing");
  }
  fire(input, "change");
  await settle(60);
}

