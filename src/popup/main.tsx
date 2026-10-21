import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  sendValidated,
  type BackgroundRequest,
  type BackgroundResponse,
} from "@/shared/messages";
import { RUNS_STORAGE_KEY, type RunRecord } from "@/shared/run";
import { STATE_LABELS, isWorking } from "@/shared/state-machine";
import { PROFILE_STORAGE_KEY, loadProfile } from "@/shared/storage";
import "./popup.css";

const send = (req: BackgroundRequest): Promise<BackgroundResponse> =>
  sendValidated((m) => chrome.runtime.sendMessage(m), BackgroundRequestSchema, BackgroundResponseSchema, req);

/** `?targetTabId=` lets automated tests open this page in its own tab and still point it at a page tab. */
async function resolveTabId(): Promise<number | null> {
  const param = new URLSearchParams(location.search).get("targetTabId");
  if (param && /^\d+$/.test(param)) return Number(param);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "Unknown";
  } catch {
    return "Unknown";
  }
}

function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id: number) => {
    const r = await send({ kind: "GET_RUN", tabId: id });
    if (r.ok) setRun(r.run);
  }, []);

  useEffect(() => {
    void resolveTabId().then((id) => {
      setTabId(id);
      if (id !== null) void refresh(id);
    });
    void loadProfile().then((p) => setProfileReady(p !== null));
  }, [refresh]);

  useEffect(() => {
    if (tabId === null) return;
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (RUNS_STORAGE_KEY in changes) void refresh(tabId);
      if (PROFILE_STORAGE_KEY in changes) void loadProfile().then((p) => setProfileReady(p !== null));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [tabId, refresh]);

  const working = run ? isWorking(run.state) : false;

  const act = async (kind: "START_RUN" | "STOP_RUN") => {
    if (tabId === null) return;
    setError(null);
    const r = await send({ kind, tabId });
    if (r.ok) setRun(r.run);
    else setError(r.message);
  };

  const rep = run?.report;
  return (
    <main className="popup">
      <h1>ApplyPilot AI</h1>
      <dl>
        <dt>Site</dt>
        <dd data-testid="site">{run ? hostOf(run.url) : "Unknown"}</dd>
        <dt>Company / Role</dt>
        <dd>Unknown</dd>
        <dt>Profile</dt>
        <dd data-testid="profile-status">{profileReady === null ? "..." : profileReady ? "Ready" : "Not set up"}</dd>
        <dt>AI</dt>
        <dd>Off (rules only)</dd>
      </dl>

      <div className="buttons">
        <button data-testid="quick-apply" className="primary" disabled={working || tabId === null} onClick={() => void act("START_RUN")}>
          Quick Apply
        </button>
        <button data-testid="stop" disabled={!working} onClick={() => void act("STOP_RUN")}>
          Stop
        </button>
      </div>

      <section aria-live="polite">
        <p data-testid="status" data-state={run?.state ?? "IDLE"} className="status">
          {run ? STATE_LABELS[run.state] : STATE_LABELS.IDLE}
        </p>
        {run?.fieldsDiscovered !== null && run?.fieldsDiscovered !== undefined && (
          <p data-testid="discovered">Fields found: {run.fieldsDiscovered}</p>
        )}
        {run?.reason && <p data-testid="reason">{run.reason}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </section>

      {rep && (
        <section data-testid="report" className="report">
          <h2>Application prepared</h2>
          <ul>
            <li>Fields filled: {rep.filled}</li>
            <li>Fields verified: {rep.verified}</li>
            <li>Failed: {rep.failed}</li>
            <li>Sensitive, left for you: {rep.skippedSensitive}</li>
            <li>Ambiguous: {rep.ambiguous}</li>
            <li>Unresolved: {rep.unresolved}</li>
            <li>Required but unresolved: {rep.requiredUnresolved}</li>
          </ul>
          <p className="note">Nothing has been submitted. Review the form and submit it yourself.</p>
        </section>
      )}

      <footer>
        <a href="#" onClick={(e) => { e.preventDefault(); void chrome.runtime.openOptionsPage(); }}>Profile &amp; settings</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
