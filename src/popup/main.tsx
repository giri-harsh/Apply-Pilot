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
import type { AiStatus } from "@/shared/messages";
import type { JobSummary } from "@/job/schema";
import { STATE_LABELS, isWorking } from "@/shared/state-machine";
import { PROFILE_STORAGE_KEY, loadProfile } from "@/shared/storage";
import { loadVariantOptions, type VariantOption } from "./variants";
import { chooseGrantOrigin, originLabel, permissionRequest } from "@/shared/origin";
import "./popup.css";

/** "Prepared" and "uploaded" are different facts: the headline says uploaded only after the page recognised the file. */
function resumeStatusText(r: RunRecord["resume"]): string {
  switch (r.status) {
    case "tailored":
      return r.uploadVerified ? "Tailored resume uploaded" : "Tailored resume prepared, not uploaded";
    case "reused":
      return r.uploadVerified ? "Saved resume uploaded" : "Saved resume found, not uploaded";
    case "off":
      return "Resume tailoring is off";
    case "none":
      return "No resume available";
    case "failed":
      return "Resume could not be prepared";
    default:
      return "";
  }
}

const STEP_OUTCOME = {
  advanced: "moved on",
  stopped: "stopped here",
  final: "final step, left for you",
  blocked: "blocked",
} as const;

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

function aiLabel(s: AiStatus | null): string {
  if (!s) return "...";
  if (s.mode === "off") return "Off (rules only)";
  if (s.mode === "not_configured") return "AI: not configured";
  const first = s.providerOrder.find((p) => s.keys[p]?.configured);
  return first ? (first === "gemini" ? "Gemini" : "Groq") + " ready" : "AI: not configured";
}

function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [preview, setPreview] = useState<JobSummary | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const refresh = useCallback(async (id: number) => {
    const r = await send({ kind: "GET_RUN", tabId: id });
    if (r.ok && "run" in r) setRun(r.run);
  }, []);

  const refreshAi = useCallback(async () => {
    const r = await send({ kind: "AI_GET_STATUS" });
    if (r.ok && "kind" in r && r.kind === "ai_status") setAiStatus(r.status);
  }, []);

  useEffect(() => {
    void resolveTabId().then((id) => {
      setTabId(id);
      if (id !== null) void refresh(id);
    });
    void loadProfile().then((p) => setProfileReady(p !== null));
    void refreshAi();
  }, [refresh, refreshAi]);

  // Read the job on the page as soon as the popup opens (read-only; nothing is filled).
  useEffect(() => {
    if (tabId === null) return;
    void send({ kind: "PREVIEW_JOB", tabId }).then((r) => {
      if (r.ok && "kind" in r && r.kind === "job_preview") setPreview(r.job);
    });
  }, [tabId]);

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

  // Heartbeat while a run is active: each GET_RUN also wakes a service worker that was terminated mid-run,
  // which then rehydrates and continues the run.
  useEffect(() => {
    if (tabId === null || !working) return;
    const t = setInterval(() => void refresh(tabId), 1500);
    return () => clearInterval(t);
  }, [tabId, working, refresh]);

  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantChoice, setVariantChoice] = useState<string>("");
  useEffect(() => {
    void loadVariantOptions().then(setVariants);
  }, []);

  const act = async (kind: "START_RUN" | "STOP_RUN") => {
    if (tabId === null) return;
    setError(null);
    const r = await send(kind === "START_RUN" ? { kind, tabId, variantId: variantChoice || null } : { kind, tabId });
    if (r.ok && "run" in r) setRun(r.run);
    else if (!r.ok) setError(r.message);
  };

  // Portal capture: a redacted structural snapshot of this page, stored locally (Options > Diagnostics). Click only.
  const [captureNote, setCaptureNote] = useState("");
  const capture = async () => {
    if (tabId === null) return;
    setCaptureNote("Capturing...");
    const r = await send({ kind: "CAPTURE_PAGE", tabId });
    setCaptureNote(r.ok && "kind" in r && r.kind === "captured" ? `Captured ${r.fields} fields and ${r.controls} buttons. Find it in Settings > Diagnostics.` : !r.ok && "message" in r ? r.message : "Capture failed");
  };

  // Per-origin site access (SPEC 20.1): requested only from this click, for exactly one origin, never a wildcard.
  const allowSite = async () => {
    if (tabId === null || !run) return;
    setError(null);
    let tabUrl: string | undefined;
    try {
      tabUrl = (await chrome.tabs.get(tabId)).url;
    } catch {
      tabUrl = undefined;
    }
    const pattern = chooseGrantOrigin(run.permissionOrigin, tabUrl, new URLSearchParams(location.search).get("grantOrigin"));
    const req = pattern ? permissionRequest(pattern.replace(/\/\*$/, "/")) : null;
    if (!req) {
      setError("Could not tell which site to allow. Open this popup on the page itself.");
      return;
    }
    let granted: boolean;
    try {
      granted = await chrome.permissions.request(req);
    } catch {
      granted = false;
    }
    if (!granted) {
      setError("Access was not granted, so the run stays stopped.");
      return;
    }
    const r = await send({ kind: "RESUME_AFTER_GRANT", tabId });
    if (r.ok && "run" in r) setRun(r.run);
    else if (!r.ok) setError(r.message);
  };

  // SPEC 19.3: saved only when the user clicks; never automatic.
  const saveAnswer = async (fieldId: string) => {
    if (tabId === null) return;
    const r = await send({ kind: "SAVE_ANSWER", tabId, fieldId });
    if (r.ok) setSaved((s) => new Set(s).add(fieldId));
    else if ("message" in r) setError(r.message);
  };

  const job = run?.job ?? preview;
  const rep = run?.report;
  return (
    <main className="popup">
      <h1>ApplyPilot AI</h1>
      <dl>
        <dt>Site</dt>
        <dd data-testid="site">{run ? hostOf(run.url) : "Unknown"}</dd>
        <dt>Company</dt>
        <dd data-testid="company">{job?.company ?? "Unknown"}</dd>
        <dt>Role</dt>
        <dd data-testid="role">{job?.title ?? "Unknown"}</dd>
        {job?.matchScore !== null && job?.matchScore !== undefined && (
          <>
            <dt>Match</dt>
            <dd data-testid="match" title="Skill overlap with your profile. A decision aid, not a hiring prediction.">{job.matchScore}/100 (decision aid)</dd>
          </>
        )}
        <dt>Profile</dt>
        <dd data-testid="profile-status">{profileReady === null ? "..." : profileReady ? "Ready" : "Not set up"}</dd>
        <dt>AI</dt>
        <dd data-testid="ai-status">{aiLabel(aiStatus)}</dd>
      </dl>

      {variants.length > 0 && (
        <div className="field">
          <label htmlFor="variant-select">Resume variant</label>
          <select id="variant-select" data-testid="variant-select" value={variantChoice} disabled={working} onChange={(e) => setVariantChoice(e.target.value)}>
            <option value="">Automatic (from the job)</option>
            {variants.map((v) => (
              <option key={v.variantId} value={v.variantId}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="buttons">
        <button data-testid="quick-apply" className="primary" disabled={working || tabId === null} onClick={() => void act("START_RUN")}>
          Quick Apply
        </button>
        <button data-testid="stop" disabled={!working} onClick={() => void act("STOP_RUN")}>
          Stop
        </button>
      </div>

      <div className="buttons">
        <button data-testid="capture-page" disabled={tabId === null} onClick={() => void capture()}>
          Capture this page for adapter work
        </button>
      </div>
      {captureNote && <p className="note" data-testid="capture-note" role="status">{captureNote}</p>}

      <section aria-live="polite">
        <p data-testid="status" data-state={run?.state ?? "IDLE"} className="status">
          {run ? STATE_LABELS[run.state] : STATE_LABELS.IDLE}
        </p>
        {run?.fieldsDiscovered !== null && run?.fieldsDiscovered !== undefined && (
          <p data-testid="discovered">Fields found: {run.fieldsDiscovered}</p>
        )}
        {run?.route && (
          <p data-testid="route" data-path={run.route.path} className="note">
            {run.route.path === "adapter" ? `Portal adapter: ${run.route.adapterId} v${run.route.adapterVersion}` : "General agent (no portal adapter)"}
          </p>
        )}
        {run?.reason && <p data-testid="reason">{run.reason}</p>}
        {run?.state === "BLOCKED" && run.needsPermission && (
          <div>
            <button data-testid="allow-site" className="primary" onClick={() => void allowSite()}>
              Allow ApplyPilot on {run.permissionOrigin ? originLabel(run.permissionOrigin) : "this site"}
            </button>
            <p className="note">Chrome will ask you to confirm. Access is for this one site and can be revoked in Settings.</p>
          </div>
        )}
        {job && job.warnings.length > 0 && (
          <p data-testid="job-warnings" className="note">
            Job detection notes: {job.warnings.slice(0, 2).join("; ")}
          </p>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </section>

      {run && (run.steps.length > 0 || working) && (
        <section data-testid="steps" className="report">
          <h2>Steps</h2>
          <ol>
            {(rep?.steps ?? run.steps).map((s) => (
              <li key={s.index} data-testid={`step-${s.index}`} data-outcome={s.outcome}>
                Step {s.index + 1}{s.title ? `: ${s.title}` : ""}: {s.verified} verified, {s.failed} failed
                {s.requiredUnresolved > 0 ? `, ${s.requiredUnresolved} required unresolved` : ""}
                {" "}({STEP_OUTCOME[s.outcome]}{s.advancedBy ? ` via "${s.advancedBy}"` : ""})
              </li>
            ))}
            {working && <li data-testid="step-current">Working on step {run.steps.length + 1}...</li>}
          </ol>
          <p className="note">
            Actions: {run.counters.actions}, retries: {run.counters.retries}, passes: {run.counters.passes}, step changes: {run.counters.transitions}
          </p>
        </section>
      )}

      {run && run.resume.status !== "not_needed" && (
        <section data-testid="resume-info" className="report">
          <h2>Resume</h2>
          <p data-testid="resume-status" data-status={run.resume.status}>
            {resumeStatusText(run.resume)}
            {run.resume.filename ? `: ${run.resume.filename}` : ""}
            {run.resume.pageCount !== null ? ` (${run.resume.pageCount} page${run.resume.pageCount === 1 ? "" : "s"})` : ""}
          </p>
          {run.resume.variantId && (
            <p className="note" data-testid="resume-variant">
              Variant: {variants.find((v) => v.variantId === run.resume.variantId)?.name ?? run.resume.variantId} ({run.resume.variantAuto ? "chosen automatically" : "your choice"})
            </p>
          )}
          {run.resume.warnings.length > 0 && (
            <ul data-testid="resume-warnings" className="note">
              {run.resume.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rep && (
        <section data-testid="report" className="report">
          <h2>Application prepared</h2>
          <ul>
            <li>Fields filled: {rep.filled}</li>
            <li>Fields verified: {rep.verified}</li>
            <li>Failed: {rep.failed}</li>
            <li>AI-mapped: {rep.aiMapped}</li>
            <li>AI-written, review: {rep.aiWritten}</li>
            <li>Sensitive, left for you: {rep.skippedSensitive}</li>
            <li>Ambiguous: {rep.ambiguous}</li>
            <li>Unresolved: {rep.unresolved}</li>
            <li>Required but unresolved: {rep.requiredUnresolved}</li>
          </ul>
          <p className="note">Nothing has been submitted. Review the form and submit it yourself.</p>
        </section>
      )}

      {run && run.answers.length > 0 && (
        <section data-testid="answers" className="report">
          <h2>AI-written answers: review before submitting</h2>
          {run.answers.map((a) => {
            const result = rep?.results.find((r) => r.fieldId === a.fieldId);
            return (
              <article key={a.fieldId} data-testid={`answer-${a.fieldId}`} className="answer">
                <h3>{a.label}</h3>
                <p>{a.text}</p>
                <p className="note">
                  Evidence used: {a.evidence.join("; ") || "none"} ({a.source}){result ? `, ${result.outcome === "filled_verified" ? "inserted and verified" : "not inserted"}` : ""}
                </p>
                <button
                  data-testid={`save-answer-${a.fieldId}`}
                  disabled={saved.has(a.fieldId)}
                  onClick={() => void saveAnswer(a.fieldId)}
                >
                  {saved.has(a.fieldId) ? "Saved for reuse" : "Save as reusable answer"}
                </button>
              </article>
            );
          })}
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
