import { describe, expect, it } from "vitest";
import { chooseGrantOrigin, isSingleOriginPattern, originLabel, originPattern, permissionRequest, userGrantedOrigins } from "@/shared/origin";

describe("per-origin permission payloads", () => {
  it("normalises a page URL to one origin pattern without port, path, query or credentials", () => {
    expect(originPattern("https://Jobs.Example.com/apply/123?x=1#top")).toBe("https://jobs.example.com/*");
    expect(originPattern("http://example.com:8080/a")).toBe("http://example.com/*");
  });

  it.each(["chrome://settings", "file:///C:/a.html", "javascript:alert(1)", "about:blank", "not a url", "", "https://user:pw@example.com/", "ftp://example.com/"])(
    "refuses %s",
    (u) => {
      expect(originPattern(u)).toBeNull();
      expect(permissionRequest(u)).toBeNull();
    },
  );

  it("the request payload names exactly one origin and never a wildcard", () => {
    expect(permissionRequest("https://jobs.example.com/x")).toEqual({ origins: ["https://jobs.example.com/*"] });
    for (const bad of ["https://*/*", "http://*/*", "<all_urls>", "https://*.example.com/*", "*://example.com/*"]) {
      expect(isSingleOriginPattern(bad)).toBe(false);
    }
  });

  it("labels a pattern for display and lists only user grants", () => {
    expect(originLabel("https://jobs.example.com/*")).toBe("https://jobs.example.com");
    const all = ["https://api.groq.com/*", "https://b.example/*", "https://a.example/*", "https://*/*", "<all_urls>"];
    expect(userGrantedOrigins(all, ["https://api.groq.com/*"])).toEqual(["https://a.example/*", "https://b.example/*"]);
  });

  it("chooses the run's origin first, then the tab URL, then an explicit hint; otherwise nothing", () => {
    expect(chooseGrantOrigin("https://run.example/*", "https://tab.example/x", "https://hint.example/")).toBe("https://run.example/*");
    expect(chooseGrantOrigin(null, "https://tab.example/x", "https://hint.example/")).toBe("https://tab.example/*");
    expect(chooseGrantOrigin(null, undefined, "https://hint.example/y")).toBe("https://hint.example/*");
    expect(chooseGrantOrigin("https://*/*", undefined, null)).toBeNull();
    expect(chooseGrantOrigin(null, "chrome://newtab", null)).toBeNull();
  });
});
