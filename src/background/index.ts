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
import { loadProfile, loadRuns, saveRuns } from "@/shared/storage";
import { RunManager } from "./run-manager";

const manager = new RunManager({
  loadRuns,
  saveRuns,
  loadProfile,
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
