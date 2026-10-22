import type { KVStore } from "@/ai/storage";
import type { FormField } from "@/shared/form";
import {
  LEARNED_KEY,
  LEARNING_SETTINGS_KEY,
  LearnedStrategySchema,
  LearningSettingsSchema,
  applyEvents,
  fingerprintHash,
  matchStrategies,
  structureOf,
  type LearnEvent,
  type LearnedStrategy,
} from "./strategies";

/** What the run manager gets for one page: strategies to try first, each with an id so the outcome can be reported back. */
export type LearnedHints = {
  /** field fingerprint -> learned mapping to use instead of asking the AI */
  mappings: Map<string, { id: string; semanticType: string; profileKey: string }>;
  /** field fingerprint -> learned input strategy */
  inputStrategies: Map<string, { id: string; strategy: "keyboard" }>;
  structure: string[];
  host: string;
};

export interface LearningPort {
  forPage(input: { url: string; fields: FormField[] }): Promise<LearnedHints>;
  record(events: LearnEvent[]): Promise<void>;
  isEnabled(): Promise<boolean>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const emptyHints = (host = ""): LearnedHints => ({ mappings: new Map(), inputStrategies: new Map(), structure: [], host });

export class LearningService implements LearningPort {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private deps: { store: KVStore; now(): number; newId(): string }) {}

  async isEnabled(): Promise<boolean> {
    const raw = (await this.deps.store.get(LEARNING_SETTINGS_KEY))[LEARNING_SETTINGS_KEY];
    return LearningSettingsSchema.parse(raw ?? {}).enabled;
  }

  async list(): Promise<LearnedStrategy[]> {
    const raw = (await this.deps.store.get(LEARNED_KEY))[LEARNED_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r) => {
      const p = LearnedStrategySchema.safeParse(r);
      return p.success ? [p.data] : []; // a record that no longer validates is ignored
    });
  }

  async forPage(input: { url: string; fields: FormField[] }): Promise<LearnedHints> {
    const host = hostOf(input.url);
    if (!host || !(await this.isEnabled())) return emptyHints(host);
    const structure = structureOf(input.fields);
    const hints = emptyHints(host);
    hints.structure = structure;
    const byPattern = new Map(input.fields.map((f) => [fingerprintHash(f.fingerprint), f.fingerprint]));
    for (const s of matchStrategies(await this.list(), host, structure, this.deps.now())) {
      const fp = byPattern.get(s.pattern);
      if (!fp) continue; // the field it was learned for is not on this page
      if (s.kind === "field_mapping" && s.value.semanticType && s.value.profileKey) hints.mappings.set(fp, { id: s.id, semanticType: s.value.semanticType, profileKey: s.value.profileKey });
      if (s.kind === "input_strategy" && s.value.inputStrategy) hints.inputStrategies.set(fp, { id: s.id, strategy: s.value.inputStrategy });
    }
    return hints;
  }

  /** Serialised read-modify-write. A disabled memory records nothing. */
  record(events: LearnEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    const next = this.chain.then(async () => {
      if (!(await this.isEnabled())) return;
      const updated = applyEvents(await this.list(), events, this.deps.now(), this.deps.newId);
      await this.deps.store.set({ [LEARNED_KEY]: updated });
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  async deleteOne(id: string): Promise<void> {
    await this.deps.store.set({ [LEARNED_KEY]: (await this.list()).filter((s) => s.id !== id) });
  }
  async clearAll(): Promise<void> {
    await this.deps.store.set({ [LEARNED_KEY]: [] });
  }
}
