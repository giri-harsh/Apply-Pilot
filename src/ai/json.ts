import type { JsonSchema } from "./types";

/**
 * One tolerant extraction pass for models that wrap JSON in prose or code fences.
 * Returns the parsed value or throws; the caller maps a throw to `invalid_response`.
 */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("No JSON found");
}

const GEMINI_KEEP = new Set([
  "type",
  "properties",
  "items",
  "required",
  "enum",
  "description",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "nullable",
  "format",
]);

/**
 * Converts our JSON Schema into the OpenAPI-subset `responseSchema` Gemini accepts: inlines $ref, drops
 * unsupported keywords (additionalProperties, $schema, title, default, pattern...), upper-cases types and
 * turns `anyOf: [X, {type:"null"}]` into `X + nullable`. Zod stays the real validator.
 */
export function toGeminiSchema(schema: JsonSchema, root: JsonSchema = schema): JsonSchema {
  const resolve = (s: JsonSchema): JsonSchema => {
    if (typeof s["$ref"] === "string") {
      const path = (s["$ref"] as string).replace(/^#\//, "").split("/");
      let cur: unknown = root;
      for (const p of path) cur = (cur as Record<string, unknown>)?.[p];
      if (!cur || typeof cur !== "object") throw new Error(`Unresolvable $ref ${String(s["$ref"])}`);
      return resolve(cur as JsonSchema);
    }
    return s;
  };

  let s = resolve(schema);
  if (Array.isArray(s["anyOf"])) {
    const options = (s["anyOf"] as JsonSchema[]).map(resolve);
    const nonNull = options.filter((o) => o["type"] !== "null");
    if (nonNull.length === 1 && options.length === 2) s = { ...nonNull[0]!, nullable: true };
    else throw new Error("anyOf is not supported by Gemini response schemas");
  }
  if (Array.isArray(s["type"])) {
    const types = (s["type"] as string[]).filter((x) => x !== "null");
    s = { ...s, type: types[0], ...(types.length !== (s["type"] as string[]).length ? { nullable: true } : {}) };
  }

  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(s)) {
    if (!GEMINI_KEEP.has(k)) continue;
    if (k === "type") out[k] = String(v).toUpperCase();
    else if (k === "properties") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, JsonSchema>).map(([pk, pv]) => [pk, toGeminiSchema(pv, root)]));
    } else if (k === "items") out[k] = toGeminiSchema(v as JsonSchema, root);
    else out[k] = v;
  }
  return out;
}

/** Cheap structural JSON-Schema validator for tests: type/enum/required/properties/items/bounds. */
export function validateAgainstJsonSchema(value: unknown, schema: JsonSchema): boolean {
  const t = schema["type"];
  const types = Array.isArray(t) ? (t as string[]) : t ? [t as string] : [];
  const typeOk = (x: unknown) =>
    types.length === 0 ||
    types.some((ty) =>
      ty === "null" ? x === null
      : ty === "array" ? Array.isArray(x)
      : ty === "integer" ? Number.isInteger(x)
      : ty === "object" ? typeof x === "object" && x !== null && !Array.isArray(x)
      : typeof x === ty,
    );
  if (!typeOk(value)) return false;
  const en = schema["enum"] as unknown[] | undefined;
  if (en && !en.includes(value)) return false;
  if (typeof value === "string") {
    if (typeof schema["maxLength"] === "number" && value.length > (schema["maxLength"] as number)) return false;
    if (typeof schema["minLength"] === "number" && value.length < (schema["minLength"] as number)) return false;
  }
  if (typeof value === "number") {
    if (typeof schema["minimum"] === "number" && value < (schema["minimum"] as number)) return false;
    if (typeof schema["maximum"] === "number" && value > (schema["maximum"] as number)) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema["maxItems"] === "number" && value.length > (schema["maxItems"] as number)) return false;
    const items = schema["items"] as JsonSchema | undefined;
    if (items && !value.every((v) => validateAgainstJsonSchema(v, items))) return false;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] ?? {}) as Record<string, JsonSchema>;
    for (const r of (schema["required"] as string[] | undefined) ?? []) if (!(r in obj)) return false;
    if (schema["additionalProperties"] === false && Object.keys(obj).some((k) => !(k in props))) return false;
    for (const [k, v] of Object.entries(obj)) if (props[k] && !validateAgainstJsonSchema(v, props[k]!)) return false;
  }
  return true;
}
