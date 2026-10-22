import type { ChooseFileForFieldFn } from "@/resume/contracts";
import type { FileRef } from "@/resume/schema";
import { acceptsFormat, type DocFormat } from "./accept";

/** PDF first (page-validated, layout-stable), then DOCX, then plain text as a last resort. */
const PREFERENCE: DocFormat[] = ["pdf", "docx", "txt"];

function newest(files: FileRef[]): FileRef {
  return [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
}

/**
 * Decides which stored file may go into a field. Pure.
 *  - A resume only ever comes from `available.resume`, a cover letter only from `available.coverLetter`;
 *    "other" and "ambiguous" fields get nothing, and neither does a field that already holds a file.
 *  - `accept` is respected. PDF is preferred when several formats are accepted. An empty accept admits everything.
 *  - A file whose page count was never read back (DOCX, unvalidated PDF) comes with a "not page-validated" warning.
 */
export const chooseFileForField: ChooseFileForFieldFn = (field, available) => {
  if (field.hasFile) return { file: null, warning: null, reason: "The field already holds a file; it is never replaced" };
  if (field.classification === "ambiguous") return { file: null, warning: null, reason: "Ambiguous attachment field; skipped rather than guessed" };
  if (field.classification === "other") return { file: null, warning: null, reason: "Field asks for a different document (not a resume or cover letter)" };

  const pool = field.classification === "resume" ? available.resume : available.coverLetter;
  const noun = field.classification === "resume" ? "resume" : "cover letter";
  if (pool.length === 0) return { file: null, warning: null, reason: `No ${noun} file is available` };

  const accepted = pool.filter((f) => acceptsFormat(field.accept, f.format));
  if (accepted.length === 0) {
    const have = [...new Set(pool.map((f) => f.format))].join("/");
    return { file: null, warning: null, reason: `The field accepts "${field.accept}", which none of the available ${noun} formats (${have}) satisfy` };
  }
  for (const format of PREFERENCE) {
    const ofFormat = accepted.filter((f) => f.format === format);
    if (ofFormat.length === 0) continue;
    const file = newest(ofFormat);
    const warning = file.pageValidated ? null : `${format.toUpperCase()} ${noun} is not page-validated`;
    return { file, warning, reason: `Chose the ${format.toUpperCase()} ${noun}` + (field.accept.trim() ? ` (accept: ${field.accept})` : "") };
  }
  return { file: null, warning: null, reason: "No acceptable file" };
};
