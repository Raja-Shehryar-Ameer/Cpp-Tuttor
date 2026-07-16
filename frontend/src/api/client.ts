import type { Trace } from "../types/trace";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const TRACE_TIMEOUT_MS = 90_000; // compile + GDB drive can legitimately take a while

export type TracerLanguage = "cpp" | "c";

export interface TraceResult {
  trace: Trace;
  traceId: string | null;
}

/** Turn fetch's cryptic failures into messages a student can act on. */
function friendly(error: unknown): Error {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new Error(
      "The tracer took too long to answer — the program may loop forever, or the backend is overloaded. Try simpler code or restart the backend.",
    );
  }
  if (error instanceof TypeError) {
    return new Error(
      `Can't reach the Shinso backend at ${BASE} — make sure it is running (uvicorn on port 8000), then try again.`,
    );
  }
  return error instanceof Error ? error : new Error("Request failed.");
}

export async function requestTrace(
  code: string,
  stdin: string,
  language: TracerLanguage = "cpp",
): Promise<TraceResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, stdin, language }),
      signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
    });
  } catch (error) {
    throw friendly(error);
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => null);
    throw new Error(detail ?? `The backend rejected the request (HTTP ${response.status}).`);
  }
  try {
    return {
      trace: (await response.json()) as Trace,
      traceId: response.headers.get("X-Trace-Id"),
    };
  } catch {
    throw new Error("The backend answered with something that isn't a trace — check its logs.");
  }
}

export async function fetchSharedTrace(traceId: string): Promise<Trace> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/trace/${encodeURIComponent(traceId)}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw friendly(error);
  }
  if (!response.ok) throw new Error("This share link has no stored trace.");
  return (await response.json()) as Trace;
}
