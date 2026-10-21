import { rankAgainstProfile } from "@/job/rank";
import type { JobContext } from "@/job/schema";
import { canonicalSkill, extractSkills } from "@/job/skills";
import type { Education, Experience, Project, UserProfile } from "@/shared/profile";
import type { GenerateCategory } from "./questions";

/**
 * SPEC 20.4 evidence retrieval: for each question, only the profile slices that bear on it. Never the whole
 * profile and never contact details (email, phone, address, links); names of projects and employers appear only
 * inside the evidence items the question needs.
 */

export type EvidenceKind = "project" | "experience" | "education" | "skills";

export type EvidenceItem = {
  /** Short id the model must cite: P1, X1, E1, S1. */
  id: string;
  kind: EvidenceKind;
  title: string;
  /** The rendered facts the model is allowed to use, and the text the grounding validator checks against. */
  text: string;
  technologies: string[]; // canonical skill names evidenced by this item
  /** Organisations this item legitimately names. */
  orgs: string[];
  deployed: boolean;
  employment: boolean;
};

export type QuestionInput = { id: string; category: GenerateCategory; text: string; technologies: string[] };

export type EvidenceBundle = {
  items: Map<string, EvidenceItem>;
  perQuestion: Map<string, string[]>;
  /** Canonical names of every skill the user recorded (the only technologies an answer may name besides cited evidence). */
  profileSkills: Set<string>;
  /** Names the answer may legitimately mention: the user's employers, institutions, project names and the target company. */
  allowedOrgs: string[];
  /** URLs the user recorded; the only ones an answer may contain. */
  allowedUrls: string[];
};

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function renderProject(p: Project): string {
  const lines = [`Project: ${p.name}`];
  if (p.description) lines.push(`Description: ${clip(p.description)}`);
  if (p.problem) lines.push(`Problem: ${clip(p.problem)}`);
  if (p.contribution) lines.push(`My contribution: ${clip(p.contribution)}`);
  if (p.technologies.length) lines.push(`Technologies: ${p.technologies.join(", ")}`);
  if (p.concepts.length) lines.push(`Concepts: ${p.concepts.join(", ")}`);
  for (const a of p.achievements.slice(0, 5)) lines.push(`Achievement: ${clip(a, 250)}`);
  for (const m of p.metrics.slice(0, 5)) lines.push(`Metric: ${clip(m.text, 200)} (source: ${clip(m.source, 120)})`);
  lines.push(`Deployed: ${p.liveUrl ? "yes, publicly deployed" : "no (not recorded as deployed)"}`);
  lines.push("Kind: academic or personal project, not employment");
  return lines.join("\n");
}

function renderExperience(e: Experience): string {
  const lines = [`Experience: ${e.position} at ${e.employer}${e.employmentType ? ` (${e.employmentType.replace("_", " ")})` : ""}`];
  if (e.startDate || e.endDate) lines.push(`Dates: ${e.startDate || "?"} to ${e.current ? "present" : e.endDate || "?"}`);
  for (const r of e.responsibilities.slice(0, 5)) lines.push(`Responsibility: ${clip(r, 250)}`);
  for (const a of e.achievements.slice(0, 5)) lines.push(`Achievement: ${clip(a, 250)}`);
  if (e.technologies.length) lines.push(`Technologies: ${e.technologies.join(", ")}`);
  for (const m of e.metrics.slice(0, 5)) lines.push(`Metric: ${clip(m.text, 200)} (source: ${clip(m.source, 120)})`);
  lines.push("Kind: employment");
  return lines.join("\n");
}

function renderEducation(e: Education, withGrade: boolean): string {
  const lines = [`Education: ${e.degree || "Degree"} in ${e.fieldOfStudy || "n/a"} at ${e.institution}`];
  if (e.expectedGraduationDate || e.graduationDate) lines.push(`Graduation: ${e.graduationDate || e.expectedGraduationDate}`);
  if (withGrade && e.grade) lines.push(`Grade: ${e.grade}${e.gradingScale ? ` / ${e.gradingScale}` : ""}`);
  if (e.coursework.length) lines.push(`Coursework: ${e.coursework.slice(0, 8).join(", ")}`);
  return lines.join("\n");
}

const EDU_ASKED = /\b(school|college|university|degree|major|study|studied|education|academic|gpa|cgpa|grade|course|coursework|graduat\w*)\b/i;
const GRADE_ASKED = /\b(gpa|cgpa|grade|marks|score)\b/i;

export function buildEvidence(profile: UserProfile, job: JobContext | null, questions: QuestionInput[], opts: { maxProjects?: number; maxExperience?: number } = {}): EvidenceBundle {
  const maxP = opts.maxProjects ?? 2;
  const maxX = opts.maxExperience ?? 1;
  const items = new Map<string, EvidenceItem>();
  const perQuestion = new Map<string, string[]>();

  const rank = job ? rankAgainstProfile(job, profile) : null;
  const byScore = <T extends { id: string }>(list: T[], ranked: { id: string; score: number }[] | undefined) => {
    const order = new Map((ranked ?? []).map((r, i) => [r.id, i]));
    return [...list].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  };
  const projects = byScore(profile.projects, rank?.projects);
  const experience = byScore(profile.experience, rank?.experience);

  const projId = new Map(projects.map((p, i) => [p.id, `P${i + 1}`]));
  const expId = new Map(experience.map((e, i) => [e.id, `X${i + 1}`]));
  const eduSorted = [...profile.education].sort((a, b) => (b.graduationDate || b.expectedGraduationDate || "").localeCompare(a.graduationDate || a.expectedGraduationDate || ""));

  const addProject = (p: Project): string => {
    const id = projId.get(p.id)!;
    if (!items.has(id)) {
      const text = renderProject(p);
      items.set(id, {
        id, kind: "project", title: `Project: ${p.name}`, text,
        technologies: [...new Set([...p.technologies, ...p.concepts, ...extractSkills(text)].map(canonicalSkill))],
        orgs: [p.name], deployed: Boolean(p.liveUrl), employment: false,
      });
    }
    return id;
  };
  const addExperience = (e: Experience): string => {
    const id = expId.get(e.id)!;
    if (!items.has(id)) {
      const text = renderExperience(e);
      items.set(id, {
        id, kind: "experience", title: `Experience: ${e.position} at ${e.employer}`, text,
        technologies: [...new Set([...e.technologies, ...extractSkills(text)].map(canonicalSkill))],
        orgs: [e.employer], deployed: /\b(production|deployed|live)\b/i.test(text), employment: true,
      });
    }
    return id;
  };
  const addEducation = (e: Education, grade: boolean): string => {
    const id = "E1";
    if (!items.has(id)) {
      items.set(id, { id, kind: "education", title: `Education: ${e.institution}`, text: renderEducation(e, grade), technologies: [], orgs: [e.institution], deployed: false, employment: false });
    }
    return id;
  };
  const addSkills = (names: string[]): string => {
    const id = "S1";
    if (!items.has(id)) {
      items.set(id, { id, kind: "skills", title: "Skills", text: `Skills: ${names.join(", ")}`, technologies: names.map(canonicalSkill), orgs: [], deployed: false, employment: false });
    }
    return id;
  };

  // Skills worth showing: the ones the posting asks for first, then the profile's own list.
  const wanted = new Set([...(job?.requiredSkills ?? []), ...(job?.preferredSkills ?? [])].map(canonicalSkill));
  const skillNames = [...profile.skills].sort((a, b) => Number(wanted.has(canonicalSkill(b.name))) - Number(wanted.has(canonicalSkill(a.name)))).slice(0, 12).map((s) => s.name);

  for (const q of questions) {
    const ids: string[] = [];
    const techs = q.technologies.map(canonicalSkill);
    if (q.category === "experience_with" && techs.length > 0) {
      for (const p of projects) if (techs.some((t) => p.technologies.concat(p.concepts).map(canonicalSkill).includes(t) || extractSkills(`${p.description} ${p.contribution}`).includes(t))) ids.push(addProject(p));
      for (const e of experience) if (techs.some((t) => e.technologies.map(canonicalSkill).includes(t) || extractSkills(e.responsibilities.concat(e.achievements).join(" ")).includes(t))) ids.push(addExperience(e));
      const listed = profile.skills.filter((s) => techs.includes(canonicalSkill(s.name))).map((s) => s.name);
      if (listed.length) ids.push(addSkills(listed));
    } else if (q.category === "describe_project" || q.category === "technical_challenge") {
      for (const p of projects.slice(0, maxP)) ids.push(addProject(p));
      if (q.category === "technical_challenge") for (const e of experience.slice(0, maxX)) ids.push(addExperience(e));
    } else {
      for (const p of projects.slice(0, maxP)) ids.push(addProject(p));
      for (const e of experience.slice(0, maxX)) ids.push(addExperience(e));
      if (skillNames.length) ids.push(addSkills(skillNames));
    }
    const wantsEdu = EDU_ASKED.test(q.text) || ["fit", "additional_info", "other"].includes(q.category);
    if (wantsEdu && eduSorted[0]) ids.push(addEducation(eduSorted[0], GRADE_ASKED.test(q.text)));
    perQuestion.set(q.id, [...new Set(ids)]);
  }

  const allowedOrgs = [
    ...profile.experience.map((e) => e.employer),
    ...profile.education.map((e) => e.institution),
    ...profile.projects.map((p) => p.name),
    ...profile.certifications.map((c) => c.issuer),
    profile.personal.city,
    profile.personal.state,
    profile.personal.country,
    ...(job?.company ? [job.company] : []),
  ].filter(Boolean);
  const allowedUrls = [
    profile.personal.linkedinUrl, profile.personal.githubUrl, profile.personal.portfolioUrl,
    ...profile.personal.otherLinks, ...profile.projects.flatMap((p) => [p.repoUrl, p.liveUrl]),
  ].filter(Boolean);

  return { items, perQuestion, profileSkills: new Set(profile.skills.map((s) => canonicalSkill(s.name))), allowedOrgs, allowedUrls };
}
