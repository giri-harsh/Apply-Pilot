import { useCallback, useEffect, useMemo, useState } from "react";
import { chromeStore, loadUsage } from "@/ai/storage";
import { HistoryService, type HistoryRecord } from "@/history/history";
import { cacheHitRate, usageByDay, usageByRun, type DayUsage } from "@/history/usage";

const STATE_TEXT: Record<string, string> = {
  READY_FOR_REVIEW: "Ready for your review",
  PARTIALLY_COMPLETED: "Partially completed",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Stopped by you",
};

/** Application history (SPEC 19.1) and AI usage (SPEC 13.4). Stored structure only; nothing typed into a form is in here. */
export function HistoryPanel() {
  const svc = useMemo(() => new HistoryService({ store: chromeStore(), loadProfile: async () => null, now: () => Date.now() }), []);
  const [rows, setRows] = useState<HistoryRecord[]>([]);
  const [days, setDays] = useState<DayUsage[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRows(await svc.list());
    setDays(usageByDay(await loadUsage(chromeStore())));
  }, [svc]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const exportAll = async () => {
    const url = URL.createObjectURL(new Blob([await svc.exportJson()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "applypilot-history.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const rate = cacheHitRate(rows);
  const perRun = usageByRun(rows);

  return (
    <section data-testid="history">
      <h2>Application history</h2>
      <p className="muted">One entry per finished run: what the page was, what was filled and verified, and what is left for you. No typed values are stored.</p>
      <div className="field">
        <button data-testid="history-export" disabled={rows.length === 0} onClick={() => void exportAll()}>Export (JSON)</button>{" "}
        <button className="danger" data-testid="history-clear" disabled={rows.length === 0} onClick={() => void svc.clearAll().then(refresh)}>Clear all</button>
      </div>
      {rows.length === 0 && <p className="muted" data-testid="no-history">No applications yet.</p>}
      {rows.map((h) => (
        <article key={h.id} className="answer" data-testid="history-row" data-state={h.state}>
          <h3>
            {h.company ?? h.host} {h.role ? `: ${h.role}` : ""}
          </h3>
          <p className="note">
            {new Date(h.finishedAt).toISOString().slice(0, 16).replace("T", " ")} | {h.host}
            {h.path} | {STATE_TEXT[h.state] ?? h.state} | {h.route}
          </p>
          <p>
            {h.counts.verified} verified, {h.counts.failed} failed, {h.counts.unresolved + h.counts.ambiguous + h.counts.skippedSensitive} left for you
            {h.counts.requiredUnresolved > 0 ? ` (${h.counts.requiredUnresolved} required)` : ""}; {h.steps.length} step(s).
            {h.resume.filename ? ` Resume: ${h.resume.filename}${h.resume.uploadVerified ? " (uploaded)" : " (not uploaded)"}${h.variantId ? `, variant ${h.variantId}` : ""}.` : ""}
          </p>
          <button data-testid="history-toggle" onClick={() => setOpen(open === h.id ? null : h.id)}>{open === h.id ? "Hide details" : "Details"}</button>{" "}
          <button className="danger" data-testid="history-delete" onClick={() => void svc.deleteOne(h.id).then(refresh)}>Delete</button>
          {open === h.id && (
            <div data-testid="history-details">
              <ol>
                {h.steps.map((s) => (
                  <li key={s.index}>
                    {s.title || `Step ${s.index + 1}`}: {s.outcome}, {s.verified} verified, {s.failed} failed
                  </li>
                ))}
              </ol>
              {h.unresolvedLabels.length > 0 && <p>Left for you: {h.unresolvedLabels.join(", ")}</p>}
              {h.warnings.length > 0 && (
                <ul className="note">
                  {h.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </article>
      ))}

      <h2>AI usage</h2>
      <p className="muted">Counts and tokens only. Prompts and answers are never stored.</p>
      <p data-testid="cache-rate">Cache hit rate across the applications above: {rate === null ? "no AI-assisted answers yet" : `${(rate * 100).toFixed(0)}%`}</p>
      {days.length === 0 ? (
        <p className="muted" data-testid="no-usage">No AI requests yet.</p>
      ) : (
        <table data-testid="usage-days">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Provider</th>
              <th scope="col">Requests</th>
              <th scope="col">Failed</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Output tokens</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={`${d.day}|${d.provider}`} data-testid="usage-row">
                <td>{d.day}</td>
                <td>{d.provider}</td>
                <td>{d.requests}</td>
                <td>{d.failed}</td>
                <td>{d.inputTokens}</td>
                <td>{d.outputTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {perRun.length > 0 && (
        <ul data-testid="usage-runs">
          {perRun.slice(0, 20).map((r) => (
            <li key={r.id}>
              {new Date(r.at).toISOString().slice(0, 10)} {r.company ?? r.host}: {r.requests} request(s), {r.cacheHits} cache hit(s)
              {r.provider ? `, ${r.provider}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
