import { describe, expect, it, vi } from "vitest";
import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  ContentRequestSchema,
  handleValidated,
  sendValidated,
  type BackgroundRequest,
} from "@/shared/messages";

describe("message validation", () => {
  it("accepts well-formed requests and rejects malformed ones", () => {
    expect(BackgroundRequestSchema.safeParse({ kind: "START_RUN", tabId: 3 }).success).toBe(true);
    expect(BackgroundRequestSchema.safeParse({ kind: "START_RUN", tabId: "3" }).success).toBe(false);
    expect(BackgroundRequestSchema.safeParse({ kind: "EVAL", code: "alert(1)" }).success).toBe(false);
    expect(ContentRequestSchema.safeParse({ kind: "EXECUTE", plan: [{ bogus: true }] }).success).toBe(false);
  });

  it("handleValidated rejects invalid input without calling the handler", async () => {
    const handler = vi.fn();
    const res = await handleValidated({ kind: "NOPE" }, BackgroundRequestSchema, BackgroundResponseSchema, handler);
    expect(res).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("handleValidated refuses to emit a response that fails its schema", async () => {
    const res = await handleValidated(
      { kind: "GET_RUN", tabId: 1 },
      BackgroundRequestSchema,
      BackgroundResponseSchema,
      async () => ({ ok: true, run: { nonsense: 1 } }) as never,
    );
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("handleValidated converts a throwing handler into an error response", async () => {
    const res = await handleValidated(
      { kind: "GET_RUN", tabId: 1 },
      BackgroundRequestSchema,
      BackgroundResponseSchema,
      async () => {
        throw new Error("boom");
      },
    );
    expect(res).toEqual({ ok: false, code: "INTERNAL", message: "boom" });
  });

  it("sendValidated validates before sending and validates the reply", async () => {
    const send = vi.fn(async () => ({ ok: true, run: null }));
    await expect(
      sendValidated(send, BackgroundRequestSchema, BackgroundResponseSchema, { kind: "START_RUN", tabId: "x" } as unknown as BackgroundRequest),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();

    await expect(
      sendValidated(send, BackgroundRequestSchema, BackgroundResponseSchema, { kind: "GET_RUN", tabId: 1 }),
    ).resolves.toEqual({ ok: true, run: null });

    const bad = vi.fn(async () => ({ whatever: 1 }));
    await expect(
      sendValidated(bad, BackgroundRequestSchema, BackgroundResponseSchema, { kind: "GET_RUN", tabId: 1 }),
    ).rejects.toThrow("malformed");
  });
});
