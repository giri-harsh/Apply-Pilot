import { PROFILE_SCHEMA_VERSION, UserProfileSchema, validateProfile, type ProfileIssue, type UserProfile } from "./profile";
import { RUNS_STORAGE_KEY, RunsMapSchema, type RunsMap } from "./run";

/** Profile and run state live under separate keys so unrelated data is never merged (SPEC 20.2). */
export const PROFILE_STORAGE_KEY = "applypilot.profile.v1";

export async function loadProfile(): Promise<UserProfile | null> {
  const got = await chrome.storage.local.get(PROFILE_STORAGE_KEY);
  const raw = got[PROFILE_STORAGE_KEY];
  if (raw === undefined) return null;
  const r = UserProfileSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export type SaveProfileResult = { ok: true } | { ok: false; issues: ProfileIssue[] };

/** Only schema-valid profiles are ever written. */
export async function saveProfile(profile: unknown): Promise<SaveProfileResult> {
  const v = validateProfile(profile);
  if (!v.ok) return v;
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: v.profile });
  return { ok: true };
}

export async function deleteProfile(): Promise<void> {
  await chrome.storage.local.remove(PROFILE_STORAGE_KEY);
}

export async function loadRuns(): Promise<RunsMap> {
  const got = await chrome.storage.local.get(RUNS_STORAGE_KEY);
  const r = RunsMapSchema.safeParse(got[RUNS_STORAGE_KEY] ?? {});
  return r.success ? r.data : {};
}

export async function saveRuns(runs: RunsMap): Promise<void> {
  await chrome.storage.local.set({ [RUNS_STORAGE_KEY]: runs });
}

export { PROFILE_SCHEMA_VERSION };
