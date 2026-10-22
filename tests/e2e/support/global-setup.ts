import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPortalServer } from "./server";

let closers: (() => Promise<void>)[] = [];

export default async function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const dirs = [path.join(root, "tests/synthetic-portals"), path.join(root, "dist-portals")] as const;
  const srv = await startPortalServer(...dirs);
  // A second server on another port is a second origin: the cross-origin iframe portal loads its frame from here.
  const frame = await startPortalServer(...dirs);
  process.env.PORTAL_BASE_URL = srv.url; // inherited by Playwright workers
  process.env.PORTAL_FRAME_URL = frame.url;
  closers = [srv.close, frame.close];
  return async () => {
    await Promise.all(closers.map((c) => c()));
  };
}
