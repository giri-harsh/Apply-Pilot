/** Small DOM helpers shared by the observation modules. No page mutation happens here. */

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Text of a node ignoring form controls and script/style content (e.g. a <label> that wraps its input). */
export function textWithoutControls(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll("input,select,textarea,button,script,style,option").forEach((n) => n.remove());
  return normalizeText(clone.textContent);
}

export function documentHasLayout(doc: Document): boolean {
  const b = doc.body?.getBoundingClientRect();
  const h = doc.documentElement.getBoundingClientRect();
  return (b?.height ?? 0) > 0 || h.height > 0;
}

export function isVisible(el: Element): boolean {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true") return false;
    const cs = view.getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  }
  if (documentHasLayout(doc)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
  }
  return true;
}

export function isEnabled(el: Element): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  if (el.closest("fieldset[disabled]")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  return true;
}

export function isReadOnly(el: Element): boolean {
  return Boolean((el as HTMLInputElement).readOnly) || el.getAttribute("aria-readonly") === "true";
}

export function textOfIds(doc: Document, ids: string | null): string {
  if (!ids) return "";
  return normalizeText(
    ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((n): n is HTMLElement => Boolean(n))
      .map((n) => textWithoutControls(n))
      .join(" "),
  );
}
