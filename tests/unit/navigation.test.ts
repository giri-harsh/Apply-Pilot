import { describe, expect, it } from "vitest";
import { Abort } from "@/background/abort";
import { Scheduler } from "@/background/scheduler";
import { detectBlockers } from "@/content/blockers";
import { classifyControls, pickNext } from "@/content/navigation/classify";
import { waitForStable } from "@/content/stability";

const page = (html: string) => {
  document.body.innerHTML = html;
  return classifyControls(document).report;
};
const roles = (r: ReturnType<typeof page>) => Object.fromEntries(r.controls.map((c) => [c.text, c.role]));

describe("final-control classifier (the safety rule: when unsure, treat as final)", () => {
  it.each([
    ["Next", "next"],
    ["Continue", "next"],
    ["Save and continue", "next"],
    ["Continue to education", "next"],
    ["Submit application", "final"],
    ["Apply now", "final"],
    ["Finish", "final"],
    ["Send", "final"],
    ["I agree and submit", "final"],
    ["Complete registration", "final"],
    ["Back", "back"],
    ["Cancel", "back"],
    ["Proceed to payment", "next"], // matches the progression wording...
  ] as const)("%s is %s", (text, role) => {
    const r = page(`<div><button type="button">${text}</button></div>`);
    if (text === "Proceed to payment") {
      // ...but "pay" is a final word, so wording alone never lets a payment step through
      expect(r.controls[0]!.role).toBe("final");
    } else {
      expect(r.controls[0]!.role).toBe(role);
    }
  });

  it("an unrecognised button is final; a plain link is not a control the agent may click", () => {
    expect(page(`<button type="button">Go</button>`).controls[0]!.role).toBe("final");
    expect(page(`<a href="#x">Terms</a>`).controls).toHaveLength(0);
  });

  it("a 'Continue' that is the submit button of a posting form is final", () => {
    expect(page(`<form action="/api/apply" method="post"><button type="submit">Continue</button></form>`).controls[0]!.role).toBe("final");
    expect(page(`<form method="post"><button>Continue</button></form>`).controls[0]!.role).toBe("final");
    expect(page(`<form><button type="submit" formaction="/x">Continue</button></form>`).controls[0]!.role).toBe("final");
    // a form with no action that is handled by script is a normal next control
    expect(page(`<form><button type="button">Continue</button></form>`).controls[0]!.role).toBe("next");
  });

  it("the last step and a review summary turn every control final", () => {
    expect(page(`<p>Step 3 of 3</p> <button type="button">Continue</button>`).controls[0]!.role).toBe("final");
    const r = page(`<h2>Review your application</h2><dl><dt>Name</dt><dd>A</dd></dl><button type="button">Next</button>`);
    expect(r.hasReviewSummary).toBe(true);
    expect(r.controls[0]!.role).toBe("final");
    expect(pickNext(r)).toBeNull();
  });

  it("pickNext needs exactly one next control and no explicit final control next to it", () => {
    expect(pickNext(page(`<button type="button">Next</button>`))?.text).toBe("Next");
    expect(pickNext(page(`<button type="button">Next</button><button type="button">Continue</button>`))).toBeNull();
    expect(pickNext(page(`<button type="button">Next</button><button type="submit">Submit application</button>`))).toBeNull();
    // Back and an unrecognised extra button (Save draft) do not veto a clearly worded Next
    const r = page(`<button type="button">Back</button><button type="button">Save draft</button><button type="button">Next</button>`);
    expect(roles(r)).toMatchObject({ Back: "back", "Save draft": "final", Next: "next" });
    expect(pickNext(r)?.text).toBe("Next");
  });

  it("hidden, disabled and navigation-area controls are not considered", () => {
    const r = page(`<nav><button type="button">Next</button></nav><button type="button" disabled>Continue</button><button type="button" hidden>Next</button>`);
    expect(r.controls).toHaveLength(0);
  });
});

describe("blocker detection (SPEC 3.2: never try to get past these)", () => {
  const det = (html: string) => {
    document.body.innerHTML = html;
    return detectBlockers(document);
  };
  it("CAPTCHA by widget, provider frame, or wording", () => {
    expect(det(`<div class="g-recaptcha" data-sitekey="x">box</div>`).blockers[0]?.type).toBe("captcha");
    expect(det(`<iframe src="https://www.google.com/recaptcha/api2/anchor" title="reCAPTCHA"></iframe>`).blockers[0]?.type).toBe("captcha");
    expect(det(`<p>Please verify you're a human to continue</p>`).blockers[0]?.type).toBe("captcha");
  });
  it("MFA codes and login walls", () => {
    expect(det(`<label for="c">Verification code</label><input id="c">`).blockers[0]?.type).toBe("mfa");
    expect(det(`<input autocomplete="one-time-code">`).blockers[0]?.type).toBe("mfa");
    expect(det(`<label for="p">Password</label><input id="p" type="password">`).blockers[0]?.type).toBe("login");
  });
  it("an ordinary form has no blockers", () => {
    expect(det(`<label for="e">Email</label><input id="e" type="email">`).blockers).toEqual([]);
  });
  it("unreadable frames are reported with their origin and size, never entered", () => {
    const r = det(`<iframe src="http://other.test/form" width="400" height="300"></iframe>`);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]!.origin).toBe("http://other.test");
  });
});

describe("settle wait: debounced MutationObserver", () => {
  it("resolves after a quiet period, restarts the quiet timer on each relevant change, and leaves no observer behind", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const root = document.getElementById("root")!;
    const live = new Set<unknown>();
    const RealMO = window.MutationObserver;
    window.MutationObserver = class extends RealMO {
      constructor(cb: MutationCallback) {
        super(cb);
        live.add(this);
      }
      disconnect() {
        live.delete(this);
        super.disconnect();
      }
    } as typeof MutationObserver;
    try {
      const p = waitForStable(document, 60, 1000);
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 30));
        root.appendChild(document.createElement("span"));
      }
      const res = await p;
      expect(res.timedOut).toBe(false);
      expect(res.mutations).toBeGreaterThanOrEqual(4);
      expect(res.waitedMs).toBeGreaterThanOrEqual(150); // the burst kept pushing the quiet window back
      expect(live.size).toBe(0);
      // Writes after the wait (the executor's own) trigger nothing: there is no observer to re-enter.
      root.appendChild(document.createElement("em"));
      await new Promise((r) => setTimeout(r, 20));
      expect(live.size).toBe(0);
    } finally {
      window.MutationObserver = RealMO;
    }
  });

  it("gives up at the maximum wait when the page never settles", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const root = document.getElementById("root")!;
    const t = setInterval(() => root.appendChild(document.createElement("i")), 10);
    const res = await waitForStable(document, 80, 200);
    clearInterval(t);
    expect(res.timedOut).toBe(true);
  });

  it("ignores text-only churn", async () => {
    document.body.innerHTML = `<div id="root">0</div>`;
    const p = waitForStable(document, 50, 1000);
    const t = setInterval(() => (document.getElementById("root")!.firstChild!.textContent = String(Math.random())), 10);
    const res = await p;
    clearInterval(t);
    expect(res.timedOut).toBe(false);
    expect(res.mutations).toBe(0);
  });
});

describe("Scheduler", () => {
  it("cancelAll rejects every pending sleep with Abort and leaves no timers", async () => {
    const s = new Scheduler();
    const a = s.sleep(60_000);
    const b = s.sleep(60_000);
    expect(s.pending).toBe(2);
    s.cancelAll();
    await expect(a).rejects.toBeInstanceOf(Abort);
    await expect(b).rejects.toBeInstanceOf(Abort);
    expect(s.pending).toBe(0);
    await expect(s.sleep(1)).rejects.toBeInstanceOf(Abort); // nothing can be scheduled afterwards
  });

  it("waitUntil returns true as soon as the condition holds and false at the timeout", async () => {
    const s = new Scheduler();
    let n = 0;
    expect(await s.waitUntil(() => ++n >= 3, 1000, 5)).toBe(true);
    expect(await s.waitUntil(() => false, 40, 10)).toBe(false);
    expect(s.pending).toBe(0);
  });
});
