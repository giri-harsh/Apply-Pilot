import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createResumeStore } from "@/resume/storage";
import type { Fact, MasterResume, ParsedResume, SectionKey } from "@/resume/schema";
import {
  acceptAllFlagged,
  acceptFact,
  assignUnknownSection,
  canConfirm,
  editFactText,
  flaggedCount,
  removeEntry,
  removeFact,
  removeSkillGroup,
  reviewBlocks,
  type Draft,
  type ReviewBlock,
} from "./reviewState";

const flagStyle = { borderLeft: "4px solid #b45309", paddingLeft: 8, background: "#f59e0b22" } as const;
const ASSIGN: SectionKey[] = ["summary", "education", "experience", "projects", "skills", "certifications", "achievements"];

function FactRow(props: { fact: Fact; label?: string; multiline?: boolean; onEdit: (id: string, text: string) => void; onRemove?: (id: string) => void; onAccept: (id: string) => void }) {
  const { fact, label, multiline, onEdit, onRemove, onAccept } = props;
  return (
    <div className="field" style={fact.lowConfidence ? flagStyle : undefined} data-testid={fact.lowConfidence ? "resume-flagged" : undefined}>
      {label && <label htmlFor={`fact-${fact.factId}`}>{label}</label>}
      {multiline ? (
        <textarea id={`fact-${fact.factId}`} rows={3} value={fact.text} onChange={(e) => onEdit(fact.factId, e.target.value)} />
      ) : (
        <input id={`fact-${fact.factId}`} type="text" value={fact.text} onChange={(e) => onEdit(fact.factId, e.target.value)} />
      )}
      {fact.lowConfidence && (
        <span className="muted">
          Check this one: the parser was unsure.{fact.sourceText ? <> Source text: <code>{fact.sourceText}</code></> : null}{" "}
          <button type="button" onClick={() => onAccept(fact.factId)}>It is correct</button>
        </span>
      )}
      {onRemove && (
        <span>
          <button type="button" className="danger" onClick={() => onRemove(fact.factId)}>Remove</button>
        </span>
      )}
    </div>
  );
}

/**
 * Resume import: choose a file, parse it, review every extracted item (uncertain ones first), then Confirm.
 * Nothing becomes the master until the user clicks Confirm.
 */
export function ResumeImportPanel() {
  const store = useMemo(() => createResumeStore(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [master, setMaster] = useState<MasterResume | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refreshMaster = useCallback(async () => setMaster(await store.getMaster().catch(() => null)), [store]);
  useEffect(() => {
    void refreshMaster();
  }, [refreshMaster]);

  const parse = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Heavy parsing code (pdf.js, mammoth) loads only now, in this extension page.
      const { parseResume } = await import("@/resume/import");
      const result = await parseResume({ name: file.name, bytes }, { maxBytes: 10 * 1024 * 1024 });
      setParsed(result);
      setDraft(result.draft);
    } catch (e) {
      setParsed(null);
      setDraft(null);
      setMsg(`Could not read the file: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!parsed || !draft || !canConfirm(parsed, draft)) return;
    setBusy(true);
    try {
      const { confirmImport } = await import("@/resume/import");
      const m = confirmImport(draft, new Date());
      await store.putMaster(m);
      setMaster(m);
      setParsed(null);
      setDraft(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setMsg("Master resume saved.");
    } catch (e) {
      setMsg(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setParsed(null);
    setDraft(null);
    setMsg("Import discarded. Nothing was saved.");
  };

  const deleteMaster = async () => {
    if (!window.confirm("Delete your master resume? Variants and generated documents are kept.")) return;
    await store.deleteMaster();
    await refreshMaster();
    setMsg("Master resume deleted.");
  };
  const deleteAll = async () => {
    if (!window.confirm("Delete ALL resume data (master, variants, generated documents, stored files, settings)? This cannot be undone.")) return;
    await store.clearAll();
    await refreshMaster();
    setMsg("All resume data deleted.");
  };

  const edit = (id: string, text: string) => setDraft((d) => (d ? editFactText(d, id, text) : d));
  const accept = (id: string) => setDraft((d) => (d ? acceptFact(d, id) : d));
  const remove = (id: string) => setDraft((d) => (d ? removeFact(d, id) : d));
  const rowProps = { onEdit: edit, onAccept: accept };

  const blocks = parsed ? reviewBlocks(parsed, draft) : [];
  const flagged = parsed ? flaggedCount(parsed, draft) : 0;

  const renderBlock = (b: ReviewBlock) => {
    if (!draft) return null;
    switch (b.kind) {
      case "unknown":
        return (
          <div>
            <p className="muted">ApplyPilot could not tell which section this is. It is not part of the draft until you assign it.</p>
            <pre style={{ whiteSpace: "pre-wrap" }}>{b.sourceText}</pre>
            <label htmlFor={`assign-${b.sectionIndex}`}>Treat this text as</label>{" "}
            <select
              id={`assign-${b.sectionIndex}`}
              defaultValue=""
              onChange={(e) => {
                const key = e.target.value as SectionKey;
                if (!key || !parsed || !draft) return;
                const r = assignUnknownSection(parsed, draft, b.sectionIndex, key, new Date());
                setParsed(r.parsed);
                setDraft(r.draft);
              }}
            >
              <option value="">Choose a section...</option>
              {ASSIGN.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        );
      case "contact": {
        const c = draft.contact;
        return (
          <div>
            <FactRow fact={c.name} label="Name" {...rowProps} />
            {c.email && <FactRow fact={c.email} label="Email" {...rowProps} onRemove={remove} />}
            {c.phone && <FactRow fact={c.phone} label="Phone" {...rowProps} onRemove={remove} />}
            {c.location && <FactRow fact={c.location} label="Location" {...rowProps} onRemove={remove} />}
            {c.links.map((l) => <FactRow key={l.fact.factId} fact={l.fact} label={l.label} {...rowProps} onRemove={remove} />)}
          </div>
        );
      }
      case "summary":
        return draft.summary ? <FactRow fact={draft.summary} multiline {...rowProps} onRemove={remove} /> : null;
      case "entry": {
        const e = draft.entries.find((x) => x.entryId === b.entryId);
        if (!e) return null;
        return (
          <div>
            <FactRow fact={e.heading} label="Heading" {...rowProps} />
            {e.subheading && <FactRow fact={e.subheading} label="Detail" {...rowProps} onRemove={remove} />}
            {(e.dates || e.location) && <p className="muted">{[e.dates, e.location].filter(Boolean).join(" | ")}</p>}
            {e.technologies.length > 0 && <p className="muted">Technologies: {e.technologies.join(", ")}</p>}
            {e.bullets.map((f) => <FactRow key={f.factId} fact={f} multiline {...rowProps} onRemove={remove} />)}
            <button type="button" className="danger" onClick={() => setDraft((d) => (d ? removeEntry(d, e.entryId) : d))}>Remove this whole entry</button>
          </div>
        );
      }
      case "skillGroup": {
        const g = draft.skillGroups.find((x) => x.groupId === b.groupId);
        if (!g) return null;
        return (
          <div>
            {g.items.map((f) => <FactRow key={f.factId} fact={f} {...rowProps} onRemove={remove} />)}
            <button type="button" className="danger" onClick={() => setDraft((d) => (d ? removeSkillGroup(d, g.groupId) : d))}>Remove this whole group</button>
          </div>
        );
      }
      case "achievements":
        return <div>{draft.achievements.map((f) => <FactRow key={f.factId} fact={f} {...rowProps} onRemove={remove} />)}</div>;
    }
  };

  return (
    <section data-testid="resume-panel">
      <p>
        Import your resume to create the master resume: the verified facts every tailored resume is built from. Parsing happens in this page; the file is not
        uploaded anywhere. Nothing is saved until you review the result and click Confirm.
      </p>

      <h3>Current master resume</h3>
      {master ? (
        <div data-testid="resume-master-summary">
          <p>
            <strong>{master.contact.name.text}</strong>
            {master.importedFrom ? ` (from ${master.importedFrom.filename})` : ""}, confirmed {master.confirmedAt}.
          </p>
          <p className="muted">
            {master.entries.filter((e) => e.section === "education").length} education, {master.entries.filter((e) => e.section === "experience").length} experience,{" "}
            {master.entries.filter((e) => e.section === "projects").length} projects, {master.skillGroups.length} skill groups,{" "}
            {master.entries.filter((e) => e.section === "certifications").length} certifications.
          </p>
        </div>
      ) : (
        <p className="muted" data-testid="resume-no-master">No master resume yet.</p>
      )}
      <button data-testid="resume-delete-master" className="danger" disabled={!master} onClick={() => void deleteMaster()}>Delete master resume</button>{" "}
      <button data-testid="resume-delete-all" className="danger" onClick={() => void deleteAll()}>Delete all resume data</button>
      {msg && <p role="status" data-testid="resume-message">{msg}</p>}

      <h3>Import a resume</h3>
      <div className="field">
        <label htmlFor="resume-file">Resume file (PDF, DOCX, TXT or Markdown, up to 10 MB)</label>
        <input
          id="resume-file"
          ref={fileRef}
          data-testid="resume-file"
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setParsed(null);
            setDraft(null);
          }}
        />
      </div>
      <button data-testid="resume-parse" className="primary" disabled={!file || busy} onClick={() => void parse()}>{busy ? "Working..." : "Read file"}</button>

      {parsed && parsed.warnings.length > 0 && (
        <div data-testid="resume-warning" role="alert" style={{ border: "2px solid #b91c1c", borderRadius: 6, padding: 8, margin: "12px 0" }}>
          <strong>{parsed.draft ? "Check these before confirming" : "This file cannot be imported"}</strong>
          <ul>{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {parsed && draft && (
        <div data-testid="resume-review">
          <h3>Review what was found</h3>
          <p>
            {flagged > 0
              ? `${flagged} item${flagged === 1 ? "" : "s"} need${flagged === 1 ? "s" : ""} your attention and are shown first. Edit any text; removing an item removes it from the draft only.`
              : "Nothing looked uncertain. Still read every item: ApplyPilot will only ever restate what is here."}
          </p>
          {blocks.map((b) => (
            <fieldset key={b.id} data-testid="resume-section" data-flagged={b.flagged ? "true" : "false"} style={b.flagged ? flagStyle : undefined}>
              <legend>{b.flagged && <span data-testid="resume-flagged-label">Needs review. </span>}{b.title}</legend>
              {renderBlock(b)}
            </fieldset>
          ))}
          <div className="bar">
            <button data-testid="resume-confirm" className="primary" disabled={busy || !canConfirm(parsed, draft)} onClick={() => void confirm()}>Confirm and save as master resume</button>
            <button type="button" onClick={() => setDraft((d) => (d ? acceptAllFlagged(d) : d))} disabled={flagged === 0}>Mark all items as checked</button>
            <button type="button" onClick={discard}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}
