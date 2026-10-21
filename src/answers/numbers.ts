/** Number extraction and comparison for the grounding validator. "30%", "30 percent" and "30" are the same figure. */

export type NumToken = { value: number; raw: string };

const WORDS: Record<string, number> = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000,
};
const MAGNITUDE: Record<string, number> = { k: 1000, thousand: 1000, m: 1_000_000, million: 1_000_000, b: 1_000_000_000, billion: 1_000_000_000 };

/** Every numeric figure in `text`, as a value. Ordinals (1st) and list markers are ignored. */
export function extractNumbers(text: string): NumToken[] {
  const out: NumToken[] = [];
  const re = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(%|percent\b|k\b|m\b|b\b|million\b|billion\b|thousand\b|x\b|st\b|nd\b|rd\b|th\b)?/gi;
  for (const m of text.matchAll(re)) {
    const suffix = (m[2] ?? "").toLowerCase();
    if (["st", "nd", "rd", "th"].includes(suffix)) continue;
    let value = Number(m[1]!.replace(/,/g, ""));
    if (Number.isNaN(value)) continue;
    if (MAGNITUDE[suffix]) value *= MAGNITUDE[suffix]!;
    out.push({ value, raw: m[0].trim() });
  }
  for (const m of text.matchAll(/\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/gi)) {
    // "2 million" is one figure, already counted above as 2,000,000.
    if (/\d[\d,.]*\s*$/.test(text.slice(0, m.index))) continue;
    out.push({ value: WORDS[m[1]!.toLowerCase()]!, raw: m[0] });
  }
  return out;
}

export function numberSet(text: string): Set<number> {
  return new Set(extractNumbers(text).map((n) => n.value));
}
