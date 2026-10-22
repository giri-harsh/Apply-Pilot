import {
  ContentRequestSchema,
  ContentResponseSchema,
  handleValidated,
  type ContentRequest,
  type ContentResponse,
  type ExecutionResult,
  type VerificationResult,
} from "@/shared/messages";
import type { FormField } from "@/shared/form";
import { extractJob } from "@/job/extract";
import { executeAction, type ExecContext } from "./actions/executor";
import { fullClick } from "./actions/custom";
import { detectBlockers } from "./blockers";
import { isCancelled, setCancelled } from "./cancel";
import { mapAiMappings, mapFields } from "./mapping/map";
import { classifyControls, pickNext } from "./navigation/classify";
import { observeForm, type ObservedForm } from "./observer/observe";
import { waitForStable } from "./stability";
import { handleUpload } from "./upload";
import { verifyFill } from "./verification/verify";

/**
 * Content-script entry. Thin on purpose: it only routes validated messages to the observation, mapping, action,
 * navigation and verification modules. The page is untrusted; nothing it says is executed.
 */

type Guarded = typeof globalThis & { __applypilotLoaded?: boolean };
const g = globalThis as Guarded;

let observed: ObservedForm | null = null;
let controls: Map<string, HTMLElement> = new Map();

function ctx(): ExecContext {
  const o = observed ?? { fields: [] as FormField[], targets: new Map() };
  return { fields: new Map(o.fields.map((f) => [f.fieldId, f])), targets: o.targets, isCancelled };
}

/** What the user could interact with right now: visible field fingerprints, the page and the first headings. */
function signatureOf(fields: FormField[]): string {
  const heads = Array.from(document.querySelectorAll("h1,h2")).slice(0, 3).map((h) => h.textContent?.trim() ?? "");
  return [location.href, ...fields.filter((f) => f.visible).map((f) => f.fingerprint).sort(), ...heads].join("\n");
}

async function handle(req: ContentRequest): Promise<ContentResponse> {
  switch (req.kind) {
    case "PING":
      return { ok: true, kind: "PONG" };
    case "OBSERVE":
      setCancelled(false);
      observed = observeForm(document);
      return { ok: true, kind: "OBSERVED", url: location.href, pageTitle: document.title, fields: observed.fields };
    case "EXTRACT_JOB":
      return { ok: true, kind: "JOB_EXTRACTED", job: extractJob(document, location.href, { maxChars: req.maxChars }) };
    case "MAP": {
      if (!observed) return { ok: false, code: "NO_RUN", message: "Observe before mapping" };
      const { plan, skipped } = mapFields(observed.fields, req.profile);
      return { ok: true, kind: "MAPPED", plan, skipped };
    }
    case "MAP_AI": {
      if (!observed) return { ok: false, code: "NO_RUN", message: "Observe before mapping" };
      const { plan, skipped } = mapAiMappings(observed.fields, req.mappings, req.profile);
      return { ok: true, kind: "MAPPED", plan, skipped };
    }
    case "EXECUTE": {
      if (!observed) return { ok: false, code: "NO_RUN", message: "Observe before executing" };
      // SPEC 11.4: if the page changed since planning, execute nothing and ask for a re-plan.
      const now = signatureOf(observeForm(document).fields);
      if (now !== signatureOf(observed.fields)) {
        return {
          ok: true,
          kind: "EXECUTED",
          replan: true,
          results: req.plan.map((p): ExecutionResult => ({ fieldId: p.fieldId, executed: false, error: "Page changed since planning" })),
        };
      }
      const c = ctx();
      const results: ExecutionResult[] = [];
      for (const item of req.plan) {
        results.push(await executeAction(item.action, c, item.strategy ?? "default"));
        if (isCancelled()) break;
      }
      return { ok: true, kind: "EXECUTED", results, replan: false };
    }
    case "VERIFY": {
      const c = ctx();
      const results: VerificationResult[] = [];
      for (const item of req.plan) {
        results.push(await verifyFill(item, c.fields.get(item.fieldId), c.targets.get(item.fieldId)));
      }
      return { ok: true, kind: "VERIFIED", results };
    }
    case "WAIT_STABLE": {
      const r = await waitForStable(document, req.quietMs, req.maxMs);
      return { ok: true, kind: "STABLE", ...r };
    }
    case "CLASSIFY_CONTROLS": {
      const { report, elements } = classifyControls(document);
      controls = elements;
      return { ok: true, kind: "CONTROLS", ...report, next: pickNext(report) };
    }
    case "DETECT_BLOCKERS": {
      const r = detectBlockers(document);
      return { ok: true, kind: "BLOCKERS", blockers: r.blockers, frames: r.frames };
    }
    case "NAVIGATE": {
      const el = controls.get(req.controlId);
      if (!el || !el.isConnected) return { ok: true, kind: "NAVIGATED", clicked: false, changed: false, reason: "The control is no longer on the page" };
      // Re-classify at execution time: the page may have changed since the harness looked.
      const fresh = classifyControls(document);
      const next = pickNext(fresh.report);
      if (!next || fresh.elements.get(next.id) !== el || next.text !== req.text) {
        return { ok: true, kind: "NAVIGATED", clicked: false, changed: false, reason: "The control is no longer a safe next-step control" };
      }
      if (isCancelled()) return { ok: true, kind: "NAVIGATED", clicked: false, changed: false, reason: "Cancelled" };
      const before = signatureOf(observeForm(document).fields);
      fullClick(el);
      await waitForStable(document, 200, 2500);
      return { ok: true, kind: "NAVIGATED", clicked: true, changed: before !== signatureOf(observeForm(document).fields), reason: "" };
    }
    case "CANCEL":
      setCancelled(true);
      return { ok: true, kind: "CANCELLED" };
    case "UPLOAD_LIST":
    case "UPLOAD_BEGIN":
    case "UPLOAD_CHUNK":
    case "UPLOAD_COMMIT":
    case "UPLOAD_ABORT": {
      if (!observed) return { ok: false, code: "NO_RUN", message: "Observe before uploading" };
      const obs = observed;
      return handleUpload(req, { doc: document, fields: obs.fields, elementsFor: (id) => obs.targets.get(id) });
    }
  }
}

if (!g.__applypilotLoaded) {
  g.__applypilotLoaded = true;
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, code: "UNTRUSTED_SENDER", message: "Rejected sender" });
      return false;
    }
    void handleValidated(raw, ContentRequestSchema, ContentResponseSchema, handle).then(sendResponse);
    return true; // async response
  });
}
