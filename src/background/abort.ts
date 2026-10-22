/** Thrown to unwind a run that was cancelled or replaced: nothing further may be scheduled. */
export class Abort extends Error {
  constructor(message = "Run is no longer active") {
    super(message);
    this.name = "Abort";
  }
}

/** A run limit was reached (SPEC 21.2). The run stops as BLOCKED with this reason; it never loops on. */
export const LIMIT_KINDS = ["duration", "actions", "retries", "passes", "steps", "fields"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

export class LimitReached extends Error {
  constructor(readonly limit: LimitKind, message: string) {
    super(message);
    this.name = "LimitReached";
  }
}
