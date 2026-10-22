import { isCancelled } from "./cancel";

/**
 * SPEC 12.10: wait until the form stops changing. A debounced MutationObserver on the document resolves once no
 * relevant mutation has arrived for `quietMs` (or `maxMs` has passed). The observer only exists while waiting, so
 * the executor's own writes (which happen with no observer attached) can never re-trigger observation, and there is
 * no continuous high-frequency rescanning.
 */
export type StabilityResult = { mutations: number; waitedMs: number; timedOut: boolean };

export function waitForStable(doc: Document, quietMs: number, maxMs: number): Promise<StabilityResult> {
  return new Promise((resolve) => {
    const view = doc.defaultView;
    const MO = view?.MutationObserver ?? MutationObserver;
    const started = Date.now();
    let mutations = 0;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const done = (timedOut: boolean) => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      clearInterval(cancelTimer);
      resolve({ mutations, waitedMs: Date.now() - started, timedOut });
    };
    const observer = new MO((records) => {
      // Only structural or visibility-relevant changes count; text-node churn inside script-driven counters does not.
      const relevant = records.some(
        (r) =>
          r.type === "childList" ||
          (r.type === "attributes" && ["hidden", "disabled", "style", "class", "aria-hidden", "aria-expanded", "open"].includes(r.attributeName ?? "")),
      );
      if (!relevant) return;
      mutations += records.length;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => done(false), quietMs);
    });
    const maxTimer = setTimeout(() => done(true), maxMs);
    const cancelTimer = setInterval(() => {
      if (isCancelled()) done(false);
    }, 50);
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "disabled", "style", "class", "aria-hidden", "aria-expanded", "open"] });
    quietTimer = setTimeout(() => done(false), quietMs);
  });
}
