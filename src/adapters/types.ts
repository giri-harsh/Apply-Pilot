import type { SemanticType } from "@/shared/form";

/**
 * SPEC 10.1-10.3 / 23 PortalAdapter. An adapter is local, versioned DATA about one portal family. It can only ADD evidence:
 * it never bypasses the risk policy, the validator or the final-control guard, and it never widens what may be clicked.
 */

/** A hostname rule. Exact hosts, or a registrable domain with an explicit list of allowed subdomain labels. Never a wildcard. */
export type HostRule =
  | { kind: "exact"; host: string }
  | { kind: "subdomains"; domain: string; labels: string[] };

/** A page signal the live DOM must show. All of an adapter's recognition signals must hold (a host match alone is never enough). */
export type PageSignal =
  | { kind: "selector"; selector: string; min?: number }
  | { kind: "meta"; name: string; pattern: string }
  | { kind: "scriptHost"; host: string };

export type FieldHint = {
  /** CSS selector for the control on this portal (typically a stable data-automation-id). */
  selector: string;
  semanticType: SemanticType;
  /** 0..1, capped by the router at 0.92: a hint is evidence, not certainty. */
  confidence: number;
};

export type PortalAdapter = {
  id: string;
  version: number;
  name: string;
  /** Strict hostname patterns. Protocol must be https unless `allowHttp` (synthetic test portals only). */
  hosts: HostRule[];
  allowHttp?: boolean;
  /** Page signals that must all be present for the adapter to be recognised. */
  recognition: PageSignal[];
  /** Structural assumptions the strategies rely on; they are re-validated on the live page, and any failure means the general path. */
  assumptions: PageSignal[];
  capabilities: { multiStep: boolean; upload: boolean; customDropdowns: boolean };
  strategies: {
    fieldHints: FieldHint[];
    /** A control matching one of these may be treated as "next" ONLY when the general classifier could not tell what it is. */
    nextHints: { selector: string }[];
    /** Declared for real adapters (Phase 8); not consumed yet. */
    uploadHints?: { selector: string; role: "resume" | "cover_letter" }[];
    dropdownHints?: { selector: string; kind: "listbox" | "autocomplete" }[];
  };
  limitations: string[];
};

export type RouteDecision =
  | { path: "adapter"; adapterId: string; adapterVersion: number; reason: string }
  | { path: "general"; adapterId: null; adapterVersion: null; reason: string };
