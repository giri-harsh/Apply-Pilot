import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyControls } from "@/content/navigation/classify";
import { observeForm } from "@/content/observer/observe";
import { HOST_ID, hideIndicator, isShown, showIndicator } from "@/content/indicator";
import { viewFor } from "@/indicator/labels";
import { RUN_STATES } from "@/shared/state-machine";

const PAGE = `<form><label for="e">Email</label><input id="e"><button type="button">Next</button></form>`;

describe("in-page indicator", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });
  afterEach(() => hideIndicator());

  it("is a shadow-DOM host: the page scanner never sees its button or text, so it can never be 'filled' or clicked as Next", () => {
    const before = { fields: observeForm(document).fields.length, controls: classifyControls(document).report.controls.map((c) => c.text) };
    showIndicator(document, { label: "Filling fields", tone: "working", canStop: true, autoHideMs: null }, () => undefined);
    expect(isShown()).toBe(true);
    const host = document.getElementById(HOST_ID)!;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.querySelector("button.stop")).not.toBeNull(); // the Stop button is inside the shadow root
    expect(document.querySelectorAll("button").length).toBe(1); // ...and not in the page's own DOM
    expect(observeForm(document).fields.length).toBe(before.fields);
    expect(classifyControls(document).report.controls.map((c) => c.text)).toEqual(before.controls);
  });

  it("Stop calls the stop handler once per click; collapse toggles; hide removes the host", () => {
    let stops = 0;
    showIndicator(document, { label: "Filling fields", tone: "working", canStop: true, autoHideMs: null }, () => stops++);
    const root = document.getElementById(HOST_ID)!.shadowRoot!;
    (root.querySelector("button.stop") as HTMLButtonElement).click();
    expect(stops).toBe(1);
    const toggle = root.querySelector("button.ghost") as HTMLButtonElement;
    toggle.click();
    expect(root.querySelector(".pill")!.classList.contains("collapsed")).toBe(true);
    toggle.click();
    expect(root.querySelector(".pill")!.classList.contains("collapsed")).toBe(false);
    hideIndicator();
    expect(document.getElementById(HOST_ID)).toBeNull();
    expect(isShown()).toBe(false);
  });

  it("a final state shows no Stop button; updating reuses the one host (never two)", () => {
    showIndicator(document, { label: "Filling fields", tone: "working", canStop: true, autoHideMs: null }, () => undefined);
    showIndicator(document, { label: "Ready for your review", tone: "done", canStop: false, autoHideMs: null }, () => undefined);
    expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1);
    const root = document.getElementById(HOST_ID)!.shadowRoot!;
    expect((root.querySelector("button.stop") as HTMLElement).style.display).toBe("none");
    expect(root.querySelector(".label")!.textContent).toBe("Ready for your review");
  });

  it("auto-hides after the given time", async () => {
    showIndicator(document, { label: "Stopped", tone: "done", canStop: false, autoHideMs: 30 }, () => undefined);
    await new Promise((r) => setTimeout(r, 80));
    expect(isShown()).toBe(false);
  });
});

describe("indicator labels (SPEC 5.3)", () => {
  it("every working state has plain words, every final state a tone, and nothing carries field names or values", () => {
    const seen = new Set<string>();
    for (const s of RUN_STATES) {
      const v = viewFor(s, null);
      if (!v) continue;
      seen.add(v.label);
      expect(v.label).not.toMatch(/@|\d{4}/);
      expect(v.final).toBe(["READY_FOR_REVIEW", "COMPLETED", "PARTIALLY_COMPLETED", "BLOCKED", "FAILED", "CANCELLED"].includes(s));
    }
    for (const must of ["Inspecting page", "Reading job description", "Mapping fields", "Tailoring resume", "Filling fields", "Verifying entries", "Ready for your review"]) expect(seen).toContain(must);
    expect(viewFor("BLOCKED", "A CAPTCHA is on this page")!.label).toBe("Blocked: A CAPTCHA is on this page");
    expect(viewFor("BLOCKED", "x".repeat(300))!.label.length).toBeLessThanOrEqual(80);
    expect(viewFor("IDLE", null)).toBeNull();
  });
});
