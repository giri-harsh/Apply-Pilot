import type { LayoutConfig, TailoredLine, TailoredResume, TailoredSection } from "../schema";

/** Helpers shared by the PDF layout engine and the DOCX exporter so both use the same section order and link rules. */

/** Header first, then sections in config.sectionOrder, then any section the order does not name (never silently hidden). */
export function orderedSections(tailored: TailoredResume, config: LayoutConfig): TailoredSection[] {
  const header = tailored.sections.filter((s) => s.key === "header");
  const rest = tailored.sections.filter((s) => s.key !== "header");
  const rank = (s: TailoredSection) => {
    const i = (config.sectionOrder as readonly string[]).indexOf(s.key);
    return i === -1 ? config.sectionOrder.length : i;
  };
  const indexed = rest.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i);
  return [...header, ...indexed.map((x) => x.s)];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Link target for a line: its explicit url, or mailto: for a bare email address. Only http(s), mailto and tel are linkable.
 * Returns null when there is nothing safe to link.
 */
export function linkTarget(line: Pick<TailoredLine, "text" | "url">): string | null {
  const raw = (line.url ?? "").trim();
  if (raw) {
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
    if (EMAIL.test(raw)) return `mailto:${raw}`;
    if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw)) return `https://${raw}`;
    return null;
  }
  const t = line.text.trim();
  return EMAIL.test(t) ? `mailto:${t}` : null;
}

/** Split "Languages: Python, SQL" into a bold label and the rest; null when there is no short label. */
export function splitSkillLabel(text: string): { label: string; rest: string } | null {
  const i = text.indexOf(":");
  if (i <= 0 || i > 40) return null;
  return { label: text.slice(0, i + 1), rest: text.slice(i + 1) };
}

export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
