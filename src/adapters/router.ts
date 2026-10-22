import type { FormField, SemanticType } from "@/shared/form";
import { SENSITIVE_TYPES } from "@/shared/form";
import { adapterMatchesHost, signalHolds } from "./match";
import { ADAPTERS } from "./registry";
import type { PortalAdapter, RouteDecision } from "./types";

export type Routed = { decision: RouteDecision; adapter: PortalAdapter | null };

const general = (reason: string): Routed => ({ decision: { path: "general", adapterId: null, adapterVersion: null, reason }, adapter: null });

/**
 * SPEC 10.1: adapter path only when the adapter's hostname rule matches AND every recognition signal is on the page AND
 * the adapter's structural assumptions still hold on the live page. Anything else is the general agent, with the reason.
 */
export function routePage(doc: Document, url: string, adapters: readonly PortalAdapter[] = ADAPTERS): Routed {
  const byHost = adapters.filter((a) => adapterMatchesHost(a, url));
  if (byHost.length === 0) return general("No adapter matches this host");
  const reasons: string[] = [];
  for (const a of byHost) {
    const missing = a.recognition.find((s) => !signalHolds(doc, s));
    if (missing) {
      reasons.push(`${a.id}: host matches but the page does not look like it (${missing.kind})`);
      continue;
    }
    const broken = a.assumptions.find((s) => !signalHolds(doc, s));
    if (broken) {
      reasons.push(`${a.id}: recognised, but its structural assumptions no longer hold`);
      continue;
    }
    return { decision: { path: "adapter", adapterId: a.id, adapterVersion: a.version, reason: `${a.id} v${a.version}: host, page signals and structure all match` }, adapter: a };
  }
  return general(reasons.join("; "));
}

const NEVER_OVERRIDDEN: SemanticType[] = [...SENSITIVE_TYPES, "consent", "third_party_contact"];

/**
 * A hint is evidence only. It may supply a type where the general classifier found none (or was unsure), capped at 0.92,
 * and it can never turn a sensitive, consent or third-party field into something fillable, nor override a confident
 * general classification that disagrees. The result still goes through the normal mapper, risk policy and verifier.
 */
export function applyFieldHint(base: { semanticType: SemanticType; confidence: number; ambiguous: boolean }, hint: { semanticType: SemanticType; confidence: number }): { use: boolean; semanticType: SemanticType; confidence: number } {
  if (NEVER_OVERRIDDEN.includes(base.semanticType)) return { use: false, semanticType: base.semanticType, confidence: base.confidence };
  if (NEVER_OVERRIDDEN.includes(hint.semanticType)) return { use: false, semanticType: base.semanticType, confidence: base.confidence };
  const unsure = base.semanticType === "unknown" || base.ambiguous || base.confidence < 0.6;
  if (!unsure && base.semanticType !== hint.semanticType) return { use: false, semanticType: base.semanticType, confidence: base.confidence };
  return { use: true, semanticType: hint.semanticType, confidence: Math.min(0.92, hint.confidence) };
}

export function hintForElement(adapter: PortalAdapter | null, el: Element): { semanticType: SemanticType; confidence: number } | null {
  if (!adapter) return null;
  for (const h of adapter.strategies.fieldHints) if (el.matches(h.selector)) return { semanticType: h.semanticType, confidence: h.confidence };
  return null;
}

export type HintedField = Pick<FormField, "semanticType" | "confidence" | "ambiguous">;
