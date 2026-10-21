import {
  ContentRequestSchema,
  ContentResponseSchema,
  handleValidated,
  type ContentRequest,
  type ContentResponse,
} from "@/shared/messages";
import type { FormField } from "@/shared/form";
import { executeAction, type ExecContext } from "./actions/executor";
import { mapAiMappings, mapFields } from "./mapping/map";
import { extractJob } from "@/job/extract";
import { observeForm, type ObservedForm } from "./observer/observe";
import { verifyFill } from "./verification/verify";

/**
 * Content-script entry. Thin on purpose: it only routes validated messages to the observation,
 * mapping, action and verification modules. The page is untrusted; nothing it says is executed.
 */

type Guarded = typeof globalThis & { __applypilotLoaded?: boolean };
const g = globalThis as Guarded;

let observed: ObservedForm | null = null;
let cancelled = false;

function ctx(): ExecContext {
  const o = observed ?? { fields: [] as FormField[], targets: new Map() };
  return {
    fields: new Map(o.fields.map((f) => [f.fieldId, f])),
    targets: o.targets,
    isCancelled: () => cancelled,
  };
}

async function handle(req: ContentRequest): Promise<ContentResponse> {
  switch (req.kind) {
    case "PING":
      return { ok: true, kind: "PONG" };
    case "OBSERVE":
      cancelled = false;
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
      const c = ctx();
      const results = [];
      for (const item of req.plan) {
        results.push(await executeAction(item.action, c));
        if (cancelled) break;
      }
      return { ok: true, kind: "EXECUTED", results };
    }
    case "VERIFY": {
      const c = ctx();
      const results = [];
      for (const item of req.plan) {
        results.push(await verifyFill(item, c.fields.get(item.fieldId), c.targets.get(item.fieldId)));
      }
      return { ok: true, kind: "VERIFIED", results };
    }
    case "CANCEL":
      cancelled = true;
      return { ok: true, kind: "CANCELLED" };
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
