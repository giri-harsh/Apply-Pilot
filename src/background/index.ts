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

const manager = new RunManager({
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
      const r = await manager.start(req.tabId);
      return r.ok ? { ok: true, run: r.run } : r;
    }
    case "STOP_RUN": {
      const r = await manager.stop(req.tabId);
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
  void handleValidated(raw, BackgroundRequestSchema, BackgroundResponseSchema, handle).then(sendResponse);
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void manager.stop(tabId);
});
