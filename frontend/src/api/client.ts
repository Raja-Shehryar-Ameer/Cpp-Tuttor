import type { Trace } from "../types/trace";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export async function requestTrace(code: string, stdin: string): Promise<Trace> {
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
  return (await response.json()) as Trace;
}

export async function fetchStaticTrace(url: string): Promise<Trace> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return (await response.json()) as Trace;
}
