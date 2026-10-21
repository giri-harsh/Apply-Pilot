/** Builds the MV3 manifest. The e2e variant only adds loopback host access so Playwright can drive the synthetic portals. */
export function buildManifest({ e2e = false } = {}) {
  const manifest = {
    manifest_version: 3,
    name: e2e ? "ApplyPilot AI (e2e)" : "ApplyPilot AI",
    version: "0.1.0",
    description: "Prepares job applications in one click. You review and submit.",
    action: { default_title: "ApplyPilot AI", default_popup: "popup.html" },
    options_ui: { page: "options.html", open_in_tab: true },
    background: { service_worker: "background.js" },
    permissions: ["activeTab", "scripting", "storage"],
    minimum_chrome_version: "110",
  };
  if (e2e) manifest.host_permissions = ["http://127.0.0.1/*"];
  return manifest;
}
