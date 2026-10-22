import { isVisible, normalizeText } from "../observer/dom";
import { findValidationMessage } from "../verification/verify";

/**
 * Did the page notice the file? Read-only checks plus the drop-zone fallback event. Same-document only: nothing here
 * ever targets another frame.
 */

const ERROR_SELECTOR = "[role=alert], .error, .invalid, .field-error, .upload-error, [data-error], [aria-invalid=true]";
const DROP_HINT = /drop|upload|zone|attach/i;

/** The smallest region around the input that holds only this input: its row / drop zone, never the whole form. */
export function scopeOf(input: HTMLElement): HTMLElement {
  const parent = input.parentElement;
  if (!parent || /^(BODY|HTML|FORM|MAIN)$/.test(parent.tagName) || parent.querySelectorAll("input,select,textarea").length !== 1) return input;
  let scope: HTMLElement = parent;
  let el: HTMLElement | null = parent.parentElement;
  for (let i = 0; i < 2 && el && !/^(BODY|HTML|FORM|MAIN)$/.test(el.tagName); i++, el = el.parentElement) {
    const controls = el.querySelectorAll("input,select,textarea");
    if (controls.length !== 1) break;
    scope = el;
  }
  return scope;
}

export type Snapshot = { html: string; text: string };

export function snapshot(scope: HTMLElement): Snapshot {
  return { html: scope.outerHTML.replace(/\s+/g, " ").slice(0, 30_000), text: normalizeText(scope.textContent) };
}

function errorText(input: HTMLElement, scope: HTMLElement, before: Snapshot): string | null {
  const own = findValidationMessage(input);
  if (own) return own;
  for (const n of Array.from(scope.querySelectorAll<HTMLElement>(ERROR_SELECTOR))) {
    const t = normalizeText(n.textContent);
    if (t && isVisible(n) && !before.text.includes(t)) return t;
  }
  return null;
}

export type Recognition = { state: "recognized" | "error" | "none"; detail: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls the region around the input until it shows evidence of recognition or an error, or the deadline passes.
 * A native, visible file input is its own evidence once it holds the file (the browser renders the name); a hidden
 * input behind a custom drop zone must show a visible change (filename or status text, or changed markup).
 * A minimum settle time lets an asynchronous validation error appear before success is declared.
 */
export async function awaitRecognition(input: HTMLInputElement, filename: string, before: Snapshot, opts: { minMs?: number; maxMs?: number } = {}): Promise<Recognition> {
  const minMs = opts.minMs ?? 250;
  const maxMs = opts.maxMs ?? 900;
  const scope = scopeOf(input);
  const start = Date.now();
  for (;;) {
    const err = errorText(input, scope, before);
    if (err) return { state: "error", detail: err.slice(0, 200) };
    const now = snapshot(scope);
    const filesOk = input.files?.length === 1 && input.files[0]!.name === filename;
    const cleared = (input.files?.length ?? 0) === 0;
    const shown = now.text.includes(filename) && !before.text.includes(filename);
    const changed = now.html !== before.html;
    const nativeVisible = filesOk && isVisible(input);
    if ((shown || (changed && (filesOk || cleared)) || nativeVisible) && Date.now() - start >= minMs) {
      return { state: "recognized", detail: shown ? "Filename is shown on the page" : changed ? "The page updated its upload status" : "The input holds the file" };
    }
    if (Date.now() - start >= maxMs) return { state: "none", detail: filesOk ? "The input holds the file but the page showed no change" : "The input does not hold the file" };
    await sleep(50);
  }
}

/** The element a drop would land on: the nearest drop-zone-looking ancestor within the input's region, else the region itself. */
export function dropTargetFor(input: HTMLElement): HTMLElement {
  const scope = scopeOf(input);
  let el: HTMLElement | null = input.parentElement;
  for (let i = 0; el && i < 3 && !/^(BODY|HTML|FORM|MAIN)$/.test(el.tagName); i++, el = el.parentElement) {
    if (el.hasAttribute("data-dropzone") || el.getAttribute("role") === "button" || DROP_HINT.test(`${el.className} ${el.id}`)) return el;
    if (el === scope) break;
  }
  return scope === input ? (input.parentElement ?? input) : scope;
}

/** Synthetic drag sequence with the file, same document only. Returns false if the environment cannot build one. */
export function dispatchDrop(target: HTMLElement, file: File): boolean {
  const view = target.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!view || typeof view.DataTransfer === "undefined" || typeof view.DragEvent === "undefined") return false;
  const dt = new view.DataTransfer();
  dt.items.add(file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new view.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }
  return true;
}
