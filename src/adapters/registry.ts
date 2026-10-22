import { FAKEATS } from "./fakeats";
import type { PortalAdapter } from "./types";

/** The local adapter registry (SPEC 10.3). Adapters are code in this repository, versioned and tested; nothing is downloaded. */
export const ADAPTERS: readonly PortalAdapter[] = [FAKEATS];
