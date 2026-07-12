// Shareable lab scenarios: a `?lab=<base64url json>` URL parameter that
// reopens a lab with the exact inputs and auto-runs it. Payloads carry data
// by VALUE (never ids). decodeLab distrusts everything: every field is
// validated and clamped against the same caps the UIs enforce, and garbage
// returns null instead of throwing.

import { MAX_ARRIVAL, MAX_BURST, MAX_PROCS, SCHED_ALGOS, type ProcSpec, type SchedAlgo } from "./sched.ts";
import { MAX_FRAMES, MAX_PAGE, MAX_REFS, PAGE_ALGOS, type PageAlgo } from "./paging.ts";
import { MAX_WG_EDGES, MAX_WG_VERTICES, WEIGHT_MAX, WEIGHT_MIN, WGRAPH_ALGOS, type WAlgo } from "./wgraph.ts";

export const SORT_KEYS = ["bubble", "insertion", "selection", "merge", "quick", "heap"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type LabLink =
  | { lab: "sched"; algo: SchedAlgo; q: number; procs: ProcSpec[]; race?: SchedAlgo }
  | { lab: "paging"; algo: PageAlgo; frames: number; refs: number[]; race?: PageAlgo }
  | { lab: "wgraph"; directed: boolean; verts: number[]; edges: [number, number, number][]; algo?: WAlgo; from?: number; to?: number }
  | { lab: "sortrace"; a: SortKey; b: SortKey; values: number[] };

const V_MIN = -999;
const V_MAX = 9999;

// base64url without padding — URL-safe and compact enough for these payloads.
export function encodeLab(link: LabLink): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(link))));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const intIn = (x: unknown, lo: number, hi: number): x is number => isInt(x) && x >= lo && x <= hi;

export function decodeLab(raw: string): LabLink | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const x = JSON.parse(json) as Record<string, unknown>;
    if (typeof x !== "object" || x === null) return null;

    if (x.lab === "sched") {
      const algoOk = (a: unknown): a is SchedAlgo => SCHED_ALGOS.some((m) => m.key === a);
      if (!algoOk(x.algo)) return null;
      if (!intIn(x.q, 1, 12)) return null;
      if (!Array.isArray(x.procs) || x.procs.length < 1 || x.procs.length > MAX_PROCS) return null;
      const procs: ProcSpec[] = [];
      for (const p of x.procs as Record<string, unknown>[]) {
        if (typeof p !== "object" || p === null) return null;
        if (typeof p.name !== "string" || p.name.length === 0) return null;
        if (!intIn(p.arrival, 0, MAX_ARRIVAL) || !intIn(p.burst, 1, MAX_BURST) || !intIn(p.priority, 1, 99)) return null;
        procs.push({ name: p.name.slice(0, 6), arrival: p.arrival, burst: p.burst, priority: p.priority });
      }
      if (new Set(procs.map((p) => p.name)).size !== procs.length) return null;
      if (x.race !== undefined && !algoOk(x.race)) return null;
      return { lab: "sched", algo: x.algo, q: x.q, procs, ...(x.race !== undefined ? { race: x.race as SchedAlgo } : {}) };
    }

    if (x.lab === "paging") {
      const algoOk = (a: unknown): a is PageAlgo => PAGE_ALGOS.some((m) => m.key === a);
      if (!algoOk(x.algo)) return null;
      if (!intIn(x.frames, 1, MAX_FRAMES)) return null;
      if (!Array.isArray(x.refs) || x.refs.length < 1 || x.refs.length > MAX_REFS) return null;
      if (!x.refs.every((r) => intIn(r, 0, MAX_PAGE))) return null;
      if (x.race !== undefined && !algoOk(x.race)) return null;
      return { lab: "paging", algo: x.algo, frames: x.frames, refs: x.refs as number[], ...(x.race !== undefined ? { race: x.race as PageAlgo } : {}) };
    }

    if (x.lab === "wgraph") {
      if (typeof x.directed !== "boolean") return null;
      if (!Array.isArray(x.verts) || x.verts.length > MAX_WG_VERTICES) return null;
      if (!x.verts.every((v) => intIn(v, V_MIN, V_MAX))) return null;
      const verts = x.verts as number[];
      if (new Set(verts).size !== verts.length) return null;
      if (!Array.isArray(x.edges) || x.edges.length > MAX_WG_EDGES) return null;
      const edges: [number, number, number][] = [];
      for (const e of x.edges as unknown[]) {
        if (!Array.isArray(e) || e.length !== 3) return null;
        const [a, b, w] = e as unknown[];
        if (!intIn(a, V_MIN, V_MAX) || !intIn(b, V_MIN, V_MAX) || !intIn(w, WEIGHT_MIN, WEIGHT_MAX)) return null;
        if (a === b || !verts.includes(a) || !verts.includes(b)) return null;
        edges.push([a, b, w]);
      }
      if (x.algo !== undefined && !WGRAPH_ALGOS.some((m) => m.key === x.algo)) return null;
      if (x.from !== undefined && (!isInt(x.from) || !verts.includes(x.from))) return null;
      if (x.to !== undefined && (!isInt(x.to) || !verts.includes(x.to))) return null;
      return {
        lab: "wgraph", directed: x.directed, verts, edges,
        ...(x.algo !== undefined ? { algo: x.algo as WAlgo } : {}),
        ...(x.from !== undefined ? { from: x.from } : {}),
        ...(x.to !== undefined ? { to: x.to } : {}),
      };
    }

    if (x.lab === "sortrace") {
      const keyOk = (k: unknown): k is SortKey => SORT_KEYS.includes(k as SortKey);
      if (!keyOk(x.a) || !keyOk(x.b)) return null;
      if (!Array.isArray(x.values) || x.values.length < 2 || x.values.length > 16) return null;
      if (!x.values.every((v) => intIn(v, V_MIN, V_MAX))) return null;
      return { lab: "sortrace", a: x.a, b: x.b, values: x.values as number[] };
    }

    return null;
  } catch {
    return null;
  }
}

/** Reflect a scenario in the URL (or clear it). One URL = one artifact:
    writing a lab link removes any tracer `?t=` id, and vice versa. */
export function writeLabParam(link: LabLink | null): void {
  const url = new URL(window.location.href);
  if (link) url.searchParams.set("lab", encodeLab(link));
  else url.searchParams.delete("lab");
  url.searchParams.delete("t");
  window.history.replaceState(null, "", url.toString());
}

export function readLabParam(): LabLink | null {
  const raw = new URLSearchParams(window.location.search).get("lab");
  return raw ? decodeLab(raw) : null;
}
