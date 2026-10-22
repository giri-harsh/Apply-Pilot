import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PERSONAL_KEYS,
  PROVENANCE_SOURCES,
  SKILL_CATEGORIES,
  emptyProfile,
  newId,
  userProvenance,
  validateProfile,
  type ProfileIssue,
  type UserProfile,
} from "@/shared/profile";
import { deleteProfile, loadProfile, saveProfile } from "@/shared/storage";
import { AiPanel } from "./AiPanel";
import { SiteAccessPanel } from "./SiteAccessPanel";
import { ResumeImportPanel } from "./resume/ResumeImportPanel";
import { ResumeSettingsPanel } from "./resume/ResumeSettingsPanel";
import { MasterEditorPanel } from "./resume/MasterEditorPanel";
import "./options.css";

type Path = (string | number)[];
type Opt = readonly string[];
type Def =
  | { key: string; label: string; kind: "text" | "textarea" | "bool" | "number" | "list" | "metrics" }
  | { key: string; label: string; kind: "select"; options: Opt };

function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string | number, ...Path];
  const clone: Record<string | number, unknown> | unknown[] = Array.isArray(obj) ? [...obj] : { ...(obj as object) };
  (clone as Record<string | number, unknown>)[head] = setAt((obj as Record<string | number, unknown>)[head], rest, value);
  return clone as T;
}

const dotted = (p: Path) => p.join(".");

const PERSONAL_DEFS: Def[] = [
  { key: "fullName", label: "Full legal name", kind: "text" },
  { key: "firstName", label: "First name", kind: "text" },
  { key: "lastName", label: "Last name", kind: "text" },
  { key: "preferredName", label: "Preferred name", kind: "text" },
  { key: "email", label: "Email", kind: "text" },
  { key: "phone", label: "Phone", kind: "text" },
  { key: "city", label: "City", kind: "text" },
  { key: "state", label: "State / region", kind: "text" },
  { key: "country", label: "Country", kind: "text" },
  { key: "postalCode", label: "Postal code", kind: "text" },
  { key: "address", label: "Address (optional)", kind: "text" },
  { key: "linkedinUrl", label: "LinkedIn URL", kind: "text" },
  { key: "githubUrl", label: "GitHub URL", kind: "text" },
  { key: "portfolioUrl", label: "Portfolio URL", kind: "text" },
];

const SECTIONS: Record<
  "education" | "skills" | "projects" | "experience" | "certifications",
  { title: string; defs: Def[]; blank: () => Record<string, unknown>; summary: (r: Record<string, unknown>) => string }
> = {
  education: {
    title: "Education",
    defs: [
      { key: "institution", label: "Institution", kind: "text" },
      { key: "degree", label: "Degree", kind: "text" },
      { key: "fieldOfStudy", label: "Field of study", kind: "text" },
      { key: "startDate", label: "Start (YYYY-MM)", kind: "text" },
      { key: "expectedGraduationDate", label: "Expected graduation (YYYY-MM)", kind: "text" },
      { key: "graduationDate", label: "Actual graduation (YYYY-MM)", kind: "text" },
      { key: "grade", label: "Grade / CGPA", kind: "text" },
      { key: "gradingScale", label: "Grading scale", kind: "text" },
      { key: "coursework", label: "Relevant coursework (one per line)", kind: "list" },
      { key: "distinctions", label: "Academic distinctions (one per line)", kind: "list" },
    ],
    blank: () => ({ id: newId(), institution: "", degree: "", fieldOfStudy: "", startDate: "", expectedGraduationDate: "", graduationDate: "", grade: "", gradingScale: "", coursework: [], distinctions: [], provenance: userProvenance() }),
    summary: (r) => String(r.institution || "New education record"),
  },
  skills: {
    title: "Skills",
    defs: [
      { key: "name", label: "Skill", kind: "text" },
      { key: "category", label: "Category", kind: "select", options: SKILL_CATEGORIES },
      { key: "proficiency", label: "Proficiency", kind: "select", options: ["", "beginner", "intermediate", "advanced"] },
      { key: "evidence", label: "Evidence", kind: "text" },
      { key: "lastVerified", label: "Last verified (YYYY-MM)", kind: "text" },
    ],
    blank: () => ({ id: newId(), name: "", category: "other", proficiency: "", evidence: "", lastVerified: "", provenance: userProvenance() }),
    summary: (r) => String(r.name || "New skill"),
  },
  projects: {
    title: "Projects",
    defs: [
      { key: "name", label: "Project name", kind: "text" },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "problem", label: "Problem solved", kind: "textarea" },
      { key: "architecture", label: "Architecture", kind: "textarea" },
      { key: "technologies", label: "Technologies (one per line)", kind: "list" },
      { key: "contribution", label: "Personal contribution", kind: "textarea" },
      { key: "achievements", label: "Verified achievements (one per line)", kind: "list" },
      { key: "metrics", label: "Metrics: text | source (one per line)", kind: "metrics" },
      { key: "repoUrl", label: "Repository URL", kind: "text" },
      { key: "liveUrl", label: "Live URL", kind: "text" },
      { key: "startDate", label: "Start (YYYY-MM)", kind: "text" },
      { key: "endDate", label: "End (YYYY-MM)", kind: "text" },
      { key: "concepts", label: "Technical concepts (one per line)", kind: "list" },
      { key: "evidence", label: "Evidence for claims (one per line)", kind: "list" },
    ],
    blank: () => ({ id: newId(), name: "", description: "", problem: "", architecture: "", technologies: [], contribution: "", achievements: [], metrics: [], repoUrl: "", liveUrl: "", startDate: "", endDate: "", concepts: [], evidence: [], provenance: userProvenance() }),
    summary: (r) => String(r.name || "New project"),
  },
  experience: {
    title: "Experience",
    defs: [
      { key: "employer", label: "Employer", kind: "text" },
      { key: "position", label: "Position", kind: "text" },
      { key: "employmentType", label: "Type", kind: "select", options: ["", "internship", "full_time", "part_time", "contract", "research", "volunteer"] },
      { key: "startDate", label: "Start (YYYY-MM)", kind: "text" },
      { key: "endDate", label: "End (YYYY-MM)", kind: "text" },
      { key: "current", label: "I currently work here", kind: "bool" },
      { key: "responsibilities", label: "Responsibilities (one per line)", kind: "list" },
      { key: "achievements", label: "Achievements (one per line)", kind: "list" },
      { key: "technologies", label: "Technologies (one per line)", kind: "list" },
      { key: "metrics", label: "Metrics: text | source (one per line)", kind: "metrics" },
      { key: "evidence", label: "Evidence (one per line)", kind: "list" },
    ],
    blank: () => ({ id: newId(), employer: "", position: "", employmentType: "", startDate: "", endDate: "", current: false, responsibilities: [], achievements: [], technologies: [], metrics: [], evidence: [], provenance: userProvenance() }),
    summary: (r) => (r.employer ? `${String(r.position)} @ ${String(r.employer)}` : "New experience record"),
  },
  certifications: {
    title: "Certifications",
    defs: [
      { key: "title", label: "Title", kind: "text" },
      { key: "issuer", label: "Issuer", kind: "text" },
      { key: "issueDate", label: "Issued (YYYY-MM)", kind: "text" },
      { key: "expirationDate", label: "Expires (YYYY-MM)", kind: "text" },
      { key: "credentialId", label: "Credential ID", kind: "text" },
      { key: "credentialUrl", label: "Credential URL", kind: "text" },
    ],
    blank: () => ({ id: newId(), title: "", issuer: "", issueDate: "", expirationDate: "", credentialId: "", credentialUrl: "", provenance: userProvenance() }),
    summary: (r) => String(r.title || "New certification"),
  },
};

const PREF_DEFS: Def[] = [
  { key: "roleCategories", label: "Preferred role categories (one per line)", kind: "list" },
  { key: "locations", label: "Preferred locations (one per line)", kind: "list" },
  { key: "workArrangement", label: "Work arrangement", kind: "select", options: ["", "remote", "hybrid", "onsite", "any"] },
  { key: "availabilityDate", label: "Availability date (YYYY-MM-DD)", kind: "text" },
  { key: "employmentPreference", label: "Internship / full-time", kind: "select", options: ["", "internship", "full_time", "either"] },
  { key: "workAuthorization", label: "Work authorization (only what you state; never auto-filled)", kind: "text" },
  { key: "willingToRelocate", label: "Willing to relocate", kind: "select", options: ["", "yes", "no"] },
  { key: "salaryExpectation", label: "Salary expectation (never auto-filled)", kind: "text" },
  { key: "noticePeriod", label: "Notice period", kind: "text" },
  { key: "resumeTemplate", label: "Preferred resume template", kind: "text" },
  { key: "resumeMaxPages", label: "Preferred resume length (pages)", kind: "number" },
];

const TABS = ["Personal", "Education", "Skills", "Projects", "Experience", "Certifications", "Preferences", "AI providers", "Site access", "Resume", "Import / Export"] as const;
type Tab = (typeof TABS)[number];

function errorsFor(issues: ProfileIssue[], base: string): string[] {
  return issues.filter((i) => i.path === base || i.path.startsWith(base + ".")).map((i) => i.message);
}

function FieldEditor(props: { def: Def; path: Path; value: unknown; issues: ProfileIssue[]; onChange: (v: unknown) => void }) {
  const { def, path, value, issues, onChange } = props;
  const name = dotted(path);
  const errs = errorsFor(issues, name);
  const id = `f-${name}`;
  let control;
  if (def.kind === "textarea") {
    control = <textarea id={id} name={name} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} />;
  } else if (def.kind === "select") {
    control = (
      <select id={id} name={name} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {def.options.map((o) => (
          <option key={o} value={o}>{o || "-"}</option>
        ))}
      </select>
    );
  } else if (def.kind === "bool") {
    control = <input id={id} name={name} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  } else if (def.kind === "number") {
    control = <input id={id} name={name} type="number" value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
  } else if (def.kind === "list") {
    control = (
      <textarea id={id} name={name} rows={3} value={((value as string[]) ?? []).join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
    );
  } else if (def.kind === "metrics") {
    const arr = (value as { text: string; source: string }[]) ?? [];
    control = (
      <textarea id={id} name={name} rows={3} value={arr.map((m) => `${m.text} | ${m.source}`).join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [text = "", ...src] = l.split("|");
          return { text: text.trim(), source: src.join("|").trim() };
        }))} />
    );
  } else {
    control = <input id={id} name={name} type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{def.label}</label>
      {control}
      {errs.map((m, i) => (
        <p key={i} className="err" role="alert" data-error-for={name}>{m}</p>
      ))}
    </div>
  );
}

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<Tab>("Personal");
  const [issues, setIssues] = useState<ProfileIssue[]>([]);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    void loadProfile().then((p) => setProfile(p ?? emptyProfile()));
  }, []);

  const flat = useMemo(() => issues.map((i) => `${i.path}: ${i.message}`), [issues]);
  if (!profile) return <p>Loading...</p>;

  const update = (path: Path, value: unknown) => {
    setMsg("");
    setProfile((p) => setAt(p!, path, value));
  };

  const editPersonal = (key: string, value: string) => {
    setMsg("");
    setProfile((p) => {
      let next = setAt(p!, ["personal", key], value);
      next = setAt(next, ["personal", "provenance", key], userProvenance());
      return next;
    });
  };

  const withProvenance = (p: UserProfile): UserProfile => {
    // Any personal fact that has a value but no provenance entry was entered here by the user.
    let out = p;
    for (const k of PERSONAL_KEYS) {
      if (out.personal[k] !== "" && !out.personal.provenance[k]) out = setAt(out, ["personal", "provenance", k], userProvenance());
    }
    return out;
  };

  const save = async () => {
    const candidate = withProvenance(profile);
    const v = validateProfile(candidate);
    if (!v.ok) {
      setIssues(v.issues);
      setMsg(`Not saved: ${v.issues.length} problem${v.issues.length === 1 ? "" : "s"} to fix`);
      return;
    }
    const r = await saveProfile(candidate);
    if (r.ok) {
      setProfile(candidate);
      setIssues([]);
      setMsg("Saved");
    } else {
      setIssues(r.issues);
      setMsg("Not saved");
    }
  };

  const importFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const v = validateProfile(parsed);
      if (!v.ok) {
        setIssues(v.issues);
        setMsg(`Import rejected: ${v.issues.length} problem${v.issues.length === 1 ? "" : "s"}`);
        return;
      }
      await saveProfile(v.profile);
      setProfile(v.profile);
      setIssues([]);
      setMsg("Imported and saved");
    } catch {
      setIssues([]);
      setMsg("Import rejected: file is not valid JSON");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "applypilot-profile.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const wipe = async () => {
    if (!confirm("Delete all saved profile data?")) return;
    await deleteProfile();
    setProfile(emptyProfile());
    setIssues([]);
    setMsg("Profile deleted");
  };

  return (
    <div className="wrap">
      <h1>ApplyPilot AI - Profile vault</h1>
      <nav role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === "Personal" && (
        <section>
          {PERSONAL_DEFS.map((d) => {
            const key = d.key;
            const prov = profile.personal.provenance[key];
            return (
              <div key={key} className="row">
                <FieldEditor def={d} path={["personal", key]} value={(profile.personal as Record<string, unknown>)[key]} issues={issues}
                  onChange={(v) => editPersonal(key, String(v))} />
                <select aria-label={`${d.label} source`} name={`personal.provenance.${key}.source`} value={prov?.source ?? "user_entered"}
                  onChange={(e) => update(["personal", "provenance", key], { source: e.target.value, recordedAt: new Date().toISOString() })}>
                  {PROVENANCE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            );
          })}
        </section>
      )}

      {(["education", "skills", "projects", "experience", "certifications"] as const).map((sec) => {
        const cfg = SECTIONS[sec];
        if (tab !== cfg.title) return null;
        const list = profile[sec] as unknown as Record<string, unknown>[];
        return (
          <section key={sec}>
            {list.length === 0 && <p className="muted">No {cfg.title.toLowerCase()} records yet.</p>}
            {list.map((rec, i) => (
              <fieldset key={String(rec.id)}>
                <legend>{cfg.summary(rec)}</legend>
                {cfg.defs.map((d) => (
                  <FieldEditor key={d.key} def={d} path={[sec, i, d.key]} value={rec[d.key]} issues={issues}
                    onChange={(v) => update([sec, i, d.key], v)} />
                ))}
                <button className="danger" onClick={() => update([sec], list.filter((_, j) => j !== i))}>Delete this record</button>
              </fieldset>
            ))}
            <button data-testid={`add-${sec}`} onClick={() => update([sec], [...list, cfg.blank()])}>Add {cfg.title.toLowerCase()} record</button>
          </section>
        );
      })}

      {tab === "Preferences" && (
        <section>
          {PREF_DEFS.map((d) => (
            <FieldEditor key={d.key} def={d} path={["preferences", d.key]} value={(profile.preferences as Record<string, unknown>)[d.key]} issues={issues}
              onChange={(v) => update(["preferences", d.key], v)} />
          ))}
        </section>
      )}

      {tab === "AI providers" && <AiPanel />}

      {tab === "Site access" && <SiteAccessPanel />}
      {tab === "Resume" && (
        <>
          <ResumeImportPanel />
          <ResumeSettingsPanel />
          <MasterEditorPanel />
        </>
      )}

      {tab === "Import / Export" && (
        <section>
          <p>Export your profile as JSON, or import one. Imports are validated first; an invalid file changes nothing.</p>
          <button onClick={exportJson}>Export JSON</button>
          <div className="field">
            <label htmlFor="import-file">Import JSON</label>
            <input id="import-file" type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          </div>
          <button className="danger" onClick={() => void wipe()}>Delete all profile data</button>
        </section>
      )}

      <div className="bar">
        <button className="primary" data-testid="save" onClick={() => void save()}>Save profile</button>
        <span data-testid="message" role="status">{msg}</span>
      </div>
      {flat.length > 0 && (
        <ul data-testid="error-list" className="errlist">
          {flat.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
