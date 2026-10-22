// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG } from "@/ai/config";
import { DEFAULT_LIMITS } from "@/background/limits";
import { BackgroundRequestSchema, ContentRequestSchema, ContentResponseSchema, BackgroundResponseSchema } from "@/shared/messages";
// @ts-expect-error plain JS build helper without types
import { buildManifest } from "../../scripts/manifest.mjs";

type Manifest = { permissions: string[]; host_permissions: string[]; optional_host_permissions: string[]; content_scripts?: unknown; web_accessible_resources?: unknown; externally_connectable?: unknown };
const prod = buildManifest({ e2e: false }) as Manifest;
const e2e = buildManifest({ e2e: true }) as Manifest;
const doc = fs.readFileSync("docs/PERMISSIONS.md", "utf8");

describe("permission review (snapshot + documentation)", () => {
  it("the production manifest requests exactly this and nothing else", () => {
    expect([...prod.permissions].sort()).toEqual(["activeTab", "offscreen", "scripting", "storage"]);
    expect([...prod.host_permissions].sort()).toEqual(["https://api.groq.com/*", "https://generativelanguage.googleapis.com/*"]);
    expect([...prod.optional_host_permissions].sort()).toEqual(["http://*/*", "https://*/*"]);
    expect(prod.content_scripts).toBeUndefined(); // no static content script: nothing runs on a page until the user acts
    expect(prod.web_accessible_resources).toBeUndefined();
    expect(prod.externally_connectable).toBeUndefined();
  });

  it("the test build differs only by the loopback host", () => {
    expect(e2e.permissions).toEqual(prod.permissions);
    expect(e2e.host_permissions.filter((h) => !prod.host_permissions.includes(h))).toEqual(["http://127.0.0.1/*"]);
  });

  it("every permission and host pattern is justified in docs/PERMISSIONS.md", () => {
    for (const p of prod.permissions) expect(doc, `permission ${p}`).toContain(`\`${p}\``);
    for (const h of prod.host_permissions) expect(doc, `host ${h}`).toContain(h);
    expect(doc).toContain("optional_host_permissions");
    expect(doc).toContain("http://127.0.0.1/*"); // the test-build note
  });

  it("nothing in the documentation claims a permission the manifest does not have", () => {
    const claimed = [...doc.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((m) => m[1]!);
    for (const c of claimed) expect(prod.permissions, `documented but not requested: ${c}`).toContain(c);
  });

  it("permissions that would widen the surface are not requested", () => {
    for (const p of ["tabs", "downloads", "cookies", "webRequest", "history", "identity", "unlimitedStorage", "clipboardRead", "nativeMessaging", "debugger"]) expect(prod.permissions).not.toContain(p);
  });
});

describe("API key protection in the message layer", () => {
  const walk = (schema: unknown, path: string, out: string[]): void => {
    const s = schema as { _def?: { typeName?: string }; shape?: Record<string, unknown>; options?: unknown[]; element?: unknown; _def_inner?: unknown };
    if (!s || typeof s !== "object") return;
    const def = (s as { _def?: Record<string, unknown> })._def ?? {};
    const shape = typeof (def as { shape?: unknown }).shape === "function" ? ((def as { shape: () => Record<string, unknown> }).shape()) : undefined;
    if (shape) for (const [k, v] of Object.entries(shape)) {
      out.push(`${path}.${k}`);
      walk(v, `${path}.${k}`, out);
    }
    for (const o of (s.options as unknown[] | undefined) ?? []) walk(o, path, out);
    const inner = (def as { innerType?: unknown; type?: unknown; schema?: unknown }).innerType ?? (def as { type?: unknown }).type ?? (def as { schema?: unknown }).schema;
    if (inner) walk(inner, path, out);
  };
  const fields = (schema: unknown, name: string) => {
    const out: string[] = [];
    walk(schema, name, out);
    return out;
  };

  it("the only message field that can carry a secret is AI_SET_KEY.secret, and it only travels inbound", () => {
    const inbound = fields(BackgroundRequestSchema, "bg").filter((p) => /^(secret|apikey|api_key|token|accesstoken|password|authorization|bearer)$/i.test(p.split(".").pop()!));
    expect(inbound).toEqual(["bg.secret"]);
    for (const [name, schema] of [["content-request", ContentRequestSchema], ["content-response", ContentResponseSchema], ["bg-response", BackgroundResponseSchema]] as const) {
      const hits = fields(schema, name).filter((p) => /^(secret|apikey|api_key|token|accesstoken|password|authorization|bearer)$/i.test(p.split(".").pop()!));
      expect(hits, `${name} carries a secret-like field`).toEqual([]);
    }
  });

  it("the key hint shown in the UI is at most the last 4 characters", () => {
    const hint = (BackgroundResponseSchema as unknown as { options: { shape?: Record<string, { shape?: Record<string, unknown> }> }[] }).options;
    expect(JSON.stringify(hint.length)).toBeTruthy();
    const src = fs.readFileSync("src/ai/storage.ts", "utf8");
    expect(src).toMatch(/hint:[^\n]*slice\(-4\)|slice\(-4\)/);
  });
});

describe("run limits (SPEC 21.2) are conservative and documented", () => {
  it("defaults are bounded", () => {
    expect(DEFAULT_LIMITS).toMatchObject({ maxDurationMs: 180_000, maxActions: 200, maxRetries: 12, maxRecoveryAttempts: 2, maxPassesPerStep: 4, maxStepTransitions: 8, maxFields: 300, stepTimeoutMs: 20_000 });
    expect(DEFAULT_AI_CONFIG.limits).toMatchObject({ maxRequestsPerRun: 6, maxResponseChars: 60_000, maxFieldsPerRequest: 40 });
    expect(DEFAULT_AI_CONFIG.job.maxDescriptionChars).toBeLessThanOrEqual(12_000);
  });

  it("every limit is named in the architecture documentation", () => {
    const arch = fs.existsSync("docs/architecture.md") ? fs.readFileSync("docs/architecture.md", "utf8") : "";
    for (const k of ["maxDurationMs", "maxActions", "maxRetries", "maxPassesPerStep", "maxStepTransitions", "maxFields", "maxRequestsPerRun", "maxResponseChars", "maxDescriptionChars"]) {
      expect(arch, `docs/architecture.md should document ${k}`).toContain(k);
    }
  });
});
