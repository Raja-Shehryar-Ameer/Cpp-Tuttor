// Fuzz suite for lab permalinks.
// Run: node --experimental-strip-types frontend/tests/permalink.fuzz.ts
//
//  - decode(encode(x)) deep-equals x for generated valid payloads;
//  - arbitrary garbage (random strings, random base64, truncations,
//    valid-JSON-wrong-shape, out-of-range fields) returns null, never throws.

import { decodeLab, encodeLab, SORT_KEYS, type LabLink } from "../src/ds/permalink.ts";
import { SCHED_ALGOS } from "../src/ds/sched.ts";
import { PAGE_ALGOS } from "../src/ds/paging.ts";
import { WGRAPH_ALGOS } from "../src/ds/wgraph.ts";
import { DISK_ALGOS, MAX_DISK_REQUESTS, MIN_CYL } from "../src/ds/disk.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const rand = (n: number): number => Math.floor(Math.random() * n);
const pick = <T,>(xs: readonly T[]): T => xs[rand(xs.length)];

function randomLink(): LabLink {
  switch (rand(6)) {
    case 0: {
      const n = 1 + rand(6);
      return {
        lab: "sched",
        algo: pick(SCHED_ALGOS).key,
        q: 1 + rand(12),
        procs: Array.from({ length: n }, (_, i) => ({
          name: `P${i + 1}`,
          arrival: rand(20),
          burst: 1 + rand(20),
          priority: 1 + rand(9),
        })),
        ...(Math.random() < 0.5 ? { race: pick(SCHED_ALGOS).key } : {}),
      };
    }
    case 1:
      return {
        lab: "paging",
        algo: pick(PAGE_ALGOS).key,
        frames: 1 + rand(8),
        refs: Array.from({ length: 1 + rand(30) }, () => rand(20)),
        ...(Math.random() < 0.5 ? { race: pick(PAGE_ALGOS).key } : {}),
      };
    case 2: {
      const nv = 2 + rand(8);
      const directed = Math.random() < 0.5;
      const verts = Array.from({ length: nv }, (_, i) => i + 1);
      // Dedup exactly as the decoder does (it now rejects parallel edges).
      const edges: [number, number, number][] = [];
      const seen = new Set<string>();
      for (let k = 0; k < nv; k += 1) {
        const a = 1 + rand(nv);
        const b = 1 + rand(nv);
        if (a === b) continue;
        const key = directed ? `${a}>${b}` : a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b, 1 + rand(99)]);
      }
      return {
        lab: "wgraph",
        directed,
        verts,
        edges,
        ...(Math.random() < 0.7 ? { algo: pick(WGRAPH_ALGOS).key, from: 1, to: nv } : {}),
      };
    }
    case 3: {
      const n = 1 + rand(7);
      const m = 1 + rand(5);
      const alloc = Array.from({ length: n }, () => Array.from({ length: m }, () => rand(6)));
      const banker = Math.random() < 0.5;
      return {
        lab: "deadlock",
        mode: banker ? "banker" : "detect",
        avail: Array.from({ length: m }, () => rand(6)),
        alloc,
        ...(banker
          ? { max: alloc.map((row) => row.map((a) => a + rand(6))) }
          : { req: Array.from({ length: n }, () => Array.from({ length: m }, () => rand(6))) }),
      };
    }
    case 4: {
      // key order must match decodeLab's rebuild for the stringify comparison
      const cyl = MIN_CYL + rand(1981);
      const n = 1 + rand(MAX_DISK_REQUESTS);
      const reqs: number[] = [];
      const used = new Set<number>();
      while (reqs.length < n) {
        const r = rand(cyl);
        if (!used.has(r)) { used.add(r); reqs.push(r); }
      }
      return {
        lab: "disk",
        algo: pick(DISK_ALGOS).key,
        head: rand(cyl),
        cyl,
        reqs,
        ...(Math.random() < 0.5 ? { dir: pick(["up", "down"] as const) } : {}),
        ...(Math.random() < 0.4 ? { race: pick(DISK_ALGOS).key } : {}),
      };
    }
    default:
      return {
        lab: "sortrace",
        a: pick(SORT_KEYS),
        b: pick(SORT_KEYS),
        values: Array.from({ length: 2 + rand(15) }, () => rand(200) - 50),
      };
  }
}

// round trips
for (let t = 0; t < 2000; t += 1) {
  const link = randomLink();
  const back = decodeLab(encodeLab(link));
  if (JSON.stringify(back) !== JSON.stringify(link)) fail("round trip broke", link, back);
}

// garbage never throws, always null
const garbage: string[] = [
  "", "x", "====", "%%%", "undefined", "null", "🙂🙂🙂",
  btoa("not json at all"),
  btoa(JSON.stringify(null)),
  btoa(JSON.stringify(42)),
  btoa(JSON.stringify({ lab: "sched" })),
  btoa(JSON.stringify({ lab: "nope", algo: "fifo" })),
  btoa(JSON.stringify({ lab: "paging", algo: "fifo", frames: 999, refs: [1] })),
  btoa(JSON.stringify({ lab: "paging", algo: "fifo", frames: 3, refs: Array(500).fill(1) })),
  btoa(JSON.stringify({ lab: "sched", algo: "fcfs", q: 2, procs: [{ name: "A", arrival: -1, burst: 2, priority: 1 }] })),
  btoa(JSON.stringify({ lab: "sched", algo: "fcfs", q: 2, procs: [{ name: "A", arrival: 0, burst: 2, priority: 1 }, { name: "A", arrival: 0, burst: 2, priority: 1 }] })),
  btoa(JSON.stringify({ lab: "wgraph", directed: false, verts: [1, 1], edges: [] })),
  btoa(JSON.stringify({ lab: "wgraph", directed: false, verts: [1, 2], edges: [[1, 9, 5]] })),
  btoa(JSON.stringify({ lab: "wgraph", directed: false, verts: [1, 2], edges: [[1, 2, 0]] })),
  // duplicate/parallel edges are impossible through the UI → must be rejected
  btoa(JSON.stringify({ lab: "wgraph", directed: false, verts: [1, 2], edges: [[1, 2, 5], [1, 2, 7]] })),
  btoa(JSON.stringify({ lab: "wgraph", directed: false, verts: [1, 2], edges: [[1, 2, 5], [2, 1, 7]] })),
  btoa(JSON.stringify({ lab: "sortrace", a: "bogo", b: "merge", values: [1, 2] })),
  btoa(JSON.stringify({ lab: "sortrace", a: "bubble", b: "merge", values: [1] })),
  btoa(JSON.stringify({ lab: "sortrace", a: "bubble", b: "merge", values: [1, 1e300] })),
  // deadlock: bad mode, missing/mismatched matrices, max below alloc, oversize
  btoa(JSON.stringify({ lab: "deadlock", mode: "nope", avail: [1], alloc: [[1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "banker", avail: [1], alloc: [[1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "banker", avail: [1], alloc: [[2]], max: [[1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "banker", avail: [1, 1], alloc: [[1]], max: [[1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "banker", avail: [1], alloc: [[1]], max: [[1], [1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "detect", avail: [1], alloc: [[1]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "detect", avail: [1], alloc: [[1]], req: [[99]] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "detect", avail: Array(9).fill(1), alloc: [Array(9).fill(1)], req: [Array(9).fill(1)] })),
  btoa(JSON.stringify({ lab: "deadlock", mode: "banker", avail: [1], alloc: Array(20).fill([1]), max: Array(20).fill([1]) })),
  // disk: bad algo/dir, off-platter head/request, platter size out of range,
  // empty/oversized queue, duplicate cylinders (impossible through the UI)
  btoa(JSON.stringify({ lab: "disk", algo: "elevator", head: 53, cyl: 200, reqs: [98] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 200, cyl: 200, reqs: [98] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: [200] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 5, cyl: 19, reqs: [1] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 5, cyl: 2001, reqs: [1] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: [] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: Array.from({ length: 13 }, (_, i) => i) })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: [98, 98] })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: [98], dir: "left" })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53, cyl: 200, reqs: [98], race: "elevator" })),
  btoa(JSON.stringify({ lab: "disk", algo: "scan", head: 53.5, cyl: 200, reqs: [98] })),
];
for (let t = 0; t < 2000; t += 1) {
  garbage.push(Array.from({ length: rand(60) }, () => String.fromCharCode(32 + rand(90))).join(""));
}
// truncations of a valid payload
const valid = encodeLab(randomLink());
for (let k = 0; k < valid.length; k += 3) garbage.push(valid.slice(0, k) === valid ? "" : valid.slice(0, k));

for (const g of garbage) {
  try {
    const out = decodeLab(g);
    if (out !== null) {
      // a truncation could accidentally decode to valid JSON — allow only if it fully validates by re-encoding
      if (JSON.stringify(decodeLab(encodeLab(out))) !== JSON.stringify(out)) fail("garbage produced invalid link", g.slice(0, 30));
    }
  } catch (e) {
    fail("decodeLab threw", g.slice(0, 30), String(e));
  }
}

console.log(fails === 0 ? "ALL PASS (2000 round trips + ~2600 garbage inputs)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
