import type { FormField } from "@/shared/form";
import type { PlannedFill, VerificationResult } from "@/shared/messages";
import { isVisible, normalizeText } from "../observer/dom";
import { settle } from "../actions/native";

const ERROR_CLASS = /\b(error|invalid|danger|alert|help-block|field-error|validation)\b/i;

/** Finds a visible validation message tied to the control, or null. Reads only; never changes the page. */
export function findValidationMessage(el: HTMLElement): string | null {
  const doc = el.ownerDocument;
  if (el.getAttribute("aria-invalid") === "true") {
    const described = el.getAttribute("aria-errormessage") ?? el.getAttribute("aria-describedby");
    const t = described
      ?.split(/\s+/)
      .map((id) => normalizeText(doc.getElementById(id)?.textContent))
      .find(Boolean);
    return t || "Field is marked invalid";
  }
  const native = el as HTMLInputElement;
  if (typeof native.validity !== "undefined" && !native.validity.valid) {
    return native.validationMessage || "Browser validation failed";
  }
  for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
    const n = doc.getElementById(id);
    if (n && isVisible(n) && normalizeText(n.textContent) && (n.getAttribute("role") === "alert" || ERROR_CLASS.test(n.className))) {
      return normalizeText(n.textContent);
    }
  }
  const sib = el.nextElementSibling ?? el.parentElement?.nextElementSibling ?? null;
  if (sib && isVisible(sib) && ERROR_CLASS.test(sib.className) && normalizeText(sib.textContent)) {
    return normalizeText(sib.textContent);
  }
  return null;
}

/**
 * SPEC 11.6 / 18.1: re-read what the page actually shows after the framework had a chance to re-render,
 * and check for validation feedback. Does not trust the value we wrote.
 */
export async function verifyFill(
  item: PlannedFill,
  field: FormField | undefined,
  els: HTMLElement[] | undefined,
): Promise<VerificationResult> {
  const fieldId = item.fieldId;
  if (!field || !els || els.length === 0 || els.some((e) => !e.isConnected)) {
    return { fieldId, verified: false, reason: "Field disappeared after filling" };
  }
  const a = item.action;
  const el = els[0]!;
  let matches = false;
  let attempts = 0;
  while (attempts++ < 5) {
    switch (a.type) {
      case "fill_text":
        matches = (el as HTMLInputElement).value === a.value;
        break;
      case "select_option":
        matches = (el as HTMLSelectElement).value === a.optionValue;
        break;
      case "select_radio":
        matches = (els as HTMLInputElement[]).some((r) => r.checked && r.value === a.optionValue);
        break;
      case "set_checkbox":
        matches = (el as HTMLInputElement).checked === a.checked;
        break;
      default:
        return { fieldId, verified: false, reason: "Nothing to verify" };
    }
    if (matches) break;
    await settle(25); // allow a controlled component to finish re-rendering before declaring a mismatch
  }
  if (!matches) return { fieldId, verified: false, reason: "Rendered value does not match what was entered" };
  const msg = findValidationMessage(el);
  if (msg) return { fieldId, verified: false, reason: `Validation message: ${msg}`.slice(0, 280) };
  return { fieldId, verified: true, reason: "Rendered value matches and no validation error is shown" };
}
