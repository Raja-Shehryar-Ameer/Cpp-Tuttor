// Weighted-graph engine for the Graph Algorithms lab: builders plus narrated
// BFS, DFS, shortest path, Dijkstra, Prim, Kruskal, and topological sort.
// Every function returns Frames the shared player animates. Pure logic — no
// rendering here.
//
// Conventions (stated in the UI too):
//  - Vertices are referred to by VALUE in the UI; ids are internal FLIP keys.
//  - Weights are 1–99 (no negatives, so Dijkstra is always legal).
//  - Undirected mode: one edge object serves both directions.
//  - Directed mode: A→B and B→A are distinct edges.
//  - Neighbors are always explored in ascending vertex-value order, so runs
//    are deterministic and match what a student would do by hand.

// Extension kept explicit so `node --experimental-strip-types` can run the
// fuzz suites against this module directly (tsconfig: allowImportingTsExtensions).
import { allocId, type DSData, type Frame, type ListNode, type WEdge } from "./engine.ts";

export type WGraph = Extract<DSData, { kind: "wgraph" }>;

export type WAlgo = "bfs" | "dfs" | "path" | "dijkstra" | "prim" | "kruskal" | "topo";

export interface WAlgoMeta {
  key: WAlgo;
  label: string;
  short: string;
  needsFrom: boolean;
  needsTo: "no" | "optional" | "yes";
  directed: "any" | "undirected" | "directed";
  blurb: string;
}

export const WGRAPH_ALGOS: WAlgoMeta[] = [
  { key: "bfs", label: "BFS (breadth-first search)", short: "BFS", needsFrom: true, needsTo: "no", directed: "any",
    blurb: "Explores level by level with a queue — everything 1 hop away, then 2 hops, then 3." },
  { key: "dfs", label: "DFS (depth-first search)", short: "DFS", needsFrom: true, needsTo: "no", directed: "any",
    blurb: "Dives down one branch with a stack until it dead-ends, then backtracks." },
  { key: "path", label: "Shortest path by hops (BFS)", short: "BFS path", needsFrom: true, needsTo: "yes", directed: "any",
    blurb: "BFS from A until it reaches B — the fewest EDGES, ignoring weights. Compare with Dijkstra on the same pair." },
  { key: "dijkstra", label: "Dijkstra (cheapest paths)", short: "Dijkstra", needsFrom: true, needsTo: "optional", directed: "any",
    blurb: "Grows a 'settled' set outward, always finalizing the unsettled vertex with the smallest known distance, relaxing its edges." },
  { key: "prim", label: "Prim (minimum spanning tree)", short: "Prim", needsFrom: true, needsTo: "no", directed: "undirected",
    blurb: "Grows ONE tree from a start vertex: every round, take the cheapest edge crossing from tree to non-tree." },
  { key: "kruskal", label: "Kruskal (minimum spanning tree)", short: "Kruskal", needsFrom: false, needsTo: "no", directed: "undirected",
    blurb: "Sorts ALL edges by weight and takes each one unless it would close a cycle — a forest that merges into the MST." },
  { key: "topo", label: "Topological sort (Kahn's)", short: "Topo sort", needsFrom: false, needsTo: "no", directed: "directed",
    blurb: "Repeatedly removes a vertex with in-degree 0 — a valid order exists exactly when the graph has no cycle." },
];

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 99;
export const MAX_WG_VERTICES = 12;
export const MAX_WG_EDGES = 24;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function snap(d: WGraph, note: string, extra: Partial<Frame> = {}): Frame {
  return { data: clone(d), hl: [], note, ...extra };
}

const byValue = (d: WGraph, v: number): ListNode | undefined => d.nodes.find((n) => n.value === v);
const valueOf = (d: WGraph, id: number): number => d.nodes.find((n) => n.id === id)?.value ?? NaN;

/** Sorted adjacency: id → [{edge, to}] ascending by neighbor value. */
function adjacency(d: WGraph): Map<number, { edge: WEdge; to: number }[]> {
  const adj = new Map<number, { edge: WEdge; to: number }[]>();
  for (const n of d.nodes) adj.set(n.id, []);
  for (const e of d.edges) {
    adj.get(e.a)?.push({ edge: e, to: e.b });
    if (!d.directed) adj.get(e.b)?.push({ edge: e, to: e.a });
  }
  for (const list of adj.values()) list.sort((p, q) => valueOf(d, p.to) - valueOf(d, q.to));
  return adj;
}

const edgeName = (d: WGraph, e: WEdge): string =>
  `${valueOf(d, e.a)}${d.directed ? "→" : "—"}${valueOf(d, e.b)}`;

// ---------- builders ----------

export function wgraphAddNode(d: WGraph, v: number): Frame[] {
  const existing = byValue(d, v);
  if (existing) return [snap(d, `Vertex ${v} is already here.`, { bad: [existing.id] })];
  if (d.nodes.length >= MAX_WG_VERTICES) {
    return [snap(d, `Up to ${MAX_WG_VERTICES} vertices — beyond that the algorithm traces stop being readable.`, { bad: [] })];
  }
  const node: ListNode = { id: allocId(), value: v };
  const next: WGraph = { ...clone(d), nodes: [...clone(d.nodes), node] };
  return [snap(next, `Added vertex ${v}. Connect it with weighted edges, or it stays unreachable.`, { hl: [node.id], ok: [node.id] })];
}

export function wgraphRemoveNode(d: WGraph, v: number): Frame[] {
  const node = byValue(d, v);
  if (!node) return [snap(d, `There is no vertex ${v} to remove.`, { bad: [] })];
  const gone = d.edges.filter((e) => e.a === node.id || e.b === node.id);
  const frames = [snap(d, `Removing vertex ${v} also removes ${gone.length === 0 ? "no edges — it was isolated" : `its ${gone.length} incident edge${gone.length === 1 ? "" : "s"}`}.`, { bad: [node.id, ...gone.map((e) => e.id)] })];
  const next: WGraph = {
    ...clone(d),
    nodes: d.nodes.filter((n) => n.id !== node.id).map(clone),
    edges: d.edges.filter((e) => e.a !== node.id && e.b !== node.id).map(clone),
  };
  frames.push(snap(next, `Vertex ${v} is gone.`));
  return frames;
}

export function wgraphAddEdge(d: WGraph, va: number, vb: number, w: number): Frame[] {
  if (va === vb) return [snap(d, "Self-loops aren't allowed here — pick two different vertices.", { bad: [] })];
  const weight = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Math.trunc(w)));
  let next = clone(d);
  const added: number[] = [];
  for (const v of [va, vb]) {
    if (!byValue(next, v)) {
      if (next.nodes.length >= MAX_WG_VERTICES) {
        return [snap(d, `Vertex ${v} doesn't exist and the graph is full (${MAX_WG_VERTICES} vertices max).`, { bad: [] })];
      }
      const node: ListNode = { id: allocId(), value: v };
      next.nodes.push(node);
      added.push(v);
    }
  }
  const na = byValue(next, va)!;
  const nb = byValue(next, vb)!;
  const dup = next.edges.find((e) =>
    d.directed ? e.a === na.id && e.b === nb.id : (e.a === na.id && e.b === nb.id) || (e.a === nb.id && e.b === na.id),
  );
  if (dup) {
    if (dup.w === weight) return [snap(d, `Edge ${edgeName(next, dup)} already exists with weight ${weight}.`, { hl: [dup.id] })];
    const old = dup.w;
    dup.w = weight;
    return [snap(next, `Edge ${edgeName(next, dup)} already existed — its weight updates ${old} → ${weight}.`, { hl: [dup.id], ok: [dup.id] })];
  }
  if (next.edges.length >= MAX_WG_EDGES) {
    return [snap(d, `Up to ${MAX_WG_EDGES} edges — beyond that the drawing turns into spaghetti.`, { bad: [] })];
  }
  const edge: WEdge = { id: allocId(), a: na.id, b: nb.id, w: weight };
  next.edges.push(edge);
  const prefix = added.length > 0 ? `Vertex ${added.join(" and ")} created on the way. ` : "";
  return [snap(next, `${prefix}Edge ${edgeName(next, edge)} added with weight ${weight}${d.directed ? " — one direction only" : " — both vertices can use it"}.`, { hl: [na.id, nb.id], ok: [edge.id] })];
}

export function wgraphRemoveEdge(d: WGraph, va: number, vb: number): Frame[] {
  const na = byValue(d, va);
  const nb = byValue(d, vb);
  if (!na || !nb) return [snap(d, `Both vertices must exist — ${!na ? va : vb} doesn't.`, { bad: [] })];
  const edge = d.edges.find((e) =>
    d.directed ? e.a === na.id && e.b === nb.id : (e.a === na.id && e.b === nb.id) || (e.a === nb.id && e.b === na.id),
  );
  if (!edge) return [snap(d, `There is no edge ${va}${d.directed ? "→" : "—"}${vb}.`, { bad: [na.id, nb.id] })];
  const frames = [snap(d, `Removing edge ${edgeName(d, edge)} (weight ${edge.w}).`, { bad: [edge.id] })];
  const next: WGraph = { ...clone(d), edges: d.edges.filter((e) => e.id !== edge.id).map(clone) };
  frames.push(snap(next, `Edge ${va}${d.directed ? "→" : "—"}${vb} is gone.`));
  return frames;
}

export function wgraphSetDirected(d: WGraph, directed: boolean): Frame[] {
  if (d.directed === directed) return [snap(d, directed ? "Already directed." : "Already undirected.")];
  const next = clone(d);
  next.directed = directed;
  let dropped = 0;
  if (!directed) {
    // Collapse antiparallel pairs — an undirected graph has one edge per pair.
    const seen = new Set<string>();
    next.edges = next.edges.filter((e) => {
      const key = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`;
      if (seen.has(key)) { dropped += 1; return false; }
      seen.add(key);
      return true;
    });
  }
  return [snap(next, directed
    ? "Directed mode: every edge now points the way it was entered (A → B). Topological sort unlocks; Prim/Kruskal need undirected."
    : `Undirected mode: edges work both ways${dropped > 0 ? ` (${dropped} antiparallel duplicate${dropped === 1 ? "" : "s"} collapsed)` : ""}. MST algorithms unlock; topo sort needs directed.`)];
}

// ---------- guards ----------

function guard(d: WGraph, meta: WAlgoMeta): Frame[] | null {
  if (d.nodes.length === 0) return [snap(d, "The graph is empty — bulk load some edges first, e.g. “1 2 5” per line.", { bad: [] })];
  if (meta.directed === "undirected" && d.directed) {
    return [snap(d, `${meta.short} builds a spanning TREE, which has no direction — switch the graph to undirected first.`, { bad: [] })];
  }
  if (meta.directed === "directed" && !d.directed) {
    return [snap(d, "Topological sort orders DEPENDENCIES — it needs directed edges. Switch the graph to directed first.", { bad: [] })];
  }
  return null;
}

const missing = (d: WGraph, v: number): Frame[] => [snap(d, `Vertex ${v} does not exist.`, { bad: [] })];

// ---------- traversals (moved up from the old unweighted graph) ----------

export function wgraphTraverse(d: WGraph, startV: number, mode: "bfs" | "dfs"): Frame[] {
  const meta = WGRAPH_ALGOS.find((a) => a.key === mode)!;
  const g = guard(d, meta);
  if (g) return g;
  const start = byValue(d, startV);
  if (!start) return missing(d, startV);

  const adj = adjacency(d);
  const frames: Frame[] = [snap(d, `${meta.short} from ${startV}: ${mode === "bfs" ? "a QUEUE explores the closest vertices first" : "a STACK dives deep before it backtracks"}.`, { hl: [start.id] })];
  const visited: number[] = [];
  const treeEdges: number[] = [];
  const seen = new Set<number>([start.id]);
  const work: { id: number; via: WEdge | null }[] = [{ id: start.id, via: null }];
  while (work.length > 0) {
    const cur = mode === "bfs" ? work.shift()! : work.pop()!;
    visited.push(cur.id);
    if (cur.via) treeEdges.push(cur.via.id);
    const fringe = (adj.get(cur.id) ?? []).filter((x) => !seen.has(x.to));
    for (const x of fringe) seen.add(x.to);
    if (mode === "bfs") work.push(...fringe.map((x) => ({ id: x.to, via: x.edge })));
    else work.push(...[...fringe].reverse().map((x) => ({ id: x.to, via: x.edge }))); // stack pops smallest first
    frames.push(snap(d, `Visit ${valueOf(d, cur.id)}${cur.via ? ` (reached via ${edgeName(d, cur.via)})` : ""}${fringe.length > 0 ? ` — ${mode === "bfs" ? "enqueue" : "push"} ${fringe.map((x) => valueOf(d, x.to)).join(", ")}` : " — no new neighbors"}.`, {
      hl: [...visited, ...treeEdges],
      ok: [cur.id, ...(cur.via ? [cur.via.id] : [])],
    }));
  }
  const unreached = d.nodes.filter((n) => !seen.has(n.id));
  frames.push(snap(d, `${meta.short} order: ${visited.map((id) => valueOf(d, id)).join(" → ")}.${unreached.length > 0 ? ` ${unreached.map((n) => n.value).join(", ")} ${unreached.length === 1 ? "was" : "were"} never reachable from ${startV}.` : ""}`, {
    ok: [...visited, ...treeEdges],
    bad: unreached.map((n) => n.id),
  }));
  return frames;
}

export function wgraphPathBfs(d: WGraph, fromV: number, toV: number): Frame[] {
  const g = guard(d, WGRAPH_ALGOS.find((a) => a.key === "path")!);
  if (g) return g;
  const from = byValue(d, fromV);
  const to = byValue(d, toV);
  if (!from) return missing(d, fromV);
  if (!to) return missing(d, toV);
  if (from.id === to.id) return [snap(d, `${fromV} is already ${toV} — zero hops.`, { ok: [from.id] })];

  const adj = adjacency(d);
  const parent = new Map<number, { id: number; edge: WEdge }>();
  const seen = new Set<number>([from.id]);
  const queue = [from.id];
  const frames: Frame[] = [snap(d, `BFS from ${fromV} toward ${toV} — the first time we touch ${toV}, the path used the fewest possible edges.`, { hl: [from.id] })];
  let found = false;
  while (queue.length > 0 && !found) {
    const cur = queue.shift()!;
    const news: number[] = [];
    for (const { edge, to: nb } of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      parent.set(nb, { id: cur, edge });
      queue.push(nb);
      news.push(nb);
      if (nb === to.id) { found = true; break; }
    }
    frames.push(snap(d, `Expand ${valueOf(d, cur)}${news.length > 0 ? ` — discover ${news.map((id) => valueOf(d, id)).join(", ")}` : " — nothing new"}.`, { hl: [...seen] }));
  }
  if (!found) {
    return [...frames, snap(d, `No route: ${toV} is not reachable from ${fromV}.`, { bad: [from.id, to.id] })];
  }
  const pathNodes: number[] = [];
  const pathEdges: number[] = [];
  let walk: number | undefined = to.id;
  while (walk !== undefined) {
    pathNodes.unshift(walk);
    const p = parent.get(walk);
    if (p) pathEdges.push(p.edge.id);
    walk = p?.id;
  }
  frames.push(snap(d, `Found it: ${pathNodes.map((id) => valueOf(d, id)).join(" → ")} — ${pathEdges.length} hop${pathEdges.length === 1 ? "" : "s"}. (Fewest EDGES — Dijkstra may pick a different route once weights matter.)`, { ok: [...pathNodes, ...pathEdges] }));
  return frames;
}

// ---------- Dijkstra ----------

export function wgraphDijkstra(d: WGraph, srcV: number, dstV?: number): Frame[] {
  const g = guard(d, WGRAPH_ALGOS.find((a) => a.key === "dijkstra")!);
  if (g) return g;
  const src = byValue(d, srcV);
  if (!src) return missing(d, srcV);
  const dst = dstV !== undefined ? byValue(d, dstV) : undefined;
  if (dstV !== undefined && !dst) return missing(d, dstV);

  const adj = adjacency(d);
  const dist = new Map<number, number>(d.nodes.map((n) => [n.id, Infinity]));
  const parentEdge = new Map<number, WEdge>();
  const settled = new Set<number>();
  dist.set(src.id, 0);

  const labels = (): Record<number, string> =>
    Object.fromEntries(d.nodes.map((n) => [n.id, `d=${dist.get(n.id) === Infinity ? "∞" : dist.get(n.id)}`]));
  const frontier = (): string =>
    d.nodes
      .filter((n) => !settled.has(n.id) && dist.get(n.id)! < Infinity)
      .sort((a, b) => dist.get(a.id)! - dist.get(b.id)!)
      .map((n) => `${n.value}(${dist.get(n.id)})`)
      .join(", ");

  const settledIds = (): number[] => [...settled, ...[...settled].map((id) => parentEdge.get(id)?.id).filter((x): x is number => x !== undefined)];

  const frames: Frame[] = [snap(d, `Dijkstra from ${srcV}: every vertex starts at distance ∞ except the source at 0. Each round settles the cheapest unsettled vertex — settled distances never change again.`, { hl: [src.id], labels: labels() })];

  for (;;) {
    let u: number | null = null;
    for (const n of d.nodes) {
      if (settled.has(n.id) || dist.get(n.id) === Infinity) continue;
      if (u === null || dist.get(n.id)! < dist.get(u)! || (dist.get(n.id) === dist.get(u) && n.value < valueOf(d, u))) u = n.id;
    }
    if (u === null) break;
    const front = frontier(); // snapshot BEFORE settling, so u is still listed
    const cands = d.nodes
      .filter((n) => !settled.has(n.id) && dist.get(n.id)! < Infinity)
      .sort((a, b) => a.value - b.value);
    settled.add(u);
    const via = parentEdge.get(u);
    frames.push(snap(d, `Frontier: ${front || "—"}${front ? " — " : ""}${valueOf(d, u)} has the smallest distance (${dist.get(u)}) → settle it${via ? ` via ${edgeName(d, via)}` : ""}. Nothing cheaper can appear later.`, {
      hl: settledIds(),
      ok: [u, ...(via ? [via.id] : [])],
      labels: labels(),
      ...(cands.length >= 2 ? {
        quiz: {
          prompt: "Dijkstra settles one vertex now — which one?",
          choices: cands.map((n) => `${n.value} (d=${dist.get(n.id)})`),
          answer: cands.findIndex((n) => n.id === u),
          explain: `${valueOf(d, u)} carries the smallest tentative distance (${dist.get(u)}) — and a settled distance can never improve, so it is safe to lock in.`,
        },
      } : {}),
    }));
    if (dst && u === dst.id) break;
    for (const { edge, to } of adj.get(u) ?? []) {
      if (settled.has(to)) continue;
      const cand = dist.get(u)! + edge.w;
      const cur = dist.get(to)!;
      if (cand < cur) {
        dist.set(to, cand);
        parentEdge.set(to, edge);
        frames.push(snap(d, `Relax ${edgeName(d, edge)}: ${dist.get(u)} + ${edge.w} = ${cand} beats ${cur === Infinity ? "∞" : cur} — update ${valueOf(d, to)}.`, {
          hl: [...settledIds(), edge.id],
          ok: [to],
          labels: labels(),
        }));
      } else {
        frames.push(snap(d, `Relax ${edgeName(d, edge)}: ${dist.get(u)} + ${edge.w} = ${cand} does not beat ${cur} — keep ${valueOf(d, to)} as is.`, {
          hl: [...settledIds(), edge.id],
          labels: labels(),
        }));
      }
    }
  }

  if (dst) {
    if (!settled.has(dst.id)) {
      frames.push(snap(d, `${dstV} is unreachable from ${srcV}.`, { bad: [dst.id], labels: labels() }));
      return frames;
    }
    const pathNodes: number[] = [];
    const pathEdges: number[] = [];
    let walk: number | undefined = dst.id;
    while (walk !== undefined) {
      pathNodes.unshift(walk);
      const pe: WEdge | undefined = parentEdge.get(walk);
      if (pe) pathEdges.push(pe.id);
      walk = pe ? (pe.a === walk ? pe.b : pe.a) : undefined;
      if (walk === src.id) { pathNodes.unshift(src.id); break; }
    }
    frames.push(snap(d, `Cheapest route ${srcV} → ${dstV}: ${pathNodes.map((id) => valueOf(d, id)).join(" → ")}, total cost ${dist.get(dst.id)}.`, { ok: [...pathNodes, ...pathEdges], labels: labels() }));
  } else {
    const summary = d.nodes
      .map((n) => `${n.value}:${dist.get(n.id) === Infinity ? "∞" : dist.get(n.id)}`)
      .join("  ");
    const unreachable = d.nodes.filter((n) => dist.get(n.id) === Infinity);
    frames.push(snap(d, `All done — cheapest costs from ${srcV}:  ${summary}.${unreachable.length > 0 ? " ∞ means unreachable." : ""}`, {
      ok: settledIds(),
      bad: unreachable.map((n) => n.id),
      labels: labels(),
    }));
  }
  return frames;
}

// ---------- Prim ----------

export function wgraphPrim(d: WGraph, startV: number): Frame[] {
  const g = guard(d, WGRAPH_ALGOS.find((a) => a.key === "prim")!);
  if (g) return g;
  const start = byValue(d, startV);
  if (!start) return missing(d, startV);

  const inTree = new Set<number>([start.id]);
  const treeEdges: number[] = [];
  let total = 0;
  const frames: Frame[] = [snap(d, `Prim from ${startV}: the tree starts as just this vertex. Every round, the CHEAPEST edge crossing from tree to non-tree joins — greedy, and provably optimal.`, { hl: [start.id] })];

  for (;;) {
    const cut = d.edges.filter((e) => inTree.has(e.a) !== inTree.has(e.b));
    if (cut.length === 0) break;
    let best = cut[0];
    for (const e of cut) if (e.w < best.w || (e.w === best.w && e.id < best.id)) best = e;
    const joining = inTree.has(best.a) ? best.b : best.a;
    frames.push(snap(d, `Crossing edges: ${cut.map((e) => `${edgeName(d, e)}(${e.w})`).join(", ")} — the cheapest is ${edgeName(d, best)} (${best.w}).`, {
      hl: [...cut.map((e) => e.id), ...inTree, ...treeEdges],
      ok: [best.id],
      ...(cut.length >= 2 ? {
        quiz: {
          prompt: "Prim adds one crossing edge to the tree — which one?",
          choices: cut.map((e) => `${edgeName(d, e)} (${e.w})`),
          answer: cut.indexOf(best),
          explain: `${edgeName(d, best)} is the CHEAPEST edge leaving the tree (${best.w}) — the greedy cut rule guarantees it belongs to some MST.`,
        },
      } : {}),
    }));
    inTree.add(joining);
    treeEdges.push(best.id);
    total += best.w;
    frames.push(snap(d, `${valueOf(d, joining)} joins the tree via ${edgeName(d, best)} — tree weight so far: ${total}.`, {
      hl: [...inTree, ...treeEdges],
      ok: [joining, best.id],
    }));
  }

  const left = d.nodes.filter((n) => !inTree.has(n.id));
  frames.push(snap(d, left.length === 0
    ? `Minimum spanning tree complete: ${treeEdges.length} edges, total weight ${total}.`
    : `No crossing edges remain — ${left.map((n) => n.value).join(", ")} ${left.length === 1 ? "is" : "are"} in a different component, so Prim spans only ${startV}'s component (weight ${total}).`, {
    ok: [...inTree, ...treeEdges],
    bad: left.map((n) => n.id),
  }));
  return frames;
}

// ---------- Kruskal (union-find narrated) ----------

export function wgraphKruskal(d: WGraph): Frame[] {
  const g = guard(d, WGRAPH_ALGOS.find((a) => a.key === "kruskal")!);
  if (g) return g;
  if (d.edges.length === 0) return [snap(d, "There are no edges — Kruskal has nothing to sort.", { bad: [] })];

  const parent = new Map<number, number>(d.nodes.map((n) => [n.id, n.id]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression — flatten the walk we just did
    let w = x;
    while (parent.get(w) !== r) { const nxt = parent.get(w)!; parent.set(w, r); w = nxt; }
    return r;
  };
  const compOf = (id: number): string => {
    const root = find(id);
    return `{${d.nodes.filter((n) => find(n.id) === root).map((n) => n.value).sort((a, b) => a - b).join(",")}}`;
  };

  const sorted = [...d.edges].sort((a, b) => a.w - b.w || a.id - b.id);
  const mst: number[] = [];
  const rejected: number[] = [];
  let total = 0;
  const frames: Frame[] = [snap(d, `Kruskal: sort every edge by weight — ${sorted.map((e) => `${edgeName(d, e)}(${e.w})`).join(", ")}. Take each unless it closes a cycle.`)];

  for (const e of sorted) {
    const ra = find(e.a);
    const rb = find(e.b);
    const quiz = {
      prompt: `Next sorted edge: ${edgeName(d, e)} (${e.w}) — take it?`,
      choices: ["Accept — the endpoints are in different components", "Reject — it would close a cycle"],
      answer: ra !== rb ? 0 : 1,
      explain: ra !== rb
        ? `${valueOf(d, e.a)} is in ${compOf(e.a)} and ${valueOf(d, e.b)} in ${compOf(e.b)} — joining two components can never make a cycle.`
        : `Both endpoints already sit in ${compOf(e.a)} — a second route between them would be a cycle, and trees have none.`,
    };
    if (ra !== rb) {
      frames.push(snap(d, `${edgeName(d, e)} (${e.w}): ${valueOf(d, e.a)} is in ${compOf(e.a)}, ${valueOf(d, e.b)} in ${compOf(e.b)} — different components, ACCEPT and union them.`, {
        hl: [...mst],
        ok: [e.id, e.a, e.b],
        quiz,
      }));
      parent.set(ra, rb);
      mst.push(e.id);
      total += e.w;
    } else {
      rejected.push(e.id);
      frames.push(snap(d, `${edgeName(d, e)} (${e.w}): both endpoints are already in ${compOf(e.a)} — it would close a cycle, REJECT.`, {
        hl: [...mst],
        bad: [e.id],
        quiz,
      }));
    }
  }

  const roots = new Set(d.nodes.map((n) => find(n.id)));
  frames.push(snap(d, roots.size === 1
    ? `Minimum spanning tree complete: ${mst.length} edges, total weight ${total}.`
    : `Edges exhausted with ${roots.size} components left — the graph is disconnected, so this is a minimum spanning FOREST of weight ${total}.`, {
    ok: [...mst, ...d.nodes.filter((n) => d.edges.some((e) => mst.includes(e.id) && (e.a === n.id || e.b === n.id))).map((n) => n.id)],
  }));
  return frames;
}

// ---------- topological sort (Kahn's) ----------

export function wgraphTopo(d: WGraph): Frame[] {
  const g = guard(d, WGRAPH_ALGOS.find((a) => a.key === "topo")!);
  if (g) return g;

  const indeg = new Map<number, number>(d.nodes.map((n) => [n.id, 0]));
  for (const e of d.edges) indeg.set(e.b, (indeg.get(e.b) ?? 0) + 1);
  const labels = (): Record<number, string> => Object.fromEntries(d.nodes.map((n) => [n.id, `in: ${indeg.get(n.id)}`]));

  const ready = (): number[] =>
    d.nodes.filter((n) => indeg.get(n.id) === 0 && !done.has(n.id)).map((n) => n.id).sort((a, b) => valueOf(d, a) - valueOf(d, b));
  const done = new Set<number>();
  const order: number[] = [];
  const usedEdges: number[] = [];

  const frames: Frame[] = [snap(d, `Kahn's algorithm: count incoming edges. Any vertex with in-degree 0 depends on nothing — it can go first.`, { labels: labels(), hl: ready() })];

  for (;;) {
    const zero = ready();
    if (zero.length === 0) break;
    const u = zero[0];
    done.add(u);
    order.push(u);
    const outs = d.edges.filter((e) => e.a === u && !done.has(e.b));
    for (const e of outs) indeg.set(e.b, indeg.get(e.b)! - 1);
    usedEdges.push(...outs.map((e) => e.id));
    frames.push(snap(d, `Output ${valueOf(d, u)} (in-degree 0)${outs.length > 0 ? ` and erase its edges — ${outs.map((e) => `${valueOf(d, e.b)} drops to ${indeg.get(e.b)}`).join(", ")}` : ""}.`, {
      hl: [...order, ...usedEdges],
      ok: [u, ...outs.map((e) => e.id)],
      labels: labels(),
    }));
  }

  const stuck = d.nodes.filter((n) => !done.has(n.id));
  frames.push(snap(d, stuck.length === 0
    ? `Topological order: ${order.map((id) => valueOf(d, id)).join(" → ")}. Every edge points forward in this list.`
    : `Stuck: ${stuck.map((n) => n.value).join(", ")} all still have incoming edges — they form a CYCLE, so no topological order exists.`, {
    ok: order,
    bad: stuck.map((n) => n.id),
    labels: labels(),
  }));
  return frames;
}
