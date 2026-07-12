// Fuzz suite for the weighted-graph engine.
// Run: node --experimental-strip-types frontend/tests/wgraph.fuzz.ts
//
// Invariants:
//  - Dijkstra's final distances equal Floyd–Warshall on the same graph.
//  - Prim total == Kruskal total == an independent O(V²) MST on connected graphs.
//  - Topological order (on generated DAGs) satisfies every edge; cyclic
//    graphs are reported as stuck.
//  - BFS/DFS visit exactly the reachable set.
//  - Every frame's hl/ok/bad/labels ids exist in that frame's own data.

import type { Frame } from "../src/ds/engine.ts";
import {
  wgraphAddEdge,
  wgraphAddNode,
  wgraphDijkstra,
  wgraphKruskal,
  wgraphPathBfs,
  wgraphPrim,
  wgraphRemoveEdge,
  wgraphRemoveNode,
  wgraphTopo,
  wgraphTraverse,
  type WGraph,
} from "../src/ds/wgraph.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};

const rand = (n: number): number => Math.floor(Math.random() * n);

/** Apply builder frames: the last frame's data is the new state. */
function apply(d: WGraph, frames: Frame[]): WGraph {
  const last = frames[frames.length - 1];
  return (last ? last.data : d) as WGraph;
}

function emptyG(directed: boolean): WGraph {
  return { kind: "wgraph", nodes: [], edges: [], directed };
}

/** Random graph over vertex values 1..nV; if `connected`, seed a spanning tree first. */
function randomGraph(directed: boolean, connected: boolean): WGraph {
  let d = emptyG(directed);
  const nV = 2 + rand(7); // 2..8
  for (let v = 1; v <= nV; v += 1) d = apply(d, wgraphAddNode(d, v));
  if (connected) {
    for (let v = 2; v <= nV; v += 1) d = apply(d, wgraphAddEdge(d, 1 + rand(v - 1), v, 1 + rand(20)));
  }
  const extra = rand(nV * 2);
  for (let k = 0; k < extra; k += 1) {
    const a = 1 + rand(nV);
    const b = 1 + rand(nV);
    if (a !== b) d = apply(d, wgraphAddEdge(d, a, b, 1 + rand(20)));
  }
  return d;
}

/** Random DAG: only edges from lower to higher vertex value. */
function randomDag(): WGraph {
  let d = emptyG(true);
  const nV = 2 + rand(7);
  for (let v = 1; v <= nV; v += 1) d = apply(d, wgraphAddNode(d, v));
  for (let k = 0; k < nV * 2; k += 1) {
    const a = 1 + rand(nV);
    const b = 1 + rand(nV);
    if (a < b) d = apply(d, wgraphAddEdge(d, a, b, 1 + rand(20)));
  }
  return d;
}

function checkFrameIntegrity(tag: string, frames: Frame[]): void {
  for (const f of frames) {
    if (f.data.kind !== "wgraph") { fail(`${tag}: frame data kind`, f.data.kind); return; }
    const ids = new Set<number>([...f.data.nodes.map((n) => n.id), ...f.data.edges.map((e) => e.id)]);
    for (const bag of [f.hl, f.ok ?? [], f.bad ?? []]) {
      for (const id of bag) if (!ids.has(id)) { fail(`${tag}: frame references unknown id`, id, f.note); return; }
    }
    for (const key of Object.keys(f.labels ?? {})) {
      if (!ids.has(Number(key))) { fail(`${tag}: label on unknown id`, key, f.note); return; }
    }
    const nodeIds = f.data.nodes.map((n) => n.id);
    if (new Set(nodeIds).size !== nodeIds.length) { fail(`${tag}: duplicate node ids`); return; }
    const values = f.data.nodes.map((n) => n.value);
    if (new Set(values).size !== values.length) { fail(`${tag}: duplicate vertex values`); return; }
    for (const e of f.data.edges) {
      if (!nodeIds.includes(e.a) || !nodeIds.includes(e.b)) { fail(`${tag}: dangling edge`, e); return; }
    }
  }
}

/** Independent Floyd–Warshall over vertex VALUES. */
function floyd(d: WGraph): Map<string, number> {
  const vs = d.nodes.map((n) => n.value);
  const idToV = new Map(d.nodes.map((n) => [n.id, n.value]));
  const dist = new Map<string, number>();
  const get = (a: number, b: number) => dist.get(`${a}:${b}`) ?? (a === b ? 0 : Infinity);
  const set = (a: number, b: number, x: number) => dist.set(`${a}:${b}`, x);
  for (const e of d.edges) {
    const a = idToV.get(e.a)!;
    const b = idToV.get(e.b)!;
    if (e.w < get(a, b)) set(a, b, e.w);
    if (!d.directed && e.w < get(b, a)) set(b, a, e.w);
  }
  for (const k of vs) for (const i of vs) for (const j of vs) {
    if (get(i, k) + get(k, j) < get(i, j)) set(i, j, get(i, k) + get(k, j));
  }
  return dist;
}

/** Independent O(V²) Prim over the whole graph (per component of start). */
function refMstWeight(d: WGraph, startV: number): number {
  const start = d.nodes.find((n) => n.value === startV)!;
  const inTree = new Set<number>([start.id]);
  let total = 0;
  for (;;) {
    let best: { w: number; to: number } | null = null;
    for (const e of d.edges) {
      const cross = inTree.has(e.a) !== inTree.has(e.b);
      if (!cross) continue;
      const to = inTree.has(e.a) ? e.b : e.a;
      if (best === null || e.w < best.w) best = { w: e.w, to };
    }
    if (!best) return total;
    inTree.add(best.to);
    total += best.w;
  }
}

/** Reachable vertex values from startV (ignoring weights). */
function reachable(d: WGraph, startV: number): Set<number> {
  const idToV = new Map(d.nodes.map((n) => [n.id, n.value]));
  const start = d.nodes.find((n) => n.value === startV)!;
  const seen = new Set<number>([start.id]);
  const stack = [start.id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of d.edges) {
      if (e.a === cur && !seen.has(e.b)) { seen.add(e.b); stack.push(e.b); }
      if (!d.directed && e.b === cur && !seen.has(e.a)) { seen.add(e.a); stack.push(e.a); }
    }
  }
  return new Set([...seen].map((id) => idToV.get(id)!));
}

const TRIALS = 600;

for (let t = 0; t < TRIALS; t += 1) {
  // ---- Dijkstra vs Floyd–Warshall (both directednesses) ----
  {
    const d = randomGraph(t % 2 === 0, false);
    const srcV = d.nodes[rand(d.nodes.length)].value;
    const frames = wgraphDijkstra(d, srcV);
    checkFrameIntegrity("dijkstra", frames);
    const last = frames[frames.length - 1];
    const fw = floyd(d);
    for (const n of d.nodes) {
      const label = last.labels?.[n.id];
      if (!label) { fail("dijkstra: missing final label", n.value); continue; }
      const got = label === "d=∞" ? Infinity : Number(label.slice(2));
      const want = n.value === srcV ? 0 : fw.get(`${srcV}:${n.value}`) ?? Infinity;
      if (got !== want) fail("dijkstra != floyd", { srcV, v: n.value, got, want, edges: d.edges, directed: d.directed });
    }
  }

  // ---- Prim total == Kruskal total == reference MST (connected undirected) ----
  {
    const d = randomGraph(false, true);
    const startV = d.nodes[rand(d.nodes.length)].value;
    const prim = wgraphPrim(d, startV);
    const kruskal = wgraphKruskal(d);
    checkFrameIntegrity("prim", prim);
    checkFrameIntegrity("kruskal", kruskal);
    const wOf = (frames: Frame[]): number => {
      const m = frames[frames.length - 1].note.match(/weight (\d+)/);
      return m ? Number(m[1]) : NaN;
    };
    const ref = refMstWeight(d, startV);
    if (wOf(prim) !== ref) fail("prim weight != ref", { got: wOf(prim), ref, edges: d.edges });
    if (wOf(kruskal) !== ref) fail("kruskal weight != ref", { got: wOf(kruskal), ref, edges: d.edges });
    // Kruskal's accepted set must be acyclic and spanning: n-1 edges when connected
    if (!prim[prim.length - 1].note.includes("complete")) fail("prim: connected graph not complete", d.edges);
  }

  // ---- topo on a DAG: order satisfies every edge ----
  {
    const d = randomDag();
    const frames = wgraphTopo(d);
    checkFrameIntegrity("topo", frames);
    const note = frames[frames.length - 1].note;
    if (!note.startsWith("Topological order")) { fail("topo: DAG reported cyclic", d.edges); continue; }
    const order = note.replace("Topological order: ", "").split(".")[0].split(" → ").map(Number);
    const pos = new Map(order.map((v, i) => [v, i]));
    if (order.length !== d.nodes.length) fail("topo: order misses vertices", order, d.nodes.length);
    const idToV = new Map(d.nodes.map((n) => [n.id, n.value]));
    for (const e of d.edges) {
      if (pos.get(idToV.get(e.a)!)! >= pos.get(idToV.get(e.b)!)!) fail("topo: edge points backward", e, order);
    }
  }

  // ---- BFS/DFS visit exactly the reachable set ----
  {
    const d = randomGraph(t % 2 === 1, false);
    const srcV = d.nodes[rand(d.nodes.length)].value;
    for (const mode of ["bfs", "dfs"] as const) {
      const frames = wgraphTraverse(d, srcV, mode);
      checkFrameIntegrity(mode, frames);
      const note = frames[frames.length - 1].note;
      const listed = note.split("order: ")[1].split(".")[0].split(" → ").map(Number);
      const want = reachable(d, srcV);
      if (listed.length !== want.size || !listed.every((v) => want.has(v))) {
        fail(`${mode}: visited set != reachable set`, listed, [...want], d.edges);
      }
      if (new Set(listed).size !== listed.length) fail(`${mode}: vertex visited twice`, listed);
    }
  }

  // ---- BFS path: hop count equals unweighted shortest distance ----
  {
    const d = randomGraph(false, true);
    const a = d.nodes[rand(d.nodes.length)].value;
    const b = d.nodes[rand(d.nodes.length)].value;
    if (a !== b) {
      const frames = wgraphPathBfs(d, a, b);
      checkFrameIntegrity("path", frames);
      const note = frames[frames.length - 1].note;
      const m = note.match(/(\d+) hops?/);
      if (!m) { fail("path: no route on a connected graph", { a, b, note }); continue; }
      // reference: BFS hop count on an all-weights-1 copy via floyd
      const ones: WGraph = { ...d, edges: d.edges.map((e) => ({ ...e, w: 1 })) };
      const want = floyd(ones).get(`${a}:${b}`) ?? Infinity;
      if (Number(m[1]) !== want) fail("path hops != reference", { a, b, got: Number(m[1]), want });
    }
  }

  // ---- builder round trip: add edge then remove leaves original edge set ----
  {
    let d = randomGraph(false, false);
    if (d.nodes.length >= 2) {
      const before = JSON.stringify(d.edges.map((e) => [e.a, e.b, e.w]).sort());
      const a = d.nodes[0].value;
      const b = d.nodes[d.nodes.length - 1].value;
      const had = d.edges.some((e) => (e.a === d.nodes[0].id && e.b === d.nodes[d.nodes.length - 1].id) || (e.b === d.nodes[0].id && e.a === d.nodes[d.nodes.length - 1].id));
      if (a !== b && !had && d.edges.length < 24) {
        d = apply(d, wgraphAddEdge(d, a, b, 7));
        d = apply(d, wgraphRemoveEdge(d, a, b));
        const after = JSON.stringify(d.edges.map((e) => [e.a, e.b, e.w]).sort());
        if (before !== after) fail("add+remove edge not a round trip");
      }
    }
    // remove a vertex: no dangling edges is covered by frame integrity
    if (d.nodes.length > 0) {
      const v = d.nodes[rand(d.nodes.length)].value;
      checkFrameIntegrity("removeNode", wgraphRemoveNode(d, v));
    }
  }
}

// ---- deterministic spot checks ----
{
  // Classic CLRS-style graph: MST weight known by hand.
  let d = emptyG(false);
  for (const [a, b, w] of [[1, 2, 4], [1, 3, 8], [2, 3, 11], [2, 4, 8], [3, 5, 7], [4, 5, 2], [4, 6, 9], [5, 6, 10]] as const) {
    d = apply(d, wgraphAddEdge(d, a, b, w));
  }
  const wOf = (frames: Frame[]): number => Number(frames[frames.length - 1].note.match(/weight (\d+)/)?.[1]);
  if (wOf(wgraphPrim(d, 1)) !== 30) fail("spot: prim CLRS-ish != 30", wOf(wgraphPrim(d, 1)));
  if (wOf(wgraphKruskal(d)) !== 30) fail("spot: kruskal CLRS-ish != 30", wOf(wgraphKruskal(d)));

  // Directed guard messages
  let dd = emptyG(true);
  dd = apply(dd, wgraphAddEdge(dd, 1, 2, 3));
  if (!wgraphPrim(dd, 1)[0].note.includes("undirected")) fail("spot: prim guard missing");
  if (!wgraphKruskal(dd)[0].note.includes("undirected")) fail("spot: kruskal guard missing");
  if (!wgraphTopo(d)[0].note.includes("directed")) fail("spot: topo guard missing");

  // Cycle detection
  let cyc = emptyG(true);
  cyc = apply(cyc, wgraphAddEdge(cyc, 1, 2, 1));
  cyc = apply(cyc, wgraphAddEdge(cyc, 2, 3, 1));
  cyc = apply(cyc, wgraphAddEdge(cyc, 3, 1, 1));
  const topoNote = wgraphTopo(cyc).at(-1)!.note;
  if (!topoNote.includes("CYCLE")) fail("spot: 3-cycle not detected", topoNote);
}

console.log(fails === 0 ? `ALL PASS (${TRIALS} trials × 6 property groups + spot checks)` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
