/** Pure `accept` attribute handling for file inputs. No DOM access. */

export type DocFormat = "pdf" | "docx" | "txt";

export const FORMAT_INFO: Record<DocFormat, { ext: string; mime: string }> = {
  pdf: { ext: ".pdf", mime: "application/pdf" },
  docx: { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  txt: { ext: ".txt", mime: "text/plain" },
};

export function acceptTokens(accept: string): string[] {
  return accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/** Does the `accept` list admit a file with this extension (".pdf", lower case) and MIME type? Empty accept admits everything. */
export function acceptAdmits(accept: string, ext: string, mime: string): boolean {
  const tokens = acceptTokens(accept);
  if (tokens.length === 0) return true;
  const e = ext.toLowerCase();
  const m = mime.toLowerCase();
  return tokens.some((t) => {
    if (t === "*" || t === "*/*") return true;
    if (t.startsWith(".")) return e !== "" && t === e;
    if (t.endsWith("/*")) return m.startsWith(t.slice(0, -1));
    if (t.includes("/")) return t === m;
    return false; // a bare word is not valid in `accept`; browsers ignore it, so do we
  });
}

export function acceptsFormat(accept: string, format: DocFormat): boolean {
  const info = FORMAT_INFO[format];
  return acceptAdmits(accept, info.ext, info.mime);
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
  return m ? `.${m[1]!.toLowerCase()}` : "";
}

/** Defence in depth at commit time: does the field's accept list admit this concrete file? */
export function acceptsFile(accept: string, filename: string, mime: string): boolean {
  return acceptAdmits(accept, extensionOf(filename), mime);
}
