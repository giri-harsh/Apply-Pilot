import { useCallback, useEffect, useState } from "react";
import { isSingleOriginPattern, originLabel, userGrantedOrigins } from "@/shared/origin";

/** Origins that are part of the install itself (the AI API hosts and the test build's loopback), not user grants. */
const FIXED = ["https://generativelanguage.googleapis.com/*", "https://api.groq.com/*", "http://127.0.0.1/*"];

/** Sites the user allowed from the popup after a run was blocked by a navigation. Each can be revoked here. */
export function SiteAccessPanel() {
  const [origins, setOrigins] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const all = await chrome.permissions.getAll();
    setOrigins(userGrantedOrigins(all.origins ?? [], FIXED));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (pattern: string) => {
    if (!isSingleOriginPattern(pattern)) return; // never remove anything but a single concrete origin
    const ok = await chrome.permissions.remove({ origins: [pattern] });
    setNote(ok ? `Revoked ${originLabel(pattern)}` : `Could not revoke ${originLabel(pattern)}`);
    await refresh();
  };

  return (
    <section data-testid="site-access">
      <p>
        ApplyPilot reads only the page you start it on. When a multi-page application moves to another site, you can allow that one
        site from the popup. Nothing is granted by default, and each site below can be revoked at any time.
      </p>
      {origins.length === 0 && <p className="muted" data-testid="no-sites">No sites allowed.</p>}
      <ul>
        {origins.map((o) => (
          <li key={o} data-testid="granted-origin">
            {originLabel(o)} <button className="danger" data-testid="revoke-origin" onClick={() => void revoke(o)}>Revoke</button>
          </li>
        ))}
      </ul>
      <span role="status" data-testid="site-access-note">{note}</span>
    </section>
  );
}
