import type { PortalAdapter } from "./types";

/**
 * The synthetic "FakeATS" portal family (2-3 pages with stable data-automation-id attributes). It exists to prove the
 * adapter path end to end in tests; it is NOT a real portal. Real adapters come from real captures (Phase 8).
 */
export const FAKEATS: PortalAdapter = {
  id: "fakeats",
  version: 1,
  name: "FakeATS (synthetic)",
  hosts: [{ kind: "exact", host: "fakeats.test" }, { kind: "subdomains", domain: "fakeats.test", labels: ["jobs", "careers"] }],
  allowHttp: true, // the synthetic portal is served over http on a dynamic port
  recognition: [
    { kind: "meta", name: "generator", pattern: "^FakeATS" },
    { kind: "selector", selector: "form[data-automation-id='fakeatsApplication']" },
  ],
  assumptions: [{ kind: "selector", selector: "[data-automation-id='fakeatsApplication'] [data-automation-id]", min: 2 }],
  capabilities: { multiStep: true, upload: false, customDropdowns: false },
  strategies: {
    fieldHints: [
      { selector: "[data-automation-id='legalName.first']", semanticType: "first_name", confidence: 0.9 },
      { selector: "[data-automation-id='legalName.last']", semanticType: "last_name", confidence: 0.9 },
      { selector: "[data-automation-id='contact.email']", semanticType: "email", confidence: 0.9 },
      { selector: "[data-automation-id='contact.phone']", semanticType: "phone", confidence: 0.9 },
      { selector: "[data-automation-id='address.city']", semanticType: "city", confidence: 0.9 },
      { selector: "[data-automation-id='address.country']", semanticType: "country", confidence: 0.9 },
      // A deliberately WRONG hint for a sensitive question: the router must never let a hint override the risk policy.
      { selector: "[data-automation-id='eeo.gender']", semanticType: "full_name", confidence: 0.9 },
    ],
    nextHints: [{ selector: "[data-automation-id='bottom-navigation-next-button']" }],
  },
  limitations: ["Synthetic family for tests only", "No upload, no custom dropdowns"],
};
