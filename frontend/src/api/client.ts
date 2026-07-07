import type { Trace } from "../types/trace";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export interface TraceResult {
  trace: Trace;
  traceId: string | null;
}

export async function requestTrace(code: string, stdin: string): Promise<TraceResult> {
  const response = await fetch(`${BASE}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, stdin }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${response.status})`);
  }
  return {
    trace: (await response.json()) as Trace,
    traceId: response.headers.get("X-Trace-Id"),
  };
}

export async function fetchSharedTrace(traceId: string): Promise<Trace> {
  const response = await fetch(`${BASE}/api/trace/${encodeURIComponent(traceId)}`);
  if (!response.ok) throw new Error("This share link has no stored trace.");
  return (await response.json()) as Trace;
}
