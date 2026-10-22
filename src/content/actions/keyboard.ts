import { isCancelled } from "../cancel";
import { fire, setNativeValue, settle } from "./native";

/**
 * Keyboard fallback (SPEC 12.12), used as a different strategy when the default fill was not accepted: some pages
 * only commit a value on key events. Types the value one key at a time (keydown, keypress, input, keyup), then
 * change and blur. Idempotent: it starts by clearing the field, so repeating it never duplicates text.
 */
export async function typeWithKeys(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const w = el.ownerDocument.defaultView!;
  el.scrollIntoView?.({ block: "center" });
  el.focus();
  setNativeValue(el, "");
  fire(el, "input", { inputType: "deleteContentBackward" } as InputEventInit);
  let acc = "";
  let n = 0;
  for (const ch of value) {
    if (isCancelled()) return;
    const init = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new w.KeyboardEvent("keydown", init));
    el.dispatchEvent(new w.KeyboardEvent("keypress", init));
    acc += ch;
    setNativeValue(el, acc);
    fire(el, "input", { inputType: "insertText", data: ch } as InputEventInit);
    el.dispatchEvent(new w.KeyboardEvent("keyup", init));
    if (++n % 40 === 0) await settle(0);
  }
  fire(el, "change");
  el.blur();
}
