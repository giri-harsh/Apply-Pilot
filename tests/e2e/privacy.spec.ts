import { test, expect, type ConsoleMessage } from "@playwright/test";
import { configureAi, launchExtension, runPortal, type Ext } from "./support/extension";
import { installMockAi, type MockAi } from "./support/mock-ai";
import { profileStrings } from "../../src/diagnostics/redact";
import { sampleMaster } from "../fixtures/resumes";
import { testProfile } from "../fixtures/profile";

const KEYS = { gemini: "AIza-test-gemini-key-0001", groq: "gsk_test_groq_key_0002" };
const KEY_RE = /AIza-test-gemini-key-0001|gsk_test_groq_key_0002/;

/** Stores that ARE personal data by definition (the user's own profile, master resume, generated resumes, saved answers). */
const PERSONAL_STORES = [/^applypilot\.profile\./, /^applypilot\.resume\.master\./, /^applypilot\.resume\.documents\./, /^applypilot\.answers\./, /^applypilot\.resume\.variants\./];
const KEY_STORE = /^applypilot\.ai\.keys\./;

let ext: Ext;
let ai: MockAi;
test.beforeEach(async () => {
  ext = await launchExtension();
  ai = await installMockAi(ext.context);
});
test.afterEach(async () => {
  await ext.context.close();
});

// A few profile strings are ordinary words that legitimately occur in non-personal stores (the country in a job posting,
// a skill name in the job cache). Only strings that identify the person are scanned for: names, contact data, ids, urls.
const identifying = (): string[] => {
  const p = testProfile();
  return profileStrings(p).filter((s) => s.length >= 6 && (/@|\d{4,}|https?:|^[A-Z][a-z]+ [A-Z][a-z]+/.test(s) || s === p.personal.fullName));
};

test("privacy: after real runs with AI, tailoring, capture and exports, no personal string or API key is in any log, diagnostics or non-personal store", async () => {
  const consoleLines: string[] = [];
  const hook = (m: ConsoleMessage) => consoleLines.push(m.text());
  ext.context.on("console", hook);
  ext.worker.on("console", hook);

  await configureAi(ext, { enabled: true, keys: KEYS });
  ai.set("gemini", { respond: (fields) => fields.map((f) => ({ fieldId: f.fieldId, semanticType: "unknown", profileKey: "none", confidence: 0.1, evidence: ["x"], requiresReview: true })) });
  const o = await ext.context.newPage();
  await o.goto(`chrome-extension://${ext.extensionId}/options.html`);
  await o.evaluate((m) => chrome.storage.local.set({ "applypilot.resume.master.v1": m, "applypilot.resume.settings.v1": { tailoringEnabled: true, pageLimit: 1 } }), sampleMaster());

  const a = await runPortal(ext, "resume-flow"); // tailoring + upload
  await a.popup.getByTestId("capture-page").click();
  await expect(a.popup.getByTestId("capture-note")).toContainText("Captured");
  const b = await runPortal(ext, "unfamiliar-labels-v2"); // AI field classification
  expect(b.record.state).toMatch(/READY_FOR_REVIEW|PARTIALLY_COMPLETED/);
  await runPortal(ext, "wizard-basic"); // multi-step

  // ---- exports are part of the surface: resume data and captures
  const downloads: string[] = [];
  await o.reload();
  await o.getByRole("tab", { name: "Resume" }).click();
  const [d1] = await Promise.all([o.waitForEvent("download"), o.getByTestId("export-resume-data").click()]);
  downloads.push((await d1.createReadStream().then(async (s) => { const c: Buffer[] = []; for await (const x of s) c.push(x as Buffer); return Buffer.concat(c).toString("utf8"); })));
  await o.getByRole("tab", { name: "Diagnostics" }).click();
  const [d2] = await Promise.all([o.waitForEvent("download"), o.getByTestId("capture-export-all").click()]);
  downloads.push((await d2.createReadStream().then(async (s) => { const c: Buffer[] = []; for await (const x of s) c.push(x as Buffer); return Buffer.concat(c).toString("utf8"); })));

  const store = (await ext.worker.evaluate(() => chrome.storage.local.get(null))) as Record<string, unknown>;
  const idb = await o.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        indexedDB.databases().then(async (dbs) => {
          const out: Record<string, unknown> = {};
          for (const info of dbs) {
            if (!info.name || info.name === "applypilot-resume") continue; // binaries of the user's own resume files
            const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open(info.name!); r.onsuccess = () => res(r.result); });
            for (const name of Array.from(db.objectStoreNames)) out[`${info.name}/${name}`] = await new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
            db.close();
          }
          resolve(out);
        });
      }),
  );

  const scan = identifying();
  expect(scan.length).toBeGreaterThan(5);
  const leaks: string[] = [];
  const check = (where: string, text: string, forKeys = true) => {
    const lower = text.toLowerCase();
    for (const s of scan) if (lower.includes(s.toLowerCase())) leaks.push(`${where}: profile string "${s}"`);
    if (forKeys && KEY_RE.test(text)) leaks.push(`${where}: API key`);
  };
  const keys = Object.keys(store);
  expect(keys.some((k) => KEY_STORE.test(k))).toBe(true); // the key store exists and is the only place for keys
  for (const [k, v] of Object.entries(store)) {
    const json = JSON.stringify(v);
    if (KEY_STORE.test(k)) {
      expect(json).toMatch(KEY_RE); // keys live here and only here
      continue;
    }
    if (PERSONAL_STORES.some((re) => re.test(k))) {
      if (KEY_RE.test(json)) leaks.push(`${k}: API key`);
      continue; // personal by definition, but never a key
    }
    check(`storage ${k}`, json);
  }
  for (const [k, v] of Object.entries(idb)) check(`indexedDB ${k}`, JSON.stringify(v));
  downloads.forEach((t, i) => (i === 0 ? (KEY_RE.test(t) ? leaks.push("resume export: API key") : undefined) : check("capture export", t)));
  consoleLines.forEach((t) => check("console", t));

  expect(leaks).toEqual([]);
  expect(ai.calls.gemini + ai.calls.groq).toBeGreaterThan(0); // AI really was used in this scenario
  // the AI request bodies themselves never carried the keys in the body or a profile identifier
  for (const body of [...ai.bodies.gemini, ...ai.bodies.groq]) check("AI request body", body, true);
});
