export type LeakFinding = { path: string; kind: string };
export type Refused = { name: string; reason: string; findings: LeakFinding[] };
export function leakFindings(capture: unknown): LeakFinding[];
export function screen(files: { name: string; json: unknown }[]): { clean: Record<string, unknown>[]; refused: Refused[] };
export function summarize(result: { clean: Record<string, unknown>[]; refused: Refused[] }): string;
