import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  ContentRequestSchema,
  ContentResponseSchema,
  handleValidated,
  sendValidated,
  type BackgroundRequest,
  type BackgroundResponse,
} from "@/shared/messages";
import { chromeStore } from "@/ai/storage";
import { loadProfile, loadRuns, saveRuns } from "@/shared/storage";
import { AiService } from "./ai-service";
import { RunManager } from "./run-manager";

// Keep API keys, settings and caches out of reach of content scripts (they run in web pages' processes).
void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);

const ai = new AiService({ store: chromeStore(), fetchImpl: (url, init) => fetch(url, init) });

const manager = new RunManager({
  loadRuns,
  saveRuns,
  loadProfile,
  classifyAi: (input) => ai.classify(input),
  async injectContent(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  },
  sendToTab: (tabId, req) =>
    sendValidated(
      (m) => chrome.tabs.sendMessage(tabId, m),
      ContentRequestSchema,
      ContentResponseSchema,
      req,
    ),
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
      const r = await ai.setSettings(req.aiEnabled, req.providerOrder);
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
    case "AI_CLEAR_CACHE":
      await ai.clearCache();
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
