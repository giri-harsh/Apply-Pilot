import { useCallback, useEffect, useMemo, useState } from "react";
import { createResumeStore } from "@/resume/storage";
import type { Fact, MasterResume } from "@/resume/schema";
import { cleanVariants, deleteEntry, deleteFact, editFact, type Removal } from "./masterEdit";

function factRow(p: { fact: Fact; label: string; canDelete: boolean; value: string; onChange(v: string): void; onSave(): void; onDelete(): void }) {
  const { fact } = p;
  return (
    <div className="field" key={fact.factId} data-testid="master-fact" data-fact-id={fact.factId} data-source={fact.provenance.source}>
      <label htmlFor={`mf-${fact.factId}`}>{p.label}</label>
      <input id={`mf-${fact.factId}`} type="text" value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      <button data-testid="master-fact-save" disabled={p.value.trim() === fact.text || p.value.trim() === ""} onClick={p.onSave}>
        Save
      </button>{" "}
      {p.canDelete && (
        <button className="danger" data-testid="master-fact-delete" onClick={p.onDelete}>
          Delete
        </button>
      )}
      {fact.provenance.source === "user_edited" && <span className="muted"> edited by you {fact.provenance.recordedAt.slice(0, 10)}</span>}
    </div>
  );
}

/**
 * Edit or delete individual facts of the master resume. An edited fact is marked "user_edited" with the time; a deleted
 * fact or entry is also removed from every variant that used it, with a warning. Tailoring never writes here.
 */
export function MasterEditorPanel() {
  const store = useMemo(() => createResumeStore(), []);
  const [master, setMaster] = useState<MasterResume | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string[]>([]);

  const refresh = useCallback(async () => setMaster(await store.getMaster()), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!master) return null;

  const commit = async (next: MasterResume, removal?: Removal) => {
    await store.putMaster(next);
    const notes: string[] = [];
    if (removal) {
      const c = cleanVariants(await store.listVariants(), removal);
      for (const v of c.variants.filter((x) => c.changed.some((ch) => ch.variantId === x.variantId))) await store.putVariant(v);
      notes.push(...c.warnings);
    }
    setMsg(notes.length > 0 ? notes : ["Saved"]);
    await refresh();
  };

  const run = (fn: () => Promise<void>) => void fn().catch((e) => setMsg([e instanceof Error ? e.message : "Failed"]));

  // A plain function returning elements (not a component), so React keeps the same <input> while the user types.
  const rowFor = (fact: Fact, label: string, canDelete = true) =>
    factRow({
      fact, label, canDelete, value: drafts[fact.factId] ?? fact.text,
      onChange: (v) => setDrafts({ ...drafts, [fact.factId]: v }),
      onSave: () => run(async () => { await commit(editFact(master, fact.factId, drafts[fact.factId] ?? fact.text, new Date())); setDrafts(({ [fact.factId]: _gone, ...rest }) => rest); }),
      onDelete: () => run(async () => { const r = deleteFact(master, fact.factId); await commit(r.master, r); }),
    });

  return (
    <section data-testid="master-editor">
      <h2>Edit master resume</h2>
      <p className="muted">Changes apply to future resumes. Deleting something also removes it from your variants.</p>
      {rowFor(master.contact.name, "Name", false)}
      {master.summary && rowFor(master.summary, "Summary")}
      {master.entries.map((e) => (
        <fieldset key={e.entryId} data-testid="master-entry">
          <legend>{e.section}: {e.heading.text}</legend>
          {rowFor(e.heading, "Heading", false)}
          {e.subheading && rowFor(e.subheading, "Subheading")}
          {e.bullets.map((b, i) => (
            rowFor(b, `Bullet ${i + 1}`)
          ))}
          <button className="danger" data-testid="master-entry-delete" onClick={() => run(async () => { const r = deleteEntry(master, e.entryId); await commit(r.master, r); })}>
            Delete this entry
          </button>
        </fieldset>
      ))}
      {master.skillGroups.map((g) => (
        <fieldset key={g.groupId}>
          <legend>Skills: {g.label}</legend>
          {g.items.map((s) => (
            rowFor(s, "Skill")
          ))}
        </fieldset>
      ))}
      <ul role="status" data-testid="master-editor-note">
        {msg.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </section>
  );
}
