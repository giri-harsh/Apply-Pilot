import { useCallback, useEffect, useMemo, useState } from "react";
import { DIAG_SETTINGS_KEY, DiagSettingsSchema, type PortalCapture } from "@/diagnostics/schema";
import { createCaptureStore, type CaptureSummary } from "@/diagnostics/store";

function saveJson(name: string, data: unknown) {
  // A blob anchor from the extension page: no "downloads" permission needed.
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Redacted portal captures for adapter development: capture-each-step switch, list, view, export and delete. */
export function DiagnosticsPanel() {
  const store = useMemo(() => createCaptureStore(), []);
  const [rows, setRows] = useState<CaptureSummary[]>([]);
  const [each, setEach] = useState(false);
  const [open, setOpen] = useState<PortalCapture | null>(null);

  const refresh = useCallback(async () => {
    setRows(await store.list());
    setEach(DiagSettingsSchema.parse((await chrome.storage.local.get(DIAG_SETTINGS_KEY))[DIAG_SETTINGS_KEY] ?? {}).captureEachStep);
  }, [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section data-testid="diagnostics">
      <h2>Portal captures</h2>
      <p>
        A capture is a redacted structural snapshot of an application step (labels, field types, buttons, page structure). It never contains what is typed
        into fields, your profile, or file names. It is stored only on this computer; export it yourself to share it.
      </p>
      <label>
        <input
          type="checkbox"
          data-testid="capture-each-step"
          checked={each}
          onChange={(e) => void chrome.storage.local.set({ [DIAG_SETTINGS_KEY]: { captureEachStep: e.target.checked } }).then(refresh)}
        />{" "}
        Capture each step automatically during a run
      </label>
      <div className="field">
        <button data-testid="capture-export-all" disabled={rows.length === 0} onClick={() => void store.exportAll().then((all) => saveJson("applypilot-captures.json", all))}>
          Export all (JSON)
        </button>{" "}
        <button className="danger" data-testid="capture-delete-all" disabled={rows.length === 0} onClick={() => void store.clearAll().then(() => { setOpen(null); return refresh(); })}>
          Delete all
        </button>
      </div>
      {rows.length === 0 && <p className="muted" data-testid="no-captures">No captures yet. Use "Capture this page for adapter work" in the popup.</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.captureId} data-testid="capture-row">
            {r.capturedAt.slice(0, 19).replace("T", " ")} {r.host}
            {r.path} {r.step !== null ? `(step ${r.step + 1})` : ""} {r.fields} fields, {r.controls} buttons{" "}
            <button data-testid="capture-view" onClick={() => void store.get(r.captureId).then(setOpen)}>View</button>{" "}
            <button data-testid="capture-export" onClick={() => void store.get(r.captureId).then((c) => c && saveJson(`capture-${r.host}-${r.captureId.slice(0, 8)}.json`, c))}>Export</button>{" "}
            <button className="danger" data-testid="capture-delete" onClick={() => void store.delete(r.captureId).then(() => { setOpen(null); return refresh(); })}>Delete</button>
          </li>
        ))}
      </ul>
      {open && <pre data-testid="capture-json" style={{ maxHeight: 360, overflow: "auto" }}>{JSON.stringify(open, null, 2)}</pre>}
    </section>
  );
}
