import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPortalServer } from "./server";

let close: (() => Promise<void>) | undefined;

export default async function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const srv = await startPortalServer(path.join(root, "tests/synthetic-portals"), path.join(root, "dist-portals"));
  process.env.PORTAL_BASE_URL = srv.url; // inherited by Playwright workers
  close = srv.close;
  return async () => {
    await close?.();
  };
}
