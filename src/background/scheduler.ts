import { Abort } from "./abort";

/**
 * One cancellable scheduler for everything time-based in a run (backoff, polling for navigation, settling).
 * Stop calls `cancelAll()`: every pending sleep rejects with Abort and no timer survives, so nothing can fire
 * after the user pressed Stop (SPEC 5.2 / failure case 6).
 */
export class Scheduler {
  private pendingTimers = new Map<number, { timer: ReturnType<typeof setTimeout>; reject: (e: Error) => void }>();
  private nextId = 1;
  private cancelled = false;

  get pending(): number {
    return this.pendingTimers.size;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  sleep(ms: number): Promise<void> {
    if (this.cancelled) return Promise.reject(new Abort("Scheduler cancelled"));
    return new Promise<void>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pendingTimers.delete(id);
        resolve();
      }, ms);
      this.pendingTimers.set(id, { timer, reject });
    });
  }

  /** Polls `cond` every `stepMs` until it is true or `timeoutMs` passes. Returns the last value of `cond`. */
  async waitUntil(cond: () => Promise<boolean> | boolean, timeoutMs: number, stepMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (await cond()) return true;
      if (Date.now() >= end) return false;
      await this.sleep(stepMs);
    }
  }

  cancelAll(): void {
    this.cancelled = true;
    for (const { timer, reject } of this.pendingTimers.values()) {
      clearTimeout(timer);
      reject(new Abort("Scheduler cancelled"));
    }
    this.pendingTimers.clear();
  }
}
