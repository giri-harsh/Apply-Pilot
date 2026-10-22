import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  ContentRequestSchema,
  ContentResponseSchema,
  handleValidated,
  sendValidated,
  type BackgroundRequest,
  type BackgroundResponse,
  type ContentRequest,
} from "@/shared/messages";
import { chromeStore } from "@/ai/storage";
import { loadProfile, loadRuns, saveRuns } from "@/shared/storage";
import { AiService } from "./ai-service";
import { getCachedJob } from "@/job/storage";
import { JobService } from "./job-service";
import { RunManager } from "./run-manager";
import { ResumeService } from "./resume-service";
import { DiagnosticsService } from "./diagnostics-service";
import { createCaptureStore } from "@/diagnostics/store";
import { DIAG_SETTINGS_KEY, DiagSettingsSchema } from "@/diagnostics/schema";
import { chooseFileForField } from "@/content/upload/choose";
import { OffscreenResponseSchema, ShortenRequestSchema } from "@/resume/offscreen-protocol";
import { createResumeStore } from "@/resume/storage";
import { generateCoverLetter, makeShorten, tailor } from "@/resume/tailor";
import { defaultVariants, selectVariant } from "@/resume/variants";
import type { Scheduler } from "./scheduler";

// Keep API keys, settings and caches out of reach of content scripts (they run in web pages' processes).
void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);

const ai = new AiService({
  store: chromeStore(),
  fetchImpl: (url, init) => fetch(url, init),
  loadJob: (url) => getCachedJob(chromeStore(), url),
});

const sendToTab = (tabId: number, req: ContentRequest) =>
  sendValidated((m) => chrome.tabs.sendMessage(tabId, m), ContentRequestSchema, ContentResponseSchema, req);

const jobs = new JobService({
  store: chromeStore(),
  injectContent: async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  },
  sendToTab,
  loadProfile,
  enrich: (job) => ai.enrichJob(job),
});

/**
 * After a click that unloaded the page: resolves true once THIS tab (the active run's tab, never another) has finished
 * loading. A same-URL reload counts too, since a form post often lands on the same address. The wait goes through the
 * run's scheduler, so Stop cancels the listener and the timeout.
 */
function waitForTabLoad(tabId: number, previousUrl: string, timeoutMs: number, scheduler: Scheduler): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    let sawLoading = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) finish(true);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // The load may already have completed before the listener existed.
    void chrome.tabs.get(tabId).then((t) => {
      if (t.status === "loading") sawLoading = true;
      // The new page may have finished loading before this listener existed: a different address that is complete is enough.
      // (Without host access the URL is hidden from us; then only the loading -> complete event can confirm a navigation.)
      else if (t.status === "complete" && t.url !== undefined && t.url !== previousUrl) finish(true);
    }, () => finish(false));
    void scheduler.sleep(timeoutMs).then(() => finish(false), () => finish(false));
  });
}

/** One hidden document does the PDF work (SPEC 7.6); created on demand. */
async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS],
    justification: "Lay out and validate the tailored resume PDF",
  });
}

const resume = new ResumeService({
  store: createResumeStore(),
  loadProfile,
  loadJob: (url) => getCachedJob(chromeStore(), url),
  getAi: () => ai.resumeAi(),
  tailor,
  selectVariant,
  defaultVariants,
  makeShorten,
  coverLetter: generateCoverLetter,
  chooseFile: chooseFileForField,
  sendToTab,
  async build(req) {
    await ensureOffscreen();
    const raw: unknown = await chrome.runtime.sendMessage(req);
    const parsed = OffscreenResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : { ok: false, message: "The document builder did not answer" };
  },
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
});

const diagnostics = new DiagnosticsService({
  store: createCaptureStore(),
  injectContent: async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  },
  sendToTab,
  loadProfile,
  getRun: (tabId) => manager.get(tabId),
  version: chrome.runtime.getManifest().version,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
});

const manager = new RunManager({
  captureStep: async (tabId, stepIndex) => {
    const raw = (await chrome.storage.local.get(DIAG_SETTINGS_KEY))[DIAG_SETTINGS_KEY];
    if (DiagSettingsSchema.parse(raw ?? {}).captureEachStep) await diagnostics.capture(tabId, stepIndex, { inject: false });
  },
  uploadResume: (input) => resume.uploadResume(input),
  getJob: (tabId, url) => jobs.forTab(tabId, url),
  loadRuns,
  saveRuns,
  loadProfile,
  classifyAi: (input) => ai.classify(input),
  answerQuestions: (input) => ai.answerQuestions(input),
  async injectContent(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  },
  sendToTab,
  waitForNavigation: (tabId, previousUrl, timeoutMs, scheduler) => waitForTabLoad(tabId, previousUrl, timeoutMs, scheduler),
  async tabInfo(tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      return { url: t.url ?? "", title: t.title ?? "" };
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
});

// Runs every time the service worker starts: re-observe and continue any interrupted run.
const ready = manager.rehydrate().catch(() => undefined);

async function handle(req: BackgroundRequest): Promise<BackgroundResponse> {
  await ready;
  switch (req.kind) {
    case "START_RUN": {
      const r = await manager.start(req.tabId, { variantId: req.variantId ?? null });
      return r.ok ? { ok: true, run: r.run } : r;
    }
    case "STOP_RUN": {
      const r = await manager.stop(req.tabId);
      return r.ok ? { ok: true, run: r.run } : r;
    }
    case "RESUME_AFTER_GRANT": {
      const r = await manager.resumeAfterGrant(req.tabId);
      return r.ok ? { ok: true, run: r.run } : r;
    }
    case "GET_RUN":
      return { ok: true, run: await manager.get(req.tabId) };
    case "AI_GET_STATUS":
      return { ok: true, kind: "ai_status", status: await ai.status() };
    case "AI_SET_SETTINGS": {
      const r = await ai.setSettings(req.aiEnabled, req.providerOrder, req.jobEnrichment, req.answerMemory);
      return r.ok ? { ok: true, kind: "ack" } : { ok: false, kind: "rejected", message: r.message };
    }
    case "AI_SET_KEY": {
      const r = await ai.setKey(req.provider, req.secret);
      return r.ok ? { ok: true, kind: "ack" } : { ok: false, kind: "rejected", message: r.message };
    }
    case "AI_CLEAR_KEY":
      await ai.clearKey(req.provider);
      return { ok: true, kind: "ack" };
    case "AI_TEST_CONNECTION":
      return { ok: true, kind: "ai_test", result: await ai.testConnection(req.provider) };
    case "CAPTURE_PAGE": {
      try {
        const c = await diagnostics.capture(req.tabId);
        return { ok: true, kind: "captured", captureId: c.captureId, fields: c.fields.length, controls: c.controls.length };
      } catch {
        return { ok: false, kind: "rejected", message: "This page cannot be captured" };
      }
    }
    case "PREVIEW_JOB": {
      try {
        const tab = await chrome.tabs.get(req.tabId);
        const job = await jobs.forTab(req.tabId, tab.url ?? "", { inject: true });
        return { ok: true, kind: "job_preview", job };
      } catch {
        return { ok: false, kind: "rejected", message: "This page cannot be read" };
      }
    }
    case "AI_CLEAR_CACHE":
      await ai.clearCache();
      return { ok: true, kind: "ack" };
    case "SAVE_ANSWER": {
      const run = await manager.get(req.tabId);
      const a = run?.answers.find((x) => x.fieldId === req.fieldId);
      if (!run || !a) return { ok: false, kind: "rejected", message: "No such answer on this run" };
      await ai.saveAnswer({
        category: a.category,
        questionSignature: a.signature,
        questionText: a.label,
        text: a.text,
        evidence: a.evidence,
        job: { company: run.job?.company ?? null, title: run.job?.title ?? null },
      });
      return { ok: true, kind: "ack" };
    }
    case "LIST_ANSWERS":
      return { ok: true, kind: "answers", answers: await ai.listAnswers() };
    case "DELETE_ANSWER":
      await ai.deleteAnswer(req.id);
      return { ok: true, kind: "ack" };
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Only the extension's own pages may drive runs; web pages and other extensions are rejected.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ ok: false, code: "UNTRUSTED_SENDER", message: "Rejected sender" });
    return false;
  }
  // Requests meant for the offscreen document are not ours to answer.
  if ((raw as { target?: string } | null)?.target === "offscreen") return false;
  // The offscreen document asks for shorter resume wording; the service worker owns every AI call.
  if ((raw as { kind?: string } | null)?.kind === "RESUME_SHORTEN") {
    const req = ShortenRequestSchema.safeParse(raw);
    if (!req.success) {
      sendResponse({ ok: true, lines: [] });
      return false;
    }
    void resume.shorten(req.data.sessionId, req.data.lines, req.data.target).then((lines) => sendResponse({ ok: true, lines }));
    return true;
  }
  void handleValidated(raw, BackgroundRequestSchema, BackgroundResponseSchema, handle).then(sendResponse);
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void manager.stop(tabId);
});
