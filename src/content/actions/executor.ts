import {
  AgentActionSchema,
  EXECUTABLE_ACTIONS,
  SENSITIVE_TYPES,
  type AgentAction,
  type FormField,
} from "@/shared/form";
import type { ExecutionResult } from "@/shared/messages";
import { fingerprintOf } from "../observer/observe";
import { isEnabled, isReadOnly, isVisible } from "../observer/dom";
import { fillAutocomplete, mayClick, selectCustomOption } from "./custom";
import { clickToggle, settle, typeInto } from "./native";

export type ExecContext = {
  fields: Map<string, FormField>;
  targets: Map<string, HTMLElement[]>;
  isCancelled: () => boolean;
};

export type Validation = { ok: true; field: FormField; els: HTMLElement[] } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SPEC 11.4: every action is validated on its own before anything touches the page.
 * Returns a reason string instead of throwing so the harness can report it.
 */
export function validateAction(raw: unknown, ctx: ExecContext): Validation {
  const parsed = AgentActionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Not a recognised action" };
  const action = parsed.data;

  if (!(EXECUTABLE_ACTIONS as readonly string[]).includes(action.type)) {
    return { ok: false, error: `Action "${action.type}" is not executable in this phase` };
  }
  if (!("fieldId" in action)) return { ok: false, error: "Action has no target" };

  const field = ctx.fields.get(action.fieldId);
  const els = ctx.targets.get(action.fieldId);
  if (!field || !els || els.length === 0) return { ok: false, error: "Target field does not exist" };

  // Policy is enforced here as well as in the mapper: a bad plan cannot widen what the executor will touch.
  if (SENSITIVE_TYPES.includes(field.semanticType)) return { ok: false, error: "Sensitive fields are never auto-filled" };
  if (field.semanticType === "consent") return { ok: false, error: "Consent fields are never auto-filled" };
  if (field.semanticType === "third_party_contact") return { ok: false, error: "Third-party fields are never auto-filled" };
  if (field.ambiguous) return { ok: false, error: "Field is ambiguous" };
  if (field.risk === "high" || field.risk === "restricted") return { ok: false, error: "Risk level requires the user" };

  if (els.some((e) => !e.isConnected)) return { ok: false, error: "Target is no longer in the page" };
  if (fingerprintOf(els, field.label) !== field.fingerprint) {
    return { ok: false, error: "Target no longer matches the observed field" };
  }
  if (!els.some((e) => isVisible(e))) return { ok: false, error: "Target is not visible" };
  if (!els.every((e) => isEnabled(e) && !isReadOnly(e))) return { ok: false, error: "Target is disabled or read-only" };

  const el = els[0]!;
  switch (action.type) {
    case "fill_text": {
      if (field.control !== "text" && field.control !== "textarea") return { ok: false, error: "Not a text control" };
      const max = (el as HTMLInputElement).maxLength;
      if (max > 0 && action.value.length > max) return { ok: false, error: "Value exceeds the field length limit" };
      if (field.inputType === "email" && !EMAIL_RE.test(action.value)) return { ok: false, error: "Value is not an email" };
      if (field.inputType === "number" && Number.isNaN(Number(action.value))) return { ok: false, error: "Value is not a number" };
      if (field.inputType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(action.value)) {
        return { ok: false, error: "Value is not a valid date for this control" };
      }
      break;
    }
    case "select_option": {
      if (field.control !== "select") return { ok: false, error: "Not a select control" };
      if (!field.options.some((o) => o.value === action.optionValue)) return { ok: false, error: "Option does not exist" };
      break;
    }
    case "select_radio": {
      if (field.control !== "radio") return { ok: false, error: "Not a radio group" };
      if (!field.options.some((o) => o.value === action.optionValue)) return { ok: false, error: "Option does not exist" };
      break;
    }
    case "set_checkbox": {
      if (field.control !== "checkbox") return { ok: false, error: "Not a checkbox" };
      break;
    }
    case "select_custom_option": {
      if (field.control !== "combobox") return { ok: false, error: "Not a custom dropdown" };
      const g = mayClick(el);
      if (!g.ok) return { ok: false, error: g.reason };
      const want = action.optionLabel.trim().toLowerCase();
      // Options that are already in the DOM can be checked up front; dynamic ones are checked when opened.
      if (field.options.length > 0 && !field.options.some((o) => o.label.trim().toLowerCase() === want)) {
        return { ok: false, error: "Option does not exist" };
      }
      break;
    }
    case "fill_autocomplete": {
      if (field.control !== "text" || field.widget !== "combobox") return { ok: false, error: "Not an autocomplete" };
      if (action.query.trim() === "" || action.optionLabel.trim() === "") return { ok: false, error: "Empty query" };
      break;
    }
  }
  return { ok: true, field, els };
}

/** Runs one validated action. Never evaluates page- or model-supplied code; only calls fixed DOM helpers. */
export async function executeAction(raw: unknown, ctx: ExecContext): Promise<ExecutionResult> {
  const fieldId = typeof raw === "object" && raw && "fieldId" in raw ? String((raw as { fieldId: unknown }).fieldId) : "";
  if (ctx.isCancelled()) return { fieldId, executed: false, error: "Cancelled" };

  const v = validateAction(raw, ctx);
  if (!v.ok) return { fieldId, executed: false, error: v.error };
  const action = AgentActionSchema.parse(raw) as Extract<AgentAction, { fieldId: string }>;

  try {
    const el = v.els[0]!;
    switch (action.type) {
      case "fill_text":
        typeInto(el as HTMLInputElement | HTMLTextAreaElement, action.value);
        break;
      case "select_option":
        typeInto(el as HTMLSelectElement, action.optionValue);
        break;
      case "select_radio": {
        const radio = (v.els as HTMLInputElement[]).find((r) => r.value === action.optionValue);
        if (!radio) return { fieldId, executed: false, error: "Option does not exist" };
        clickToggle(radio, true);
        break;
      }
      case "set_checkbox":
        clickToggle(el as HTMLInputElement, action.checked);
        break;
      case "select_custom_option":
        await selectCustomOption(el, action.optionLabel);
        break;
      case "fill_autocomplete":
        await fillAutocomplete(el as HTMLInputElement, action.query, action.optionLabel);
        break;
      default:
        return { fieldId, executed: false, error: "Unsupported action" };
    }
    await settle();
    return { fieldId, executed: true, error: null };
  } catch (e) {
    return { fieldId, executed: false, error: (e instanceof Error ? e.message : "Execution error").slice(0, 200) };
  }
}
