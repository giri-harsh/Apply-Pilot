import type { KVStore } from "@/ai/storage";
import type { FormField } from "@/shared/form";

export function memoryStore(initial: Record<string, unknown> = {}): KVStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    get: async (k) => (k in data ? { [k]: structuredClone(data[k]) } : {}),
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    remove: async (k) => {
      delete data[k];
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function field(over: Partial<FormField> = {}): FormField {
  return {
    fieldId: "field_001", tagName: "input", inputType: "text", control: "text", label: "How can recruiters reach you electronically?",
    labelSource: "explicit_label", signals: [{ source: "explicit_label", text: "How can recruiters reach you electronically?" }],
    name: "contact1", elementId: "", autocomplete: "", placeholder: null, ariaLabel: null, required: false, visible: true, enabled: true,
    options: [], currentValue: "", sectionContext: "Contact", semanticCandidates: ["unknown"], semanticType: "unknown", confidence: 0,
    ambiguous: false, ambiguityReason: null, risk: "moderate", fingerprint: "fp", widget: "native", limit: null, invalid: false, ...over,
  };
}

export function mappingItem(over: Record<string, unknown> = {}) {
  return {
    fieldId: "field_001", semanticType: "email", profileKey: "personal.email", confidence: 0.92,
    evidence: ["label asks how to be reached electronically"], requiresReview: false, ...over,
  };
}
