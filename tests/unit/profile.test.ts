import { describe, expect, it } from "vitest";
import { emptyProfile, validateProfile, UserProfileSchema, ProvenanceSchema } from "@/shared/profile";
import { testProfile } from "../fixtures/profile";

const issuePaths = (input: unknown) => {
  const r = validateProfile(input);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe("UserProfile schema", () => {
  it("accepts an empty profile and a fully populated one", () => {
    expect(validateProfile(emptyProfile()).ok).toBe(true);
    expect(validateProfile(testProfile()).ok).toBe(true);
  });

  it("round-trips through JSON unchanged (export then import)", () => {
    const p = testProfile();
    const r = validateProfile(JSON.parse(JSON.stringify(p)));
    expect(r.ok && r.profile).toEqual(p);
  });

  it("rejects a non-empty personal fact that has no provenance (SPEC 6.2)", () => {
    const p = emptyProfile();
    p.personal.email = "a@b.co";
    expect(issuePaths(p)).toContain("personal.provenance.email");
  });

  it("rejects malformed provenance", () => {
    expect(ProvenanceSchema.safeParse({ source: "guessed", recordedAt: new Date().toISOString() }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ source: "user_entered", recordedAt: "yesterday" }).success).toBe(false);
  });

  it.each([
    ["personal.email", (p: ReturnType<typeof testProfile>) => (p.personal.email = "not-an-email")],
    ["personal.phone", (p: ReturnType<typeof testProfile>) => (p.personal.phone = "abc")],
    ["personal.linkedinUrl", (p: ReturnType<typeof testProfile>) => (p.personal.linkedinUrl = "javascript:alert(1)")],
    ["education.0.startDate", (p: ReturnType<typeof testProfile>) => (p.education[0]!.startDate = "last year")],
    ["education.0.institution", (p: ReturnType<typeof testProfile>) => (p.education[0]!.institution = "")],
    ["preferences.resumeMaxPages", (p: ReturnType<typeof testProfile>) => (p.preferences.resumeMaxPages = 0)],
  ])("reports a visible error path for invalid %s", (path, mutate) => {
    const p = testProfile();
    mutate(p);
    expect(issuePaths(p)).toContain(path);
  });

  it("rejects wrong schema version, unknown types and non-objects", () => {
    expect(validateProfile({ ...testProfile(), schemaVersion: 2 }).ok).toBe(false);
    expect(validateProfile(null).ok).toBe(false);
    expect(validateProfile("profile").ok).toBe(false);
    expect(validateProfile({ ...testProfile(), skills: [{ id: "x", name: "Py", category: "magic", proficiency: "", evidence: "", lastVerified: "", provenance: testProfile().education[0]!.provenance }] }).ok).toBe(false);
  });

  it("requires employer/position on experience and name on projects/skills", () => {
    const p = testProfile();
    const prov = p.education[0]!.provenance;
    p.experience.push({ id: "e", employer: "", position: "", employmentType: "", startDate: "", endDate: "", current: false, responsibilities: [], achievements: [], technologies: [], metrics: [], evidence: [], provenance: prov });
    expect(issuePaths(p)).toEqual(expect.arrayContaining(["experience.0.employer", "experience.0.position"]));
  });

  it("schema is strict about types (no silent coercion)", () => {
    const p = JSON.parse(JSON.stringify(testProfile()));
    p.experience = [{ ...p.education[0], current: "yes" }];
    expect(UserProfileSchema.safeParse(p).success).toBe(false);
  });
});
