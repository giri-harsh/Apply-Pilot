import { beforeEach, describe, expect, it } from "vitest";
import { executeAction, validateAction, type ExecContext } from "@/content/actions/executor";
import { mayClick } from "@/content/actions/custom";
import { mapFields } from "@/content/mapping/map";
import { observeForm } from "@/content/observer/observe";
import { verifyFill } from "@/content/verification/verify";
import type { PlannedFill } from "@/shared/messages";
import { testProfile } from "../fixtures/profile";

/** A listbox-style dropdown like the synthetic portal: `staticList` keeps options in the DOM, otherwise they are created on open. */
function dropdown(opts: { staticList: boolean; onMouseDown?: boolean; options?: [string, string][]; type?: string }) {
  const options = opts.options ?? [["US", "United States"], ["IN", "India"], ["GB", "United Kingdom"]];
  document.body.innerHTML = `<form id="f"><span id="lbl">Country</span>
    <${opts.type ?? "div"} id="t" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lbl t" aria-controls="list" tabindex="0">Select...</${opts.type ?? "div"}>
    <div id="slot"><ul id="list" role="listbox" ${opts.staticList ? "hidden" : ""}></ul></div></form>`;
  const t = document.getElementById("t")!;
  const list = document.getElementById("list")!;
  const render = () => {
    list.innerHTML = "";
    for (const [v, label] of options) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.value = v;
      li.textContent = label;
      list.appendChild(li);
    }
  };
  if (opts.staticList) render();
  else list.remove();
  const hide = (l: HTMLElement) => {
    if (opts.staticList) l.hidden = true;
    else l.remove();
  };
  const choose = (li: HTMLElement) => {
    t.textContent = li.textContent;
    t.setAttribute("aria-expanded", "false");
    const l = document.getElementById("list");
    if (l) hide(l);
  };
  t.addEventListener("click", () => {
    const open = t.getAttribute("aria-expanded") === "true";
    t.setAttribute("aria-expanded", String(!open));
    if (open) {
      const l = document.getElementById("list");
      if (l) hide(l);
    } else if (opts.staticList) document.getElementById("list")!.hidden = false;
    else {
      document.getElementById("slot")!.appendChild(list);
      render();
    }
  });
  const ev = opts.onMouseDown ? "mousedown" : "click";
  document.addEventListener(ev, (e) => {
    const li = (e.target as Element).closest?.("li[role=option]") as HTMLElement | null;
    if (li) choose(li);
  });
  return t;
}

function autocomplete(opts: { data: string[]; delayMs?: number; neverShow?: boolean; selectOnClick?: boolean }) {
  document.body.innerHTML = `<form id="f"><label for="u">University</label>
    <input id="u" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ul" autocomplete="off">
    <ul id="ul" role="listbox" hidden></ul><span id="msg" class="error" role="alert"></span><input type="hidden" id="uid"></form>`;
  const input = document.getElementById("u") as HTMLInputElement;
  const list = document.getElementById("ul")!;
  const hidden = document.getElementById("uid") as HTMLInputElement;
  const msg = document.getElementById("msg")!;
  input.addEventListener("input", () => {
    hidden.value = "";
    if (opts.neverShow) return;
    setTimeout(() => {
      list.innerHTML = "";
      for (const d of opts.data.filter((x) => x.toLowerCase().includes(input.value.toLowerCase()))) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = d;
        list.appendChild(li);
      }
      list.hidden = list.children.length === 0;
      input.setAttribute("aria-expanded", String(!list.hidden));
    }, opts.delayMs ?? 30);
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as Element).closest("li");
    if (!li) return;
    if (opts.selectOnClick === false) return; // the page ignores the click: typed but not selected
    input.value = li.textContent!;
    hidden.value = "picked";
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (input.value && !hidden.value) msg.textContent = "Please choose one of the suggestions";
    }, 50);
  });
  return { input, hidden, list, msg };
}

function ctxFor(o: ReturnType<typeof observeForm>): ExecContext {
  return { fields: new Map(o.fields.map((f) => [f.fieldId, f])), targets: o.targets, isCancelled: () => false };
}
const plan = (fieldId: string, action: PlannedFill["action"]): PlannedFill => ({ fieldId, action, semanticType: "country", label: "x", required: false });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("observing custom widgets", () => {
  it("sees a div combobox with its label, known options and no value", () => {
    dropdown({ staticList: true });
    const [f] = observeForm(document).fields;
    expect(f).toMatchObject({ control: "combobox", widget: "combobox", label: "Country", semanticType: "country", currentValue: "" });
    expect(f!.options.map((o) => o.label)).toEqual(["United States", "India", "United Kingdom"]);
  });

  it("a trigger that lists its own id in aria-labelledby is not labelled by its own text", () => {
    dropdown({ staticList: false });
    const [f] = observeForm(document).fields;
    expect(f!.label).toBe("Country");
    expect(f!.options).toEqual([]); // created only when opened
  });

  it("reports the displayed selection as the current value", () => {
    dropdown({ staticList: true });
    document.getElementById("t")!.textContent = "India";
    expect(observeForm(document).fields[0]!.currentValue).toBe("India");
  });

  it("flags autocomplete inputs and ignores navigation menus", () => {
    document.body.innerHTML = '<nav><button aria-haspopup="listbox">Language</button></nav><label for="c">City</label><input id="c" role="combobox" aria-autocomplete="list">';
    const fields = observeForm(document).fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ control: "text", widget: "combobox", label: "City" });
  });
});

describe("mapping custom widgets", () => {
  it("plans select_custom_option with the real option label, and fill_autocomplete for inputs", () => {
    dropdown({ staticList: true });
    expect(mapFields(observeForm(document).fields, testProfile()).plan[0]!.action).toEqual({ type: "select_custom_option", fieldId: "field_001", optionLabel: "India" });
    autocomplete({ data: ["Pune"] });
    document.getElementById("u")!.closest("form")!.insertAdjacentHTML("afterbegin", "");
    document.body.innerHTML = '<label for="c">City</label><input id="c" role="combobox" aria-autocomplete="list">';
    expect(mapFields(observeForm(document).fields, testProfile()).plan[0]!.action).toEqual({ type: "fill_autocomplete", fieldId: "field_001", query: "Pune", optionLabel: "Pune" });
  });

  it("trusts dynamic dropdowns to be checked when opened, but not known lists without an exact match", () => {
    dropdown({ staticList: false });
    expect(mapFields(observeForm(document).fields, testProfile()).plan).toHaveLength(1);
    dropdown({ staticList: true, options: [["US", "USA"], ["GB", "UK"]] });
    const r = mapFields(observeForm(document).fields, testProfile());
    expect(r.plan).toEqual([]);
    expect(r.skipped[0]!.reason).toBe("No option exactly matches the profile value");
  });

  it("never plans a sensitive custom dropdown", () => {
    document.body.innerHTML = '<span id="l">Gender</span><div role="combobox" aria-haspopup="listbox" aria-labelledby="l"></div>';
    const r = mapFields(observeForm(document).fields, testProfile());
    expect(r.plan).toEqual([]);
    expect(r.skipped[0]!.outcome).toBe("skipped_sensitive");
  });
});

describe("custom dropdown interaction (SPEC 12.3)", () => {
  async function run(staticList: boolean, label = "India", extra: Parameters<typeof dropdown>[0] extends infer P ? Partial<P> : never = {}) {
    const t = dropdown({ staticList, ...extra });
    const o = observeForm(document);
    const ctx = ctxFor(o);
    const action = { type: "select_custom_option", fieldId: "field_001", optionLabel: label } as const;
    const res = await executeAction(action, ctx);
    return { t, o, ctx, res, action };
  }

  it("opens, picks the option by label and verifies the displayed value (options already in the DOM)", async () => {
    const { t, o, res, action } = await run(true);
    expect(res).toEqual({ fieldId: "field_001", executed: true, error: null });
    expect(t.textContent).toBe("India");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    const v = await verifyFill(plan("field_001", action), o.fields[0], o.targets.get("field_001"));
    expect(v.verified).toBe(true);
  });

  it("works when the options only appear after opening", async () => {
    const { t, res } = await run(false);
    expect(res.executed).toBe(true);
    expect(t.textContent).toBe("India");
  });

  it("works for widgets that select on mousedown (React-Select style)", async () => {
    const { t, res } = await run(false, "India", { onMouseDown: true });
    expect(res.executed).toBe(true);
    expect(t.textContent).toBe("India");
  });

  it("an option that does not exist fails cleanly: nothing selected and the list is closed again", async () => {
    const { t, res } = await run(false, "Atlantis");
    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/No option matches/);
    expect(t.textContent).toBe("Select...");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("list")).toBeNull();
  });

  it("matches exactly: a label that is only a prefix does not select", async () => {
    const { res } = await run(false, "United");
    expect(res.executed).toBe(false);
  });

  it("verification fails if the page did not actually show the selection", async () => {
    const t = dropdown({ staticList: true });
    const o = observeForm(document);
    t.textContent = "Select..."; // the page never reflected a choice
    const v = await verifyFill(plan("field_001", { type: "select_custom_option", fieldId: "field_001", optionLabel: "India" }), o.fields[0], o.targets.get("field_001"));
    expect(v.verified).toBe(false);
  });

  it("refuses a trigger that would submit the form and never fires a submit", async () => {
    let submitted = false;
    document.addEventListener("submit", (e) => {
      e.preventDefault();
      submitted = true;
    });
    dropdown({ staticList: true, type: "button" }); // <button> without type=button inside a form submits
    const o = observeForm(document);
    const res = await executeAction({ type: "select_custom_option", fieldId: "field_001", optionLabel: "India" }, ctxFor(o));
    expect(res).toMatchObject({ executed: false, error: "Button could submit the form" });
    expect(submitted).toBe(false);
    expect(mayClick(document.getElementById("t")!)).toEqual({ ok: false, reason: "Button could submit the form" });
  });

  it("validation rejects wrong control kinds and unknown options before touching the page", () => {
    dropdown({ staticList: true });
    const ctx = ctxFor(observeForm(document));
    expect(validateAction({ type: "select_custom_option", fieldId: "field_001", optionLabel: "Atlantis" }, ctx)).toMatchObject({ error: "Option does not exist" });
    expect(validateAction({ type: "fill_autocomplete", fieldId: "field_001", query: "x", optionLabel: "x" }, ctx)).toMatchObject({ error: "Not an autocomplete" });
    expect(validateAction({ type: "fill_text", fieldId: "field_001", value: "x" }, ctx)).toMatchObject({ error: "Not a text control" });
    expect(validateAction({ type: "select_option", fieldId: "field_001", optionValue: "IN" }, ctx)).toMatchObject({ error: "Not a select control" });
  });
});

describe("autocomplete interaction (SPEC 12.4)", () => {
  const act = (q: string, l = q) => ({ type: "fill_autocomplete", fieldId: "field_001", query: q, optionLabel: l }) as const;

  it("types, waits for asynchronous suggestions, picks the exact one and verifies the selection", async () => {
    const { input, hidden } = autocomplete({ data: ["Pune", "Pune Cantonment", "Mumbai"], delayMs: 80 });
    const o = observeForm(document);
    const res = await executeAction(act("Pune"), ctxFor(o));
    expect(res.executed).toBe(true);
    expect(input.value).toBe("Pune");
    expect(hidden.value).toBe("picked"); // the page registered a real selection
    const v = await verifyFill(plan("field_001", act("Pune")), o.fields[0], o.targets.get("field_001"));
    expect(v.verified).toBe(true);
  });

  it("typed-but-not-selected is detected: no exact suggestion means the typed text is removed and the failure reported", async () => {
    const { input, hidden } = autocomplete({ data: ["Pune Cantonment", "Pune City"] });
    const o = observeForm(document);
    const res = await executeAction(act("Pune"), ctxFor(o));
    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/Typed text is not a selection/);
    expect(input.value).toBe(""); // restored, not left looking filled
    expect(hidden.value).toBe("");
  });

  it("no suggestions at all: restores the field and fails", async () => {
    const { input } = autocomplete({ data: ["Pune"], neverShow: true });
    const res = await executeAction(act("Pune"), ctxFor(observeForm(document)));
    expect(res).toMatchObject({ executed: false, error: "No suggestions appeared" });
    expect(input.value).toBe("");
  });

  it("a page that ignores the click leaves the list open: reported as failed, not as filled", async () => {
    const { input } = autocomplete({ data: ["Pune"], selectOnClick: false });
    const res = await executeAction(act("Pune"), ctxFor(observeForm(document)));
    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/stayed open/);
    expect(input.value).toBe("");
  });

  it("verification catches a blur-time 'choose a suggestion' error even if the text matches", async () => {
    const { input, msg } = autocomplete({ data: ["Pune"] });
    const o = observeForm(document);
    input.value = "Pune"; // text typed, but the page has no selection
    input.focus(); // as left by the fill action, so the verifier's blur is a real blur
    const v = await verifyFill(plan("field_001", act("Pune")), o.fields[0], o.targets.get("field_001"));
    expect(msg.textContent).toBe("Please choose one of the suggestions");
    expect(v.verified).toBe(false);
    expect(v.reason).toContain("Please choose one of the suggestions");
  });
});

describe("validation message scan does not steal the next control's error", () => {
  it("an error that follows a different control is not attributed to this one", async () => {
    document.body.innerHTML = '<div><input id="a"><input id="b"><span class="error">Required</span></div>';
    const o = observeForm(document);
    (document.getElementById("a") as HTMLInputElement).value = "x";
    const v = await verifyFill({ fieldId: "field_001", action: { type: "fill_text", fieldId: "field_001", value: "x" }, semanticType: "email", label: "a", required: false }, o.fields[0], o.targets.get("field_001"));
    expect(v.verified).toBe(true);
  });
});

describe("listbox association", () => {
  it("a dropdown without aria-controls does not borrow another dropdown's list", () => {
    document.body.innerHTML = `<span id="l1">Country</span>
      <div id="c1" role="combobox" aria-haspopup="listbox" aria-controls="lb1" aria-labelledby="l1">Select...</div>
      <ul id="lb1" role="listbox" hidden><li role="option">India</li></ul>
      <span id="l2">Degree</span>
      <button id="c2" type="button" aria-haspopup="listbox" aria-labelledby="l2 c2">Choose a degree</button><div id="slot"></div>`;
    const [country, degree] = observeForm(document).fields;
    expect(country!.options.map((o) => o.label)).toEqual(["India"]);
    expect(degree!.options).toEqual([]); // unknown until opened, never the country list
  });

  it("finds a list inside the slot that follows the trigger once it appears", () => {
    document.body.innerHTML = '<button id="c" type="button" aria-haspopup="listbox">Pick</button><div id="slot"><ul role="listbox"><li role="option">A</li></ul></div>';
    const fields = observeForm(document).fields;
    expect(fields[0]!.options.map((o) => o.label)).toEqual(["A"]);
  });
});
