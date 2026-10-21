import { useCallback, useEffect, useState } from "react";
import {
  BackgroundRequestSchema,
  BackgroundResponseSchema,
  sendValidated,
  type AiStatus,
  type BackgroundRequest,
  type BackgroundResponse,
} from "@/shared/messages";
import { PROVIDER_IDS, type ProviderId } from "@/ai/config";

const send = (req: BackgroundRequest): Promise<BackgroundResponse> =>
  sendValidated((m) => chrome.runtime.sendMessage(m), BackgroundRequestSchema, BackgroundResponseSchema, req);

const NAMES: Record<ProviderId, string> = { gemini: "Gemini", groq: "Groq" };

/**
 * AI providers. Keys are typed here, sent once to the service worker, and never read back: the UI only
 * ever learns "configured" plus the last four characters.
 */
export function AiPanel() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({ gemini: "", groq: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const r = await send({ kind: "AI_GET_STATUS" });
    if (r.ok && "kind" in r && r.kind === "ai_status") setStatus(r.status);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const note = (k: string, v: string) => setNotes((n) => ({ ...n, [k]: v }));

  if (!status) return <p>Loading...</p>;

  const saveSettings = async (aiEnabled: boolean, providerOrder: ProviderId[]) => {
    setStatus((s) => (s ? { ...s, aiEnabled, providerOrder, mode: !aiEnabled ? "off" : s.mode === "off" ? "ready" : s.mode } : s)); // optimistic
    const r = await send({ kind: "AI_SET_SETTINGS", aiEnabled, providerOrder });
    note("settings", r.ok ? "Saved" : "message" in r ? r.message : "Not saved");
    await refresh();
  };

  const saveKey = async (p: ProviderId) => {
    const r = await send({ kind: "AI_SET_KEY", provider: p, secret: drafts[p] });
    setDrafts((d) => ({ ...d, [p]: "" })); // do not keep the secret in UI state
    note(`key.${p}`, r.ok ? "Key saved" : "message" in r ? r.message : "Not saved");
    await refresh();
  };

  const test = async (p: ProviderId) => {
    note(`test.${p}`, "Testing...");
    const r = await send({ kind: "AI_TEST_CONNECTION", provider: p });
    if (r.ok && "kind" in r && r.kind === "ai_test") {
      const t = r.result;
      note(`test.${p}`, t.success ? `Connected (${t.latencyMs} ms)` : `Failed: ${t.outcome}`);
    } else note(`test.${p}`, "Failed: no reply");
    await refresh();
  };

  const order = status.providerOrder;
  return (
    <section data-testid="ai-panel">
      <p>
        With AI off (the default) ApplyPilot fills only what its rules can verify and makes no network calls. With AI on, only fields the rules
        could not place are sent, as short label descriptions. Your profile values, resume and API keys are never sent as content.
      </p>
      <label>
        <input
          type="checkbox"
          name="ai.enabled"
          checked={status.aiEnabled}
          onChange={(e) => void saveSettings(e.target.checked, order)}
        />{" "}
        Use AI to understand unfamiliar form fields
      </label>
      <p data-testid="ai-mode" className="muted">
        Mode: {status.mode === "off" ? "Off" : status.mode === "not_configured" ? "Not configured (add a key)" : "Ready"}
      </p>

      <div className="field">
        <label htmlFor="ai-order">Provider order</label>
        <select id="ai-order" name="ai.order" value={order.join(",")} onChange={(e) => void saveSettings(status.aiEnabled, e.target.value.split(",") as ProviderId[])}>
          <option value="gemini,groq">Gemini first, Groq as fallback</option>
          <option value="groq,gemini">Groq first, Gemini as fallback</option>
        </select>
        <span data-testid="ai-settings-note" className="muted">{notes.settings ?? ""}</span>
      </div>

      {PROVIDER_IDS.map((p) => (
        <fieldset key={p}>
          <legend>{NAMES[p]}</legend>
          <p className="muted">
            Model: <code>{status.models[p]}</code>. Status: {status.keys[p]?.configured ? `key saved (${status.keys[p]!.hint})` : "no key"}
          </p>
          <div className="field">
            <label htmlFor={`key-${p}`}>{NAMES[p]} API key</label>
            <input
              id={`key-${p}`}
              name={`ai.key.${p}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={drafts[p]}
              placeholder={status.keys[p]?.configured ? "Saved. Enter a new key to replace it" : "Paste key"}
              onChange={(e) => setDrafts((d) => ({ ...d, [p]: e.target.value }))}
            />
          </div>
          <button data-testid={`save-key-${p}`} disabled={drafts[p].trim() === ""} onClick={() => void saveKey(p)}>Save key</button>{" "}
          <button data-testid={`clear-key-${p}`} className="danger" disabled={!status.keys[p]?.configured} onClick={() => void send({ kind: "AI_CLEAR_KEY", provider: p }).then(refresh)}>Remove key</button>{" "}
          <button data-testid={`test-${p}`} disabled={!status.keys[p]?.configured} onClick={() => void test(p)}>Test connection</button>
          <p role="status" data-testid={`ai-note-${p}`}>{notes[`key.${p}`] ?? ""} {notes[`test.${p}`] ?? ""}</p>
        </fieldset>
      ))}

      <p className="muted">
        Requests logged: {status.usage.requests} (last: {status.usage.lastOutcome ?? "none"}). Cached field mappings: {status.cacheEntries}.
      </p>
      <button data-testid="clear-cache" onClick={() => void send({ kind: "AI_CLEAR_CACHE" }).then(refresh)}>Clear mapping cache</button>
    </section>
  );
}
