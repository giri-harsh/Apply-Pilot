/**
 * In-page status indicator (SPEC 5.3). A small pill in a corner of the page, inside a shadow root so the page's CSS
 * cannot restyle it and ours cannot leak out. It sits outside the normal flow, never covers a form control (it moves to a
 * free corner, or shrinks to a tab, when it would), can be collapsed, and has a Stop button that halts the run immediately.
 * Nothing in it is a form control the observer can see: the shadow root is not traversed by the page scanner.
 */

export const HOST_ID = "applypilot-indicator-host";

type View = { label: string; tone: "working" | "done" | "blocked"; canStop: boolean; autoHideMs: number | null };
type Corner = "br" | "bl" | "tr" | "tl";

const CSS = `
  :host { all: initial; }
  .pill { position: fixed; z-index: 2147483647; font: 12px/1.3 system-ui, sans-serif; color: #fff; background: #1f2937; border: 1px solid #4b5563; border-radius: 999px; padding: 4px 6px 4px 10px; display: inline-flex; align-items: center; gap: 6px; max-width: 280px; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  .pill.working { background: #1d4ed8; border-color: #93c5fd; }
  .pill.done { background: #166534; border-color: #86efac; }
  .pill.blocked { background: #92400e; border-color: #fcd34d; }
  .pill.br { right: 12px; bottom: 12px; } .pill.bl { left: 12px; bottom: 12px; } .pill.tr { right: 12px; top: 12px; } .pill.tl { left: 12px; top: 12px; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 999px; background: #fff; color: #111827; font-weight: 600; font-size: 11px; }
  button.ghost { background: transparent; color: #fff; padding: 2px 6px; }
  button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  .collapsed .label, .collapsed .stop { display: none; }
`;

const CONTROL = "input, select, textarea, button, a[href], [role=button], [role=combobox], [contenteditable=true]";
const intersects = (a: DOMRect, b: DOMRect, pad = 6) => !(a.right + pad < b.left || a.left - pad > b.right || a.bottom + pad < b.top || a.top - pad > b.bottom);

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let pill: HTMLElement | null = null;
let label: HTMLElement | null = null;
let stopBtn: HTMLButtonElement | null = null;
let collapseBtn: HTMLButtonElement | null = null;
let collapsed = false;
let view: View | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let watch: ReturnType<typeof setInterval> | undefined;
let corner: Corner = "br";

export function isShown(): boolean {
  return host !== null && host.isConnected;
}

function visibleControlRects(doc: Document): DOMRect[] {
  const out: DOMRect[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(CONTROL))) {
    if (el === host) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > doc.defaultView!.innerHeight || r.right < 0 || r.left > doc.defaultView!.innerWidth) continue;
    out.push(r);
  }
  return out;
}

/** The first corner whose pill rectangle touches no visible control; null when every corner is taken. */
function freeCorner(doc: Document, size: { w: number; h: number }): Corner | null {
  const W = doc.defaultView!.innerWidth;
  const H = doc.defaultView!.innerHeight;
  const rects = visibleControlRects(doc);
  const at: Record<Corner, DOMRect> = {
    br: new DOMRect(W - 12 - size.w, H - 12 - size.h, size.w, size.h),
    bl: new DOMRect(12, H - 12 - size.h, size.w, size.h),
    tr: new DOMRect(W - 12 - size.w, 12, size.w, size.h),
    tl: new DOMRect(12, 12, size.w, size.h),
  };
  for (const c of [corner, "br", "bl", "tr", "tl"] as Corner[]) if (!rects.some((r) => intersects(at[c], r))) return c;
  return null;
}

function place(doc: Document) {
  if (!pill) return;
  pill.classList.remove("collapsed");
  if (collapsed) pill.classList.add("collapsed");
  const r = pill.getBoundingClientRect();
  const size = { w: Math.max(r.width, 28), h: Math.max(r.height, 24) };
  let c = freeCorner(doc, size);
  if (c === null && !collapsed) {
    // every corner would cover a control: shrink to a small tab and look again
    pill.classList.add("collapsed");
    const small = pill.getBoundingClientRect();
    c = freeCorner(doc, { w: Math.max(small.width, 28), h: Math.max(small.height, 24) });
    if (c === null) c = "br";
  } else if (c === null) c = "br";
  corner = c;
  for (const k of ["br", "bl", "tr", "tl"]) pill.classList.remove(k);
  pill.classList.add(c);
}

function ensure(doc: Document, onStop: () => void) {
  if (host && host.isConnected) return;
  host = doc.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-applypilot", "indicator");
  // Inline !important beats the page's own !important rules, so a hostile or sloppy stylesheet cannot hide or move the host.
  for (const [k, v] of [["all", "initial"], ["display", "block"], ["visibility", "visible"], ["opacity", "1"], ["position", "static"], ["transform", "none"], ["filter", "none"], ["pointer-events", "auto"]] as const) host.style.setProperty(k, v, "important");
  // An open shadow root keeps the pill's markup and CSS apart from the page's, and lets tests and assistive tools reach it;
  // the page can read its label and click Stop, which only ever stops automation.
  shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  pill = doc.createElement("div");
  pill.className = "pill br";
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  label = doc.createElement("span");
  label.className = "label";
  stopBtn = doc.createElement("button");
  stopBtn.className = "stop";
  stopBtn.type = "button";
  stopBtn.textContent = "Stop";
  stopBtn.setAttribute("aria-label", "Stop ApplyPilot now");
  stopBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onStop();
  });
  collapseBtn = doc.createElement("button");
  collapseBtn.className = "ghost";
  collapseBtn.type = "button";
  collapseBtn.textContent = "–";
  collapseBtn.setAttribute("aria-label", "Collapse or expand the ApplyPilot status");
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    collapseBtn!.textContent = collapsed ? "+" : "–";
    place(doc);
  });
  pill.append(label, stopBtn, collapseBtn);
  shadow.append(style, pill);
  doc.documentElement.appendChild(host);
  // keep clear of controls as the page changes (steps, revealed fields, scrolling, resizing)
  watch = setInterval(() => place(doc), 700);
}

export function showIndicator(doc: Document, v: View, onStop: () => void) {
  ensure(doc, onStop);
  view = v;
  if (hideTimer) clearTimeout(hideTimer);
  label!.textContent = v.label;
  pill!.classList.remove("working", "done", "blocked");
  pill!.classList.add(v.tone);
  stopBtn!.style.display = v.canStop ? "" : "none";
  place(doc);
  if (v.autoHideMs !== null) hideTimer = setTimeout(() => hideIndicator(), v.autoHideMs);
}

export function hideIndicator() {
  if (hideTimer) clearTimeout(hideTimer);
  if (watch) clearInterval(watch);
  host?.remove();
  host = shadow = pill = label = stopBtn = collapseBtn = null;
  view = null;
  collapsed = false;
}

/** Test hook: the current view (never includes anything but the label and tone). */
export const currentView = (): View | null => view;
