// Subpath entry points of heavy libraries that ship no adjacent type declarations. They are loaded lazily with
// dynamic import() and narrowed to the small interfaces in extract.ts. (The pdfjs legacy build ships its own types.)
declare module "mammoth/mammoth.browser" {
  const mammoth: unknown;
  export default mammoth;
}
declare module "pdfjs-dist/build/pdf.mjs" {
  export const getDocument: (src: unknown) => unknown;
  export const GlobalWorkerOptions: { workerSrc: string };
}
