import { beforeEach, describe, expect, it } from "vitest";
import { observeForm } from "@/content/observer/observe";
import { matchAliases } from "@/shared/aliases";
import { classifyField } from "@/content/mapping/classify";
import { mapFields, readProfileValue } from "@/content/mapping/map";
import { executeAction, validateAction, type ExecContext } from "@/content/actions/executor";
import { setNativeValue, typeInto } from "@/content/actions/native";
import { findValidationMessage, verifyFill } from "@/content/verification/verify";
import { buildReport } from "@/shared/report";
import { AgentActionSchema, type FormField } from "@/shared/form";
import type { PlannedFill } from "@/shared/messages";
import { emptyProfile } from "@/shared/profile";
import { testProfile } from "../fixtures/profile";

function page(html: string) {
  document.body.innerHTML = html;
  return observeForm(document);
}

function ctxFor(o: ReturnType<typeof observeForm>, cancelled = false): ExecContext {
  return { fields: new Map(o.fields.map((f) => [f.fieldId, f])), targets: o.targets, isCancelled: () => cancelled };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("label resolution (SPEC 9.4 priority)", () => {
  it("prefers an explicit <label for> over placeholder and name", () => {
    const o = page('<label for="a">Email address</label><input id="a" name="phone" placeholder="Your phone">');
    const f = o.fields[0]!;
    expect(f.label).toBe("Email address");
    expect(f.labelSource).toBe("explicit_label");
    // Placeholder and name say "phone" while the label says email: signals conflict -> ambiguous, not first-wins.
    expect(f.ambiguous).toBe(true);
  });

  it("reads wrapping labels, aria-labelledby, aria-label, placeholder and nearby text", () => {
    const o = page(`
      <label>Given name <input name="x1"></label>
      <span id="m">Mobile #</span><input aria-labelledby="m" name="x2">
      <input aria-label="Contact e-mail" name="x3">
      <input placeholder="Your city" name="x4">
      <div><span>GitHub profile</span><input name="x5"></div>`);
    const labels = o.fields.map((f) => [f.label, f.labelSource, f.semanticType]);
    expect(labels).toEqual([
      ["Given name", "explicit_label", "first_name"],
      ["Mobile #", "aria_labelledby", "phone"],
      ["Contact e-mail", "aria_label", "email"],
      ["Your city", "placeholder", "city"],
      ["GitHub profile", "nearby_text", "github"],
    ]);
  });

  it("uses section headings as context only, never as the label", () => {
    const o = page("<h2>Professional Reference</h2><label for=n>Name</label><input id=n>");
    const f = o.fields[0]!;
    expect(f.sectionContext).toBe("Professional Reference");
    expect(f.label).toBe("Name");
    expect(f.semanticType).toBe("third_party_contact");
  });

  it("uses a fieldset legend as the question for radio groups and groups the radios", () => {
    const o = page(`<fieldset><legend>Will you require visa sponsorship?</legend>
      <label><input type=radio name=s value=yes> Yes</label><label><input type=radio name=s value=no> No</label></fieldset>`);
    expect(o.fields).toHaveLength(1);
    const f = o.fields[0]!;
    expect(f.control).toBe("radio");
    expect(f.options.map((x) => x.label)).toEqual(["Yes", "No"]);
    expect(f.semanticType).toBe("sponsorship");
    expect(f.risk).toBe("high");
  });

  it("marks required from the attribute, aria-required and an asterisk in the label", () => {
    const o = page('<label for=a>A *</label><input id=a><label for=b>B</label><input id=b required><label for=c>C</label><input id=c aria-required="true"><label for=d>D</label><input id=d>');
    expect(o.fields.map((f) => f.required)).toEqual([true, true, true, false]);
  });

  it("excludes password, hidden and button inputs and marks hidden controls invisible", () => {
    const o = page('<input type=password name=pw><input type=hidden name=h><input type=submit><label for=e>Email</label><input id=e type=email style="display:none">');
    expect(o.fields).toHaveLength(1);
    expect(o.fields[0]!.visible).toBe(false);
  });
});

describe("semantic alias dictionary", () => {
  it.each([
    ["Email Address", "email"],
    ["E-mail *", "email"],
    ["Phone number", "phone"],
    ["Mobile #", "phone"],
    ["First Name", "first_name"],
    ["Surname", "last_name"],
    ["Full legal name", "full_name"],
    ["Name", "full_name"],
    ["Country/Region", "country"],
    ["State / Province", "state"],
    ["ZIP code", "postal_code"],
    ["LinkedIn profile URL", "linkedin"],
    ["Personal website", "portfolio"],
    ["University", "institution"],
    ["Expected graduation date", "graduation_year"],
    ["Year of graduation", "graduation_year"],
    ["CGPA", "gpa"],
    ["Major", "field_of_study"],
    ["Current employer", "current_employer"],
    ["Do you require visa sponsorship?", "sponsorship"],
    ["Are you legally authorized to work?", "work_authorization"],
    ["Gender", "gender"],
    ["Veteran status", "veteran_status"],
    ["Disability status", "disability"],
    ["Race / ethnicity", "race_ethnicity"],
    ["Expected salary", "salary"],
    ["Date of birth", "date_of_birth"],
    ["I agree to the terms and conditions", "consent"],
    ["Resume / CV", "resume_upload"],
    ["Why do you want to join us?", "open_ended"],
  ])("%s -> %s", (text, type) => {
    expect(matchAliases(text)?.type).toBe(type);
  });

  it("does not match unrelated text", () => {
    expect(matchAliases("Favourite colour")).toBeNull();
    expect(matchAliases("")).toBeNull();
    expect(matchAliases("Start date")).toBeNull(); // too ambiguous (education vs availability)
  });

  it("flags conflicting signals as ambiguous instead of choosing", () => {
    const c = classifyField(
      [{ source: "explicit_label", text: "Email" }, { source: "placeholder", text: "Enter phone number" }],
      "text",
      "",
    );
    expect(c.ambiguous).toBe(true);
    expect(c.ambiguityReason).toMatch(/email vs phone/);
  });

  it("nearby text alone is low-confidence", () => {
    const c = classifyField([{ source: "nearby_text", text: "Email" }], "text", "");
    expect(c.confidence).toBeLessThan(0.8);
  });
});

describe("profile mapping", () => {
  const profile = testProfile();

  it("reads the latest education and only an explicitly current employer", () => {
    expect(readProfileValue(profile, "education.graduationYear")).toBe("2027");
    expect(readProfileValue(profile, "experience.currentEmployer")).toBe("");
    const p = structuredClone(profile);
    p.experience.push({ id: "e", employer: "Acme", position: "Intern", employmentType: "", startDate: "", endDate: "", current: true, responsibilities: [], achievements: [], technologies: [], metrics: [], evidence: [], provenance: p.education[0]!.provenance });
    expect(readProfileValue(p, "experience.currentEmployer")).toBe("Acme");
    expect(readProfileValue(emptyProfile(), "personal.fullName")).toBe("");
  });

  it("plans text and select fills for confident matches", () => {
    const o = page(`<label for=n>Full Name</label><input id=n>
      <label for=e>Email</label><input id=e type=email>
      <label for=c>Country</label><select id=c><option value="">-</option><option value="IN">India</option><option value="US">United States</option></select>
      <label for=g>Graduation Year</label><input id=g>`);
    const { plan, skipped } = mapFields(o.fields, profile);
    expect(skipped).toEqual([]);
    expect(plan.map((p) => p.action)).toEqual([
      { type: "fill_text", fieldId: "field_001", value: "Alex Example" },
      { type: "fill_text", fieldId: "field_002", value: "alex@example.test" },
      { type: "select_option", fieldId: "field_003", optionValue: "IN" },
      { type: "fill_text", fieldId: "field_004", value: "2027" },
    ]);
  });

  it("never plans sensitive, consent, third-party, hidden or unknown fields", () => {
    const o = page(`<label for=s>Expected salary</label><input id=s>
      <label for=g>Gender</label><select id=g><option>Male</option></select>
      <label><input type=checkbox id=c> I agree to the terms</label>
      <h2>Emergency contact</h2><label for=n>Name</label><input id=n>
      <label for=h>Email</label><input id=h style="display:none">
      <label for=u>Favourite colour</label><input id=u>`);
    const { plan, skipped } = mapFields(o.fields, profile);
    expect(plan).toEqual([]);
    expect(skipped.map((s) => s.outcome).sort()).toEqual(["skipped_consent", "skipped_sensitive", "skipped_sensitive", "skipped_third_party", "unresolved"].sort());
  });

  it("leaves a field alone when it already holds a different value, and reports already-correct ones", () => {
    const o = page('<label for=a>Email</label><input id=a value="old@x.test"><label for=b>City</label><input id=b value="Pune">');
    const { plan, skipped } = mapFields(o.fields, profile);
    expect(plan).toEqual([]);
    expect(skipped.map((s) => s.outcome)).toEqual(["unresolved", "already_correct"]);
  });

  it("does not guess when the profile lacks a value or no option matches exactly", () => {
    const o = page('<label for=a>Current employer</label><input id=a><label for=c>Country</label><select id=c><option value="">-</option><option>USA</option></select>');
    const { plan, skipped } = mapFields(o.fields, profile);
    expect(plan).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["Profile has no value for this field", "No option exactly matches the profile value"]);
  });

  it("refuses to fill partial dates into date inputs", () => {
    const p = structuredClone(profile);
    p.preferences.availabilityDate = "2027-06";
    const o = page('<label for=a>Available from</label><input id=a type=date>');
    expect(mapFields(o.fields, p).plan).toEqual([]);
    p.preferences.availabilityDate = "2027-06-01";
    expect(mapFields(o.fields, p).plan[0]!.action).toEqual({ type: "fill_text", fieldId: "field_001", value: "2027-06-01" });
  });

  it("treats same label + same section as ambiguous but allows Confirm email", () => {
    const o = page('<label for=a>City</label><input id=a><label for=b>City</label><input id=b><label for=e>Email</label><input id=e><label for=f>Confirm email</label><input id=f>');
    const { plan, skipped } = mapFields(o.fields, profile);
    expect(skipped.filter((s) => s.outcome === "ambiguous")).toHaveLength(2);
    expect(plan.map((p) => p.semanticType)).toEqual(["email", "email"]);
  });

  it("only plans actions inside the AgentAction union", () => {
    const o = page('<label for=a>Email</label><input id=a>');
    for (const p of mapFields(o.fields, profile).plan) expect(AgentActionSchema.safeParse(p.action).success).toBe(true);
  });
});

describe("constrained executor (SPEC 11.4 / 11.5)", () => {
  const setup = (html: string) => {
    const o = page(html);
    return { o, ctx: ctxFor(o) };
  };

  it("rejects anything outside the allowed action set", () => {
    const { ctx } = setup("<label for=a>Email</label><input id=a>");
    for (const bad of [
      { type: "click", selector: "#submit" },
      { type: "eval", code: "alert(1)" },
      { type: "navigate_next" },
      { type: "inspect_again" },
      { type: "upload_file", fieldId: "field_001", fileReference: "x" },
      { type: "fill_text", fieldId: "field_001", value: 5 },
      "fill_text",
      null,
    ]) {
      expect(validateAction(bad, ctx).ok).toBe(false);
    }
  });

  it("rejects unknown, disabled, hidden, stale and policy-restricted targets", () => {
    const { o, ctx } = setup(`<label for=a>Email</label><input id=a>
      <label for=b>City</label><input id=b disabled>
      <label for=c>Phone</label><input id=c style="display:none">
      <label for=s>Expected salary</label><input id=s>
      <label><input type=checkbox id=k> I agree to the terms</label>`);
    const act = (fieldId: string) => ({ type: "fill_text", fieldId, value: "x" });
    expect(validateAction(act("field_999"), ctx)).toMatchObject({ ok: false, error: "Target field does not exist" });
    expect(validateAction(act("field_002"), ctx)).toMatchObject({ ok: false, error: "Target is disabled or read-only" });
    expect(validateAction(act("field_003"), ctx)).toMatchObject({ ok: false, error: "Target is not visible" });
    expect(validateAction(act("field_004"), ctx)).toMatchObject({ ok: false, error: "Sensitive fields are never auto-filled" });
    expect(validateAction({ type: "set_checkbox", fieldId: "field_005", checked: true }, ctx)).toMatchObject({ ok: false, error: "Consent fields are never auto-filled" });
    // stale: the element is swapped out of the DOM after observation
    document.getElementById("a")!.remove();
    expect(validateAction(act("field_001"), ctx)).toMatchObject({ ok: false, error: "Target is no longer in the page" });
    // changed identity: same node, different label
    const d = document.createElement("input");
    d.id = "z";
    document.body.append(d);
    o.targets.set("field_001", [d]);
    expect(validateAction(act("field_001"), ctx)).toMatchObject({ ok: false, error: "Target no longer matches the observed field" });
  });

  it("rejects type mismatches, bad values and oversize values", () => {
    const { ctx } = setup(`<label for=a>Email</label><input id=a type=email>
      <label for=b>City</label><select id=b><option value=x>x</option></select>
      <label for=c>Phone</label><input id=c maxlength=5>`);
    expect(validateAction({ type: "fill_text", fieldId: "field_001", value: "nope" }, ctx)).toMatchObject({ error: "Value is not an email" });
    expect(validateAction({ type: "fill_text", fieldId: "field_002", value: "x" }, ctx)).toMatchObject({ error: "Not a text control" });
    expect(validateAction({ type: "select_option", fieldId: "field_002", optionValue: "nope" }, ctx)).toMatchObject({ error: "Option does not exist" });
    expect(validateAction({ type: "select_option", fieldId: "field_001", optionValue: "x" }, ctx)).toMatchObject({ error: "Not a select control" });
    expect(validateAction({ type: "fill_text", fieldId: "field_003", value: "123456" }, ctx)).toMatchObject({ error: "Value exceeds the field length limit" });
  });

  it("fills text, select, radio and non-consent checkbox controls and never touches buttons", async () => {
    const { ctx } = setup(`<label for=a>Email</label><input id=a type=email>
      <label for=b>Country</label><select id=b><option value="">-</option><option value=IN>India</option></select>
      <fieldset><legend>Preferred contact</legend><label><input type=radio name=p value=a> A</label><label><input type=radio name=p value=b> B</label></fieldset>
      <label><input type=checkbox id=nl> Subscribe to newsletter</label>
      <button id=submit type=submit>Submit</button>`);
    let clicked = false;
    document.getElementById("submit")!.addEventListener("click", () => (clicked = true));
    let submitted = false;
    document.addEventListener("submit", () => (submitted = true));

    expect((await executeAction({ type: "fill_text", fieldId: "field_001", value: "a@b.co" }, ctx)).executed).toBe(true);
    expect((await executeAction({ type: "select_option", fieldId: "field_002", optionValue: "IN" }, ctx)).executed).toBe(true);
    expect((await executeAction({ type: "select_radio", fieldId: "field_003", optionValue: "b" }, ctx)).executed).toBe(true);
    expect((await executeAction({ type: "set_checkbox", fieldId: "field_004", checked: true }, ctx)).executed).toBe(true);
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("a@b.co");
    expect((document.getElementById("b") as HTMLSelectElement).value).toBe("IN");
    expect((document.querySelector("input[value=b]") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("nl") as HTMLInputElement).checked).toBe(true);
    expect(clicked).toBe(false);
    expect(submitted).toBe(false);
  });

  it("stops immediately once cancelled", async () => {
    const o = page("<label for=a>Email</label><input id=a>");
    const r = await executeAction({ type: "fill_text", fieldId: "field_001", value: "a@b.co" }, ctxFor(o, true));
    expect(r).toEqual({ fieldId: "field_001", executed: false, error: "Cancelled" });
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("");
  });
});

describe("framework-compatible filling (regression for React-controlled inputs)", () => {
  /** Reproduces React's value tracker: an own `value` property that records the last value it saw. */
  function installReactTracker(input: HTMLInputElement) {
    const proto = Object.getPrototypeOf(input) as object;
    const desc = Object.getOwnPropertyDescriptor(proto, "value")!;
    let tracked = "";
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => desc.get!.call(input) as string,
      set: (v: string) => {
        tracked = String(v);
        desc.set!.call(input, v);
      },
    });
    const changes: string[] = [];
    input.addEventListener("input", () => {
      const now = desc.get!.call(input) as string;
      if (now !== tracked) {
        tracked = now;
        changes.push(now); // React only calls onChange when the tracked value differs
      }
    });
    return changes;
  }

  it("a plain `el.value = x` is ignored by a React-style tracker", () => {
    document.body.innerHTML = "<input id=a>";
    const el = document.getElementById("a") as HTMLInputElement;
    const changes = installReactTracker(el);
    el.value = "hello";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changes).toEqual([]); // proves the naive approach is broken
  });

  it("the native prototype setter + bubbling events is seen as a real change", () => {
    document.body.innerHTML = "<input id=a>";
    const el = document.getElementById("a") as HTMLInputElement;
    const changes = installReactTracker(el);
    typeInto(el, "hello");
    expect(changes).toEqual(["hello"]);
    expect(el.value).toBe("hello");
  });

  it("dispatches input, change and blur in order with bubbling", () => {
    document.body.innerHTML = "<form><input id=a></form>";
    const el = document.getElementById("a") as HTMLInputElement;
    const seen: string[] = [];
    for (const t of ["focus", "input", "change", "blur"]) {
      document.querySelector("form")!.addEventListener(t, (e) => seen.push(e.type), true);
    }
    typeInto(el, "x");
    expect(seen).toEqual(["focus", "input", "change", "blur"]);
  });

  it("setNativeValue works for textarea and select", () => {
    document.body.innerHTML = "<textarea id=t></textarea><select id=s><option value=a>a</option><option value=b>b</option></select>";
    setNativeValue(document.getElementById("t") as HTMLTextAreaElement, "text");
    setNativeValue(document.getElementById("s") as HTMLSelectElement, "b");
    expect((document.getElementById("t") as HTMLTextAreaElement).value).toBe("text");
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("b");
  });
});

describe("verification", () => {
  const plan = (fieldId: string, value: string): PlannedFill => ({
    fieldId, action: { type: "fill_text", fieldId, value }, semanticType: "email", label: "Email", required: true,
  });

  it("verifies a matching, error-free value", async () => {
    const o = page("<label for=a>Email</label><input id=a>");
    (document.getElementById("a") as HTMLInputElement).value = "a@b.co";
    const r = await verifyFill(plan("field_001", "a@b.co"), o.fields[0], o.targets.get("field_001"));
    expect(r.verified).toBe(true);
  });

  it("fails when the rendered value differs (e.g. a framework reverted it)", async () => {
    const o = page("<label for=a>Email</label><input id=a>");
    const r = await verifyFill(plan("field_001", "a@b.co"), o.fields[0], o.targets.get("field_001"));
    expect(r).toMatchObject({ verified: false, reason: "Rendered value does not match what was entered" });
  });

  it("fails when the page shows a validation message", async () => {
    const o = page('<label for=a>Email</label><input id=a aria-invalid="true" aria-describedby=err><span id=err role=alert>Enter a valid email</span>');
    (document.getElementById("a") as HTMLInputElement).value = "a@b.co";
    const r = await verifyFill(plan("field_001", "a@b.co"), o.fields[0], o.targets.get("field_001"));
    expect(r.verified).toBe(false);
    expect(r.reason).toContain("Enter a valid email");
  });

  it("detects native constraint violations and error-classed siblings", () => {
    document.body.innerHTML = '<input id=a type=email value="nope"><div><input id=b><span class="field-error">Required</span></div>';
    expect(findValidationMessage(document.getElementById("a") as HTMLElement)).not.toBeNull();
    expect(findValidationMessage(document.getElementById("b") as HTMLElement)).toBe("Required");
  });

  it("reports a vanished field as unverified", async () => {
    const r = await verifyFill(plan("field_001", "x"), undefined, undefined);
    expect(r.verified).toBe(false);
  });
});

describe("completion report", () => {
  it("counts only what actually happened", () => {
    const fields = [{ visible: true }, { visible: true }, { visible: true }, { visible: false }] as FormField[];
    const mk = (id: string): PlannedFill => ({ fieldId: id, action: { type: "fill_text", fieldId: id, value: "v" }, semanticType: "email", label: id, required: true });
    const r = buildReport(
      fields,
      [mk("a"), mk("b"), mk("c")],
      [{ fieldId: "s", label: "Salary", outcome: "skipped_sensitive", required: false, reason: "r", semanticType: "salary" }],
      [{ fieldId: "a", executed: true, error: null }, { fieldId: "b", executed: true, error: null }, { fieldId: "c", executed: false, error: "Target is disabled or read-only" }],
      [{ fieldId: "a", verified: true, reason: "ok" }, { fieldId: "b", verified: false, reason: "mismatch" }],
    );
    // totalFields is the number of visible fields that received a result (the old input list is no longer consulted).
    expect(r).toMatchObject({ totalFields: 4, filled: 2, verified: 1, failed: 2, skippedSensitive: 1, requiredUnresolved: 2 });
    expect(r.results.find((x) => x.fieldId === "c")!.reason).toBe("Target is disabled or read-only");
  });
});
