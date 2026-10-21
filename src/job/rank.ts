import type { UserProfile } from "@/shared/profile";
import type { JobContext, MatchReport } from "./schema";
import { canonicalSkill, extractSkills } from "./skills";

type Source = { kind: "skill" | "project" | "experience"; id: string; name: string };

/** Canonical skill -> where the profile evidences it. Only what the user actually recorded counts. */
export function profileSkillIndex(profile: UserProfile): Map<string, Source[]> {
  const idx = new Map<string, Source[]>();
  const add = (raw: string, src: Source) => {
    const key = canonicalSkill(raw);
    if (!key) return;
    idx.set(key, [...(idx.get(key) ?? []), src]);
  };
  for (const s of profile.skills) add(s.name, { kind: "skill", id: s.id, name: s.name });
  for (const p of profile.projects) {
    for (const t of [...p.technologies, ...p.concepts]) add(t, { kind: "project", id: p.id, name: p.name });
    // Skills named in the project's own description count too, since the user wrote that text.
    for (const t of extractSkills(`${p.description}\n${p.contribution}`)) add(t, { kind: "project", id: p.id, name: p.name });
  }
  for (const e of profile.experience) {
    const label = `${e.position} @ ${e.employer}`;
    for (const t of e.technologies) add(t, { kind: "experience", id: e.id, name: label });
    for (const t of extractSkills(e.responsibilities.concat(e.achievements).join("\n"))) add(t, { kind: "experience", id: e.id, name: label });
  }
  return idx;
}

/** Lowest to highest. A posting that says "Bachelor's or Master's" is satisfied by either, or by anything higher. */
const LEVELS: { level: string; job: RegExp; profile: RegExp }[] = [
  { level: "bachelor's", job: /\b(bachelor'?s?|b\.?\s?tech|b\.?\s?sc|b\.?\s?e\b|undergraduate)\b/i, profile: /\b(bachelor|b\.?\s?tech|b\.?\s?sc|b\.?\s?e\b|b\.?\s?s\b)/i },
  { level: "master's", job: /\b(master'?s?|m\.?\s?tech|m\.?\s?sc|\bms\b|mba)\b/i, profile: /\b(master|m\.?\s?tech|m\.?\s?sc|\bms\b|mba)/i },
  { level: "doctorate", job: /\b(ph\.?d|doctorate)\b/i, profile: /\b(ph\.?d|doctor)/i },
];

const WEIGHTS = { required: 0.35, preferred: 0.1, projects: 0.2, experience: 0.1, education: 0.1, role: 0.15 } as const;
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !["and", "the", "for", "intern", "with"].includes(w)));

/**
 * SPEC 8.3: a transparent relevance score from skill overlap between the posting and the verified profile.
 * Every number has a stated weight and a note; nothing here predicts a hiring outcome.
 */
export function rankAgainstProfile(job: JobContext, profile: UserProfile): MatchReport {
  const idx = profileSkillIndex(profile);
  const required = job.requiredSkills.map(canonicalSkill);
  const preferred = job.preferredSkills.map(canonicalSkill);
  const mentioned = job.relevantKeywords.map(canonicalSkill).filter((k) => !required.includes(k) && !preferred.includes(k));

  const has = (k: string) => idx.has(k);
  const matchedRequired = required.filter(has);
  const matchedPreferred = preferred.filter(has);
  const frac = (n: number, d: number) => (d === 0 ? null : n / d);

  // Weighted relevance of a record = weight of the job's skills it evidences / total weight available.
  const W = { required: 2, preferred: 1, mentioned: 0.5 };
  const total = required.length * W.required + preferred.length * W.preferred + mentioned.length * W.mentioned;
  const rankKind = (kind: "project" | "experience") => {
    const records = new Map<string, { name: string; score: number; evidence: string[] }>();
    const consider = (skills: string[], weight: number, tag: string) => {
      for (const k of skills) {
        for (const src of idx.get(k) ?? []) {
          if (src.kind !== kind) continue;
          const r = records.get(src.id) ?? { name: src.name, score: 0, evidence: [] };
          if (!r.evidence.some((e) => e.startsWith(`Uses ${k} `))) {
            r.score += weight;
            r.evidence.push(`Uses ${k} (${tag})`);
          }
          records.set(src.id, r);
        }
      }
    };
    consider(required, W.required, "required");
    consider(preferred, W.preferred, "preferred");
    consider(mentioned, W.mentioned, "mentioned");
    return [...records.entries()]
      .map(([id, r]) => ({ id, name: r.name, score: total === 0 ? 0 : Math.min(1, r.score / total), evidence: r.evidence.slice(0, 12) }))
      .sort((a, b) => b.score - a.score);
  };
  const projects = rankKind("project");
  const experience = rankKind("experience");

  // Education compatibility
  const eduText = job.educationRequirements.join(" ");
  const wantedIdx = LEVELS.map((l, i) => (l.job.test(eduText) ? i : -1)).filter((i) => i >= 0);
  let education: MatchReport["education"] = { status: "unknown", evidence: [] };
  if (wantedIdx.length > 0) {
    const need = Math.min(...wantedIdx);
    const held = profile.education.map((e) => ({ e, idx: LEVELS.map((l, i) => (l.profile.test(`${e.degree}`) ? i : -1)).filter((i) => i >= 0) })).filter((x) => x.idx.length > 0);
    if (held.length > 0) {
      const best = held.reduce((a, b) => (Math.max(...b.idx) > Math.max(...a.idx) ? b : a));
      education =
        Math.max(...best.idx) >= need
          ? { status: "compatible", evidence: [`Posting asks for at least a ${LEVELS[need]!.level} level; profile lists ${best.e.degree}`] }
          : { status: "mismatch", evidence: [`Posting asks for at least a ${LEVELS[need]!.level} level; the highest degree in the profile is ${best.e.degree}`] };
    }
  }

  // Role alignment: shared words between the title and the user's stated role categories.
  const titleTokens = tokens(job.jobTitle ?? "");
  const prefTokens = tokens(profile.preferences.roleCategories.join(" "));
  const shared = [...titleTokens].filter((t) => prefTokens.has(t));
  const role = titleTokens.size === 0 || prefTokens.size === 0 ? null : Math.min(1, shared.length / Math.min(titleTokens.size, prefTokens.size));

  const eduValue = education.status === "compatible" ? 1 : education.status === "mismatch" ? 0 : null;
  const components = [
    { component: "Required skills covered", weight: WEIGHTS.required, value: frac(matchedRequired.length, required.length), note: required.length ? `${matchedRequired.length} of ${required.length} required skills appear in your profile` : "The posting lists no required skills I could identify" },
    { component: "Preferred skills covered", weight: WEIGHTS.preferred, value: frac(matchedPreferred.length, preferred.length), note: preferred.length ? `${matchedPreferred.length} of ${preferred.length} preferred skills appear in your profile` : "No preferred skills identified" },
    { component: "Best project relevance", weight: WEIGHTS.projects, value: projects[0] ? projects[0].score : profile.projects.length ? 0 : null, note: projects[0] ? `Strongest: ${projects[0].name}` : "No project evidences the posting's skills" },
    { component: "Best experience relevance", weight: WEIGHTS.experience, value: experience[0] ? experience[0].score : profile.experience.length ? 0 : null, note: experience[0] ? `Strongest: ${experience[0].name}` : "No experience evidences the posting's skills" },
    { component: "Education compatibility", weight: WEIGHTS.education, value: eduValue, note: education.evidence[0] ?? "The posting states no degree level, or the profile has no education" },
    { component: "Role alignment", weight: WEIGHTS.role, value: role, note: shared.length ? `Shared with your preferred roles: ${shared.join(", ")}` : "No overlap with your stated role categories (or none stated)" },
  ].map((c) => ({ ...c, value: c.value === null ? null : Math.round(c.value * 1000) / 1000 }));

  const known = components.filter((c) => c.value !== null);
  const weightSum = known.reduce((s, c) => s + c.weight, 0);
  const overall = known.length === 0 || weightSum === 0 ? null : Math.round((known.reduce((s, c) => s + c.weight * (c.value as number), 0) / weightSum) * 100);

  return {
    overall,
    components,
    matchedRequiredSkills: matchedRequired,
    missingRequiredSkills: required.filter((k) => !has(k)),
    matchedPreferredSkills: matchedPreferred,
    projects: projects.slice(0, 5),
    experience: experience.slice(0, 5),
    education,
    eligibilityFlags: job.eligibilityNotes.map((n) => `Review yourself: ${n}`),
    disclaimer: "A decision aid based on skill overlap with your recorded profile. It is not a prediction of any hiring outcome.",
  };
}
