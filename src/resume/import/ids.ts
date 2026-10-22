/** cyrb53 string hash, 53 bits, rendered as 12 hex digits. Sync and deterministic: used only for stable ids, not security. */
export function hash12(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(12, "0");
}

/** `<kind>_<position>_<hash of the text>`: re-importing the same file yields the same ids. */
export function stableId(kind: string, position: string, text: string): string {
  return `${kind}_${position}_${hash12(`${kind}|${position}|${text}`)}`.slice(0, 80);
}
