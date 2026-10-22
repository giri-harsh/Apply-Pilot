import { describe, expect, it } from "vitest";
import { canonicalJson, hashMaster } from "@/resume/hash";
import { DEFAULT_LAYOUT, DEFAULT_RESUME_SETTINGS, LayoutConfigSchema, MasterResumeSchema, TailoredLineSchema, type MasterResume } from "@/resume/schema";
import { UploadContentRequestSchemas } from "@/resume/messages";
import { ContentRequestSchema } from "@/shared/messages";

const prov = { source: "resume_import_approved" as const, recordedAt: new Date(0).toISOString() };
const fact = (factId: string, text: string) => ({ factId, text, provenance: prov, lowConfidence: false });

export function sampleMaster(): MasterResume {
  return MasterResumeSchema.parse({
    schemaVersion: 1,
    masterId: "m1",
    contact: { name: fact("f_name", "Alex Example"), email: fact("f_email", "alex@example.test"), links: [] },
    entries: [
      {
        entryId: "e1",
        section: "experience",
        heading: fact("f1", "Acme Labs - Data Intern"),
        dates: "2025-06 - 2025-08",
        bullets: [fact("f2", "Wrote SQL reports for the analytics team")],
        technologies: ["SQL"],
      },
    ],
    skillGroups: [{ groupId: "g1", label: "Languages", items: [fact("f3", "Python"), fact("f4", "SQL")] }],
    confirmedAt: new Date(0).toISOString(),
  });
}

describe("Phase 7 contracts", () => {
  it("the master hash is stable under key order and changes when any fact changes", async () => {
    const a = sampleMaster();
    const reordered = JSON.parse(JSON.stringify(a)) as MasterResume;
    const b = { ...reordered, contact: { email: reordered.contact.email, name: reordered.contact.name, links: [] } } as MasterResume;
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await hashMaster(a)).toBe(await hashMaster(b));
    expect(await hashMaster(a)).toMatch(/^[0-9a-f]{64}$/);
    const c = structuredClone(a);
    c.entries[0]!.bullets[0]!.text += "!";
    expect(await hashMaster(c)).not.toBe(await hashMaster(a));
  });

  it("a tailored line without a source fact is invalid", () => {
    const base = { lineId: "l1", role: "bullet", text: "x", origin: "master" };
    expect(TailoredLineSchema.safeParse({ ...base, sourceFactIds: [] }).success).toBe(false);
    expect(TailoredLineSchema.safeParse({ ...base, sourceFactIds: ["f2"] }).success).toBe(true);
  });

  it("the layout config cannot go below the readability floors", () => {
    expect(LayoutConfigSchema.safeParse({ bodyPt: 9 }).success).toBe(false);
    expect(LayoutConfigSchema.safeParse({ marginIn: 0.4 }).success).toBe(false);
    expect(LayoutConfigSchema.safeParse({ lineHeight: 1.0 }).success).toBe(false);
    expect(DEFAULT_LAYOUT.pageLimit).toBe(1);
  });

  it("tailoring and cover letters are off by default", () => {
    expect(DEFAULT_RESUME_SETTINGS).toMatchObject({ tailoringEnabled: false, coverLetterEnabled: false, maxUploadBytes: 5_000_000, pageLimit: 1 });
  });

  it("upload messages are part of the content protocol and refuse oversize chunks", () => {
    expect(UploadContentRequestSchemas.length).toBe(5);
    expect(ContentRequestSchema.safeParse({ kind: "UPLOAD_LIST" }).success).toBe(true);
    expect(ContentRequestSchema.safeParse({ kind: "UPLOAD_CHUNK", transferId: "abcdefgh", index: 0, dataB64: "A".repeat(300_001) }).success).toBe(false);
  });
});
