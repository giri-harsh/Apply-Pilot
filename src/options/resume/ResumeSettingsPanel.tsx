import { useCallback, useEffect, useMemo, useState } from "react";
import { createResumeStore } from "@/resume/storage";
import type { FileRef, MasterResume, ResumeDocument, ResumeSettings } from "@/resume/schema";

/**
 * Tailoring settings and the history of generated resumes (SPEC 7.7, 19.4). Tailoring stays off until a master is
 * confirmed and the user turns it on; every generated file can be downloaded or deleted here.
 */
export function ResumeSettingsPanel() {
  const store = useMemo(() => createResumeStore(), []);
  const [settings, setSettings] = useState<ResumeSettings | null>(null);
  const [master, setMaster] = useState<MasterResume | null>(null);
  const [docs, setDocs] = useState<ResumeDocument[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    setSettings(await store.getSettings());
    setMaster(await store.getMaster());
    setDocs((await store.listDocuments()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!settings) return <p className="muted">Loading...</p>;

  const save = async (patch: Partial<ResumeSettings>) => {
    const r = await store.putSettings({ ...settings, ...patch });
    setMsg(r.ok ? "Saved" : r.message);
    await refresh();
  };

  /** SPEC 19.4: the user can export their data. Structured content only; generated files are downloaded one by one. */
  const exportData = async () => {
    const payload = { exportedAt: new Date().toISOString(), master: await store.getMaster(), variants: await store.listVariants(), settings: await store.getSettings(), documents: await store.listDocuments() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "applypilot-resume-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const download = async (ref: FileRef | null) => {
    if (!ref) return;
    const bin = await store.getBinary(ref.fileId);
    if (!bin) {
      setMsg("That file is no longer stored");
      return;
    }
    const url = URL.createObjectURL(new Blob([bin.bytes as BlobPart], { type: ref.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = ref.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section data-testid="resume-settings">
      <h2>Resume tailoring</h2>
      <p className="muted">
        When on, Quick Apply builds a job-specific PDF from your confirmed master resume and uploads it. Your master is never changed.
      </p>
      <div className="field">
        <label>
          <input
            type="checkbox"
            data-testid="tailoring-toggle"
            checked={settings.tailoringEnabled}
            disabled={!master}
            onChange={(e) => void save({ tailoringEnabled: e.target.checked })}
          />{" "}
          Tailor my resume for each application
        </label>
        {!master && <span className="muted"> Import and confirm a master resume first.</span>}
      </div>
      <div className="field">
        <label htmlFor="page-limit">Page limit</label>
        <input
          id="page-limit"
          data-testid="page-limit"
          type="number"
          min={1}
          max={5}
          value={settings.pageLimit}
          onChange={(e) => void save({ pageLimit: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
        />
      </div>
      <div className="field">
        <label>
          <input type="checkbox" data-testid="cover-letter-toggle" checked={settings.coverLetterEnabled} onChange={(e) => void save({ coverLetterEnabled: e.target.checked })} /> Write a cover letter when a portal requires one
        </label>
        <span className="muted"> Off by default. Needs AI. Optional cover-letter fields are always left for you.</span>
      </div>
      <div className="field">
        <button data-testid="export-resume-data" onClick={() => void exportData()}>Export master, variants and history (JSON)</button>
      </div>
      <span role="status" data-testid="resume-settings-note">{msg}</span>

      <h2>Generated resumes</h2>
      {docs.length === 0 && <p className="muted" data-testid="no-documents">None yet.</p>}
      {docs.map((d) => (
        <article key={d.documentId} className="answer" data-testid="resume-document" data-status={d.validationStatus}>
          <h3>
            {d.job.company || "Company"}: {d.job.title || "Role"}
          </h3>
          <p className="note">
            {d.createdAt.slice(0, 10)}, variant {d.variantId}, {d.report.layout.pageCount} page(s) of {d.report.layout.pageLimit} allowed, {d.validationStatus}
          </p>
          {d.report.warnings.length > 0 && (
            <ul className="note">
              {d.report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <button data-testid="download-pdf" disabled={!d.report.output} onClick={() => void download(d.report.output)}>
            Download PDF
          </button>{" "}
          <button data-testid="download-docx" disabled={!d.report.docxOutput} onClick={() => void download(d.report.docxOutput)}>
            Download DOCX (page count not validated)
          </button>{" "}
          <button
            className="danger"
            data-testid="delete-document"
            onClick={() => void store.deleteDocument(d.documentId).then(refresh)}
          >
            Delete
          </button>
        </article>
      ))}
    </section>
  );
}
