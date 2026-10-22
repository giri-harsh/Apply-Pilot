/** One flag for the content script: set by the CANCEL message, checked by every wait and loop. */
let cancelled = false;

export const isCancelled = (): boolean => cancelled;
export const setCancelled = (v: boolean): void => {
  cancelled = v;
};
