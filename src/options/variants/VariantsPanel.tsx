import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResumeStore } from "@/resume/contracts";
import type { MasterResume, ResumeVariant, SectionKey } from "@/resume/schema";
import { SECTION_KEYS } from "@/resume/schema";
import { defaultVariants } from "@/resume/variants/defaults";
import {
  blankVariant, entryOptions, factMode, factOptions, moveEntry, moveSection, parseKeywords, setFactMode, setLimit, staleIds, toggleEntry, toggleSection, validateVariant,
  variantFromDefault, type FactMode,
} from "./editing";

const SECTION_LABEL: Record<SectionKey, string> = {
  summary: "Summary", education: "Education", experience: "Experience", projects: "Projects", skills: "Skills", certifications: "Certifications", achievements: "Achievements",
};

/**
 * Variant list and editor (SPEC 7.2). A variant only stores ids and rules over the master; the master's own wording is
 * shown here for choosing facts but is never copied into a variant. The caller wires this into the options page.
 */
export function VariantsPanel({ store }: { store: ResumeStore }) {
  const [variants, setVariants] = useState<ResumeVariant[]>([]);
  const [master, setMaster] = useState<MasterResume | null>(null);
  const [draft, setDraft] = useState<ResumeVariant | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const [vs, m] = await Promise.all([store.listVariants(), store.getMaster()]);
    setVariants(vs);
    setMaster(m);
  }, [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ids = variants.map((v) => v.variantId);
  const starters = useMemo(() => (master ? defaultVariants(master) : []), [master]);
  const facts = useMemo(() => (master ? factOptions(master) : []), [master]);
  const entries = useMemo(() => (master ? entryOptions(master) : []), [master]);

  const begin = (v: ResumeVariant | null, fresh: boolean) => {
    setDraft(v);
    setIsNew(fresh);
    setErrors([]);
    setNote("");
  };
  const save = async () => {
    if (!draft) return;
    const problems = validateVariant(draft, variants);
    setErrors(problems);
    if (problems.length > 0) return;
    await store.putVariant(draft);
    setNote(`Saved "${draft.name}"`);
    setIsNew(false);
    await refresh();
  };
  const remove = async (v: ResumeVariant) => {
    await store.deleteVariant(v.variantId);
    if (draft?.variantId === v.variantId) begin(null, false);
    setNote(`Deleted "${v.name}"`);
    await refresh();
  };
  const patch = (f: (v: ResumeVariant) => ResumeVariant) => setDraft((d) => (d ? f(d) : d));

  const stale = draft && master ? staleIds(draft, master).length : 0;

  return (
    <section data-testid="variants-panel">
      <p>
        A variant chooses which of your recorded entries and facts lead, and in what order. It never changes or copies your wording. Pick one per application,
        or let ApplyPilot choose from the job title.
      </p>

      <ul data-testid="variant-list">
        {variants.length === 0 && <li className="muted" data-testid="no-variants">No variants yet.</li>}
        {variants.map((v) => (
          <li key={v.variantId} data-testid="variant-item">
            <strong>{v.name}</strong> <span className="muted">({v.roleKeywords.slice(0, 4).join(", ") || "no keywords"})</span>{" "}
            <button data-testid="variant-edit" onClick={() => begin(v, false)}>Edit</button>{" "}
            <button className="danger" data-testid="variant-delete" onClick={() => void remove(v)}>Delete</button>
          </li>
        ))}
      </ul>

      <div>
        <input data-testid="new-variant-name" aria-label="New variant name" placeholder="Variant name" value={newName} onChange={(e) => setNewName(e.target.value)} />{" "}
        <button data-testid="variant-create-blank" onClick={() => { begin(blankVariant(newName, ids, master), true); setNewName(""); }}>Create blank</button>
      </div>
      {master && (
        <div>
          <select data-testid="variant-default-select" aria-label="Start from a default" defaultValue="" onChange={(e) => {
            const v = e.target.value ? variantFromDefault(master, e.target.value, ids) : null;
            if (v) begin(v, true);
            e.target.value = "";
          }}>
            <option value="">Create from a default…</option>
            {starters.map((s) => <option key={s.variantId} value={s.variantId}>{s.name}</option>)}
          </select>
        </div>
      )}
      {!master && <p className="muted" data-testid="no-master">Confirm a master resume first; variants choose from its entries and facts.</p>}

      {note && <p role="status" data-testid="variant-note">{note}</p>}

      {draft && (
        <form data-testid="variant-editor" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h3>{isNew ? "New variant" : `Edit ${draft.name}`}</h3>
          <label>Name <input data-testid="variant-name" value={draft.name} onChange={(e) => patch((v) => ({ ...v, name: e.target.value }))} /></label>
          <label>Role keywords (comma separated, matched against the job title)
            <input data-testid="variant-keywords" value={draft.roleKeywords.join(", ")} onChange={(e) => patch((v) => ({ ...v, roleKeywords: parseKeywords(e.target.value) }))} />
          </label>

          <h4>Sections, in order</h4>
          <ol data-testid="variant-sections">
            {draft.sectionOrder.map((k, i) => (
              <li key={k} data-testid="variant-section">
                {SECTION_LABEL[k]}{" "}
                <button type="button" aria-label={`Move ${SECTION_LABEL[k]} up`} onClick={() => patch((v) => moveSection(v, i, -1))}>Up</button>
                <button type="button" aria-label={`Move ${SECTION_LABEL[k]} down`} onClick={() => patch((v) => moveSection(v, i, 1))}>Down</button>
                <button type="button" aria-label={`Hide ${SECTION_LABEL[k]}`} onClick={() => patch((v) => toggleSection(v, k))}>Hide</button>
              </li>
            ))}
          </ol>
          {SECTION_KEYS.filter((k) => !draft.sectionOrder.includes(k)).map((k) => (
            <button type="button" key={k} data-testid="variant-section-add" onClick={() => patch((v) => toggleSection(v, k))}>Show {SECTION_LABEL[k]}</button>
          ))}

          {master && (
            <>
              <h4>Entries, in order</h4>
              <ol data-testid="variant-entries">
                {draft.entryOrder.map((id, i) => {
                  const o = entries.find((x) => x.entryId === id);
                  return (
                    <li key={id} data-testid="variant-entry">
                      {o ? `${o.label} (${o.section})` : `${id} (no longer in the master)`}{" "}
                      <button type="button" aria-label="Move entry up" onClick={() => patch((v) => moveEntry(v, i, -1))}>Up</button>
                      <button type="button" aria-label="Move entry down" onClick={() => patch((v) => moveEntry(v, i, 1))}>Down</button>
                      <button type="button" aria-label="Remove entry" onClick={() => patch((v) => toggleEntry(v, id))}>Remove</button>
                    </li>
                  );
                })}
              </ol>
              {entries.filter((o) => !draft.entryOrder.includes(o.entryId)).map((o) => (
                <button type="button" key={o.entryId} data-testid="variant-entry-add" onClick={() => patch((v) => toggleEntry(v, o.entryId))}>Add {o.label}</button>
              ))}

              <h4>Pinned and excluded facts</h4>
              <ul data-testid="variant-facts">
                {facts.map((f) => (
                  <li key={f.factId} data-testid="variant-fact">
                    <select aria-label={`Treatment of ${f.label}`} data-testid="variant-fact-mode" value={factMode(draft, f.factId)} onChange={(e) => patch((v) => setFactMode(v, f.factId, e.target.value as FactMode))}>
                      <option value="normal">Normal</option>
                      <option value="pinned">Always include</option>
                      <option value="excluded">Never include</option>
                    </select>{" "}
                    {f.label} <span className="muted">({f.context})</span>
                  </li>
                ))}
              </ul>
              {stale > 0 && <p className="muted" data-testid="variant-stale">{stale} saved id(s) no longer exist in the master and are ignored.</p>}
            </>
          )}

          <h4>Limits</h4>
          <label>Projects <input type="number" min={0} max={20} data-testid="variant-max-projects" value={draft.limits.maxProjects} onChange={(e) => patch((v) => setLimit(v, "maxProjects", Number(e.target.value)))} /></label>
          <label>Experience entries <input type="number" min={0} max={20} data-testid="variant-max-experience" value={draft.limits.maxExperience} onChange={(e) => patch((v) => setLimit(v, "maxExperience", Number(e.target.value)))} /></label>
          <label>Bullets per entry <input type="number" min={1} max={12} data-testid="variant-max-bullets" value={draft.limits.maxBulletsPerEntry} onChange={(e) => patch((v) => setLimit(v, "maxBulletsPerEntry", Number(e.target.value)))} /></label>

          {errors.length > 0 && <ul role="alert" data-testid="variant-errors">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
          <button type="submit" data-testid="variant-save">Save variant</button>{" "}
          <button type="button" data-testid="variant-cancel" onClick={() => begin(null, false)}>Cancel</button>
        </form>
      )}
    </section>
  );
}
