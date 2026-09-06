/** Read API failures without replacing the server's message with a JSON parser error. */
export async function readDramaResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); } catch { /* Proxies and upstream services can send plain text or HTML. */ }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const payload = value as Record<string, unknown>;
    if (!payload.message && typeof payload.error === "string") payload.message = payload.error;
    return payload;
  }
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const serverMessage = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").trim();
  const message = serverMessage || "The server returned an empty response.";
  throw new Error(`The request could not be completed (${status}).\n${message}\nYour current inputs have been kept. Please try again when the service is available.`);
}
