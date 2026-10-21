// Shared instrumentation for synthetic portals. Records anything a test might need to prove did NOT happen.
window.__events = [];
window.__submitted = false;
document.addEventListener(
  "click",
  (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest("button, a, input[type=submit], input[type=button]")) {
      window.__events.push({ type: "click", id: t.id || null, text: (t.textContent || t.value || "").trim().slice(0, 40) });
    }
  },
  true,
);
document.addEventListener(
  "submit",
  (e) => {
    e.preventDefault();
    window.__submitted = true;
    window.__events.push({ type: "submit" });
  },
  true,
);
