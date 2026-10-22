import { useCallback, useEffect, useMemo, useState } from "react";
import { chromeStore } from "@/ai/storage";
import { LearningService } from "@/learning/service";
import { LEARNING_SETTINGS_KEY, LearningSettingsSchema, type LearnedStrategy } from "@/learning/strategies";

/** Learned strategies: verified successes on a portal, reused only on a matching page structure. View, delete, or switch off. */
export function LearnedPanel() {
  const svc = useMemo(() => new LearningService({ store: chromeStore(), now: () => Date.now(), newId: () => crypto.randomUUID() }), []);
  const [rows, setRows] = useState<LearnedStrategy[]>([]);
  const [enabled, setEnabled] = useState(true);

  const refresh = useCallback(async () => {
    setRows(await svc.list());
    setEnabled(LearningSettingsSchema.parse((await chromeStore().get(LEARNING_SETTINGS_KEY))[LEARNING_SETTINGS_KEY] ?? {}).enabled);
  }, [svc]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const describe = (s: LearnedStrategy) =>
    s.kind === "field_mapping" ? `a field here is "${s.value.semanticType}" (profile key ${s.value.profileKey})` : `a field here needs the ${s.value.inputStrategy} input strategy`;

  return (
    <section data-testid="learned">
      <h2>Learned strategies</h2>
      <p>
        When something worked and was verified on a portal, ApplyPilot remembers the pattern (never your values) and tries it first next time, only if the page structure
        matches. A strategy that fails is demoted, then removed.
      </p>
      <label>
        <input type="checkbox" data-testid="learning-toggle" checked={enabled} onChange={(e) => void chrome.storage.local.set({ [LEARNING_SETTINGS_KEY]: { enabled: e.target.checked } }).then(refresh)} /> Learning is on
      </label>
      <div className="field">
        <button className="danger" data-testid="learned-delete-all" disabled={rows.length === 0} onClick={() => void svc.clearAll().then(refresh)}>
          Delete all
        </button>
      </div>
      {rows.length === 0 && <p className="muted" data-testid="no-learned">Nothing learned yet.</p>}
      <ul>
        {rows.map((s) => (
          <li key={s.id} data-testid="learned-row" data-kind={s.kind}>
            {s.host}: {describe(s)}. Confidence {Math.round(s.confidence * 100)}%, {s.successes} verified, {s.failures} failed, last verified {new Date(s.lastVerifiedAt).toISOString().slice(0, 10)}{" "}
            <button className="danger" data-testid="learned-delete" onClick={() => void svc.deleteOne(s.id).then(refresh)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
