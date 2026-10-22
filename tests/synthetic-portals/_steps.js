// Tiny single-page "wizard" engine for the multi-step synthetic portals. Behaviour is driven by window.CFG:
//   steps: [{ title, fields: [...], next: "Next" | null, finalText, review }]
//   field: { label, type, options, optionsBy, dependsOn, required, keyCommit, disabledFor, disabled }
//   rotate: re-create every id and alternate label markup on each step (the DOM changes on every step)
//   endless: after the configured steps, keep producing another step with a "City" field
//   revealMore: filling a field reveals one more fillable field (never converges)
(function () {
  var CFG = window.CFG;
  var app = document.getElementById("app");
  var stepIndex = 0;
  var values = {};
  var counter = 0;
  var MORE = ["City", "Country", "State", "Postal code", "Phone", "LinkedIn", "GitHub", "Email", "First name", "Last name", "Full name", "Website"];
  var moreShown = 1;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  function stepConfig(i) {
    if (CFG.steps[i]) return CFG.steps[i];
    if (CFG.endless) return { title: "Step " + (i + 1), fields: [{ label: "City" }], next: "Next" };
    return null;
  }

  function makeField(f) {
    counter++;
    var id = CFG.rotate ? "f" + counter + "_" + Math.random().toString(36).slice(2, 7) : "fld_" + f.label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    var wrap = el("div", { class: "row", "data-label": f.label });
    var input;
    if (f.type === "select") {
      input = el("select", { id: id, name: id });
      input.appendChild(el("option", { value: "" }, "Select..."));
      (f.options || []).forEach(function (o) { input.appendChild(el("option", { value: o }, o)); });
    } else {
      input = el("input", { id: id, name: id, type: f.type || "text" });
    }
    if (f.required) input.required = true;
    if (f.disabled) input.disabled = true;
    if (f.disabledFor) {
      input.disabled = true;
      window.setTimeout(function () { input.disabled = false; }, f.disabledFor);
    }
    var wrapLabel = CFG.rotate && counter % 2 === 0;
    var text = f.label + (f.required ? " *" : "");
    if (wrapLabel) {
      var l = el("label", {}, text + " ");
      l.appendChild(input);
      wrap.appendChild(l);
    } else {
      wrap.appendChild(el("label", { for: id }, text));
      wrap.appendChild(input);
    }
    var err = el("div", { class: "field-error", id: id + "_err", hidden: "" }, "Enter a valid value");
    wrap.appendChild(err);

    function markInvalid() { input.setAttribute("aria-invalid", "true"); err.hidden = false; input.setAttribute("aria-describedby", err.id); }
    function markValid() { input.removeAttribute("aria-invalid"); err.hidden = true; }

    if (f.keyCommit) {
      // The page only accepts a value that arrived through key events (the keyboard fallback case).
      var committed = false;
      input.addEventListener("input", function () { committed = false; markInvalid(); });
      input.addEventListener("keyup", function () { committed = true; markValid(); window.__keyCommits = (window.__keyCommits || 0) + 1; });
      input.addEventListener("change", function () { if (!committed) markInvalid(); });
    }
    input.addEventListener("change", function () {
      values[f.label] = input.value;
      if (f.label === "Country") revealDependents(input.value);
      if (CFG.revealMore && input.value && moreShown < MORE.length && wrap === Array.prototype.slice.call(app.querySelectorAll(".row")).pop()) {
        // Reveal one more fillable field after every fill (never converges); existing rows stay untouched.
        var nf = makeField({ label: MORE[moreShown++] });
        wrap.parentNode.insertBefore(nf, app.querySelector(".bar"));
      }
    });
    wrap.__field = f;
    return wrap;
  }

  function revealDependents(parentValue) {
    Array.prototype.forEach.call(app.querySelectorAll(".row"), function (row) {
      var f = row.__field;
      if (!f || f.dependsOn !== "Country") return;
      var sel = row.querySelector("select");
      var list = (f.optionsBy || {})[parentValue];
      sel.innerHTML = "";
      sel.appendChild(el("option", { value: "" }, "Select..."));
      (list || []).forEach(function (o) { sel.appendChild(el("option", { value: o }, o)); });
      row.hidden = !list;
    });
  }

  function render(keep) {
    var cfg = stepConfig(stepIndex);
    if (!cfg) return;
    if (!keep) moreShown = 1;
    var form = el("form", { id: "wizard" });
    if (CFG.formAction) { form.setAttribute("action", CFG.formAction); form.setAttribute("method", "post"); }
    form.appendChild(el("h1", {}, CFG.company || "Wizard Co"));
    form.appendChild(el("h2", {}, cfg.title));
    if (CFG.indicator) form.appendChild(el("div", { class: "steps" }, "Step " + (stepIndex + 1) + " of " + CFG.indicator));
    var fields = cfg.fields.slice();
    if (CFG.revealMore) fields = MORE.slice(0, moreShown).map(function (l) { return { label: l }; });
    fields.forEach(function (f) {
      var row = makeField(f);
      if (f.dependsOn) row.hidden = true;
      if (keep && values[f.label]) { var inp = row.querySelector("input,select"); if (inp && inp.tagName === "INPUT") inp.value = values[f.label]; }
      form.appendChild(row);
    });
    if (cfg.review) form.appendChild(el("p", { id: "summary" }, "Name: " + (values["Full name"] || "") + " Email: " + (values["Email"] || "")));
    var bar = el("div", { class: "bar" });
    if (stepIndex > 0 && !CFG.noBack) bar.appendChild(el("button", { type: "button", id: "back" }, "Back"));
    if (CFG.saveDraft) bar.appendChild(el("button", { type: "button", id: "draft" }, "Save draft"));
    if (cfg.next) {
      var btn = el("button", { type: CFG.nextSubmits ? "submit" : "button", id: "next" }, cfg.next);
      btn.addEventListener("click", function (ev) {
        if (CFG.nextSubmits) return; // real form submit; _common.js records it and cancels it
        ev.preventDefault();
        stepIndex++;
        render(false);
      });
      bar.appendChild(btn);
    } else if (cfg.finalText) {
      bar.appendChild(el("button", { type: "submit", id: "final" }, cfg.finalText));
    }
    form.appendChild(bar);
    app.innerHTML = "";
    app.appendChild(form);
    var back = document.getElementById("back");
    if (back) back.addEventListener("click", function () { stepIndex--; render(false); });
    if (CFG.mutate) {
      // Layout churn after render, as dynamic portals do: wrap everything in a new container once.
      window.setTimeout(function () { var c = el("section", { class: "mutated" }); while (form.firstChild) c.appendChild(form.firstChild); form.appendChild(c); }, 30);
    }
  }
  render(false);
})();
