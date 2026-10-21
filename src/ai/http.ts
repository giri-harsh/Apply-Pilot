import { AIError, classifyHttpError } from "./errors";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * POSTs JSON with an AbortController timeout. Errors are classified without ever echoing the request,
 * the headers (which hold the key) or the response body.
 */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  maxResponseChars: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (e) {
    clearTimeout(timer);
    if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new AIError("timeout", "aborted");
    throw new AIError("network", "fetch_failed");
  }
  try {
    const text = await res.text();
    if (!res.ok) throw classifyHttpError(res.status, text);
    if (text.length > maxResponseChars) throw new AIError("invalid_response", "response_too_large");
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError("invalid_response", "not_json");
    }
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (controller.signal.aborted) throw new AIError("timeout", "aborted");
    throw new AIError("network", "read_failed");
  } finally {
    clearTimeout(timer);
  }
}
