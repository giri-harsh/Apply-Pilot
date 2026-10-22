/**
 * Output filenames (SPEC 7.7): `Company_Role_Resume_YYYY-MM-DD.pdf`. ASCII only, no personal information (never the
 * applicant's name, email or phone), no path characters, bounded length, and a short suffix when the name is already taken.
 *
 * The kind marker (`_Resume_` / `_CoverLetter_`) is also what the upload module reads to know what a file is, so it must
 * stay exactly as written here.
 */

export type DocKind = "Resume" | "CoverLetter";

const MAX_PART = 24;

function asciiPart(input: string): string {
  const folded = input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = folded
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.join("-").slice(0, MAX_PART).replace(/^-+|-+$/g, "");
}

/** `2026-10-22` from a Date, in UTC so the same instant always gives the same name. */
export function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resumeFilename(opts: { company: string; role: string; kind?: DocKind; date: Date; ext?: "pdf" | "docx"; taken?: ReadonlySet<string> }): string {
  const kind = opts.kind ?? "Resume";
  const ext = opts.ext ?? "pdf";
  const company = asciiPart(opts.company) || "Company";
  const role = asciiPart(opts.role) || "Role";
  const base = `${company}_${role}_${kind}_${dateStamp(opts.date)}`;
  const taken = opts.taken ?? new Set<string>();
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.${ext}`;
  return name;
}

/** Which kind of document a filename declares, or null. The only thing the upload module trusts about a file's role. */
export function kindFromFilename(filename: string): DocKind | null {
  if (/_CoverLetter_/.test(filename)) return "CoverLetter";
  if (/_Resume_/.test(filename)) return "Resume";
  return null;
}
