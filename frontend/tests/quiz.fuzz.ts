// Fuzz suite for predict-mode quiz extractors.
// Run: node --experimental-strip-types frontend/tests/quiz.fuzz.ts
//
// Invariants:
//  - schedQuizzes: one quiz per multi-candidate dispatch, the answer names the
//    process that actually runs at that tick, and the answer index is valid.
//  - pagingQuizzes: hit/fault answer matches the step; the eviction quiz
//    appears exactly when a fault evicts among ≥2 resident pages and names
//    the true victim.
//  - wgraph quizzes: every quiz's correct choice matches what the SAME frame
//    reveals (Dijkstra's settled vertex / Prim's chosen edge / Kruskal's verdict).

import { SCHED_ALGOS, schedQuizzes, schedule, type ProcSpec } from "../src/ds/sched.ts";
import { PAGE_ALGOS, pageReplace, pagingQuizzes } from "../src/ds/paging.ts";
import {
  wgraphAddEdge,
  wgraphAddNode,
  wgraphDijkstra,
  wgraphKruskal,
  wgraphPrim,
  type WGraph,
} from "../src/ds/wgraph.ts";
import type { Frame } from "../src/ds/engine.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const rand = (n: number): number => Math.floor(Math.random() * n);

// ---- scheduler ----
for (let t = 0; t < 400; t += 1) {
  const n = 2 + rand(5);
  const procs: ProcSpec[] = Array.from({ length: n }, (_, i) => ({
    name: `P${i + 1}`,
    arrival: rand(8),
    burst: 1 + rand(8),
    priority: 1 + rand(5),
  }));
  const algo = SCHED_ALGOS[rand(SCHED_ALGOS.length)].key;
  const run = schedule(algo, procs, 1 + rand(4));
  const quizzes = schedQuizzes(run);
  const seen = new Set<number>();
  for (const { tick, quiz } of quizzes) {
    if (seen.has(tick)) fail("sched: duplicate quiz tick", tick);
    seen.add(tick);
    const state = run.ticks[tick];
    if (!state || state.t !== tick) { fail("sched: quiz tick out of range", tick); continue; }
    if (quiz.answer < 0 || quiz.answer >= quiz.choices.length) fail("sched: answer index invalid", quiz);
    if (quiz.choices[quiz.answer] !== state.running) {
      fail("sched: answer is not the dispatched process", quiz.choices[quiz.answer], state.running, algo);
    }
    if (new Set(quiz.choices).size !== quiz.choices.length) fail("sched: duplicate choices", quiz.choices);
    if (quiz.choices.length < 2) fail("sched: trivial quiz emitted", quiz);
    // every quiz tick is a real dispatch: running changed (or started)
    const prev = run.ticks[tick - 1];
    if (prev && prev.running === state.running) fail("sched: quiz on non-dispatch tick", tick, algo);
  }
}

// ---- paging ----
for (let t = 0; t < 400; t += 1) {
  const refs = Array.from({ length: 1 + rand(25) }, () => rand(8));
  const frames = 1 + rand(6);
  const algo = PAGE_ALGOS[rand(PAGE_ALGOS.length)].key;
  const run = pageReplace(algo, refs, frames);
  const quizzes = pagingQuizzes(run);
  if (quizzes.length !== run.steps.length) fail("paging: quiz entry per step missing");
  quizzes.forEach(({ step, quizzes: qs }, i) => {
    if (step !== i) fail("paging: step index mismatch");
    const s = run.steps[i];
    const hf = qs[0];
    if (!hf) { fail("paging: missing hit/fault quiz", i); return; }
    if ((hf.choices[hf.answer] === "Hit") !== s.hit) fail("paging: hit/fault answer wrong", i, s.hit, hf);
    const before = i > 0 ? run.steps[i - 1].frames : run.steps[i].frames.map(() => null);
    const resident = before.filter((p): p is number => p !== null);
    const expectEvict = s.victim !== null && resident.length >= 2 && resident.includes(s.victim);
    if (expectEvict !== (qs.length === 2)) fail("paging: eviction quiz presence wrong", i, s.victim, resident, qs.length);
    if (qs.length === 2) {
      const ev = qs[1];
      if (Number(ev.choices[ev.answer]) !== s.victim) fail("paging: eviction answer wrong", ev, s.victim);
    }
  });
}

// ---- wgraph ----
const apply = (d: WGraph, frames: Frame[]): WGraph =>
  (frames.length > 0 ? (frames[frames.length - 1].data as WGraph) : d);

for (let t = 0; t < 300; t += 1) {
  let d: WGraph = { kind: "wgraph", nodes: [], edges: [], directed: false };
  const nV = 3 + rand(5);
  for (let v = 1; v <= nV; v += 1) d = apply(d, wgraphAddNode(d, v));
  for (let v = 2; v <= nV; v += 1) d = apply(d, wgraphAddEdge(d, 1 + rand(v - 1), v, 1 + rand(20)));
  for (let k = 0; k < nV; k += 1) {
    const a = 1 + rand(nV);
    const b = 1 + rand(nV);
    if (a !== b) d = apply(d, wgraphAddEdge(d, a, b, 1 + rand(20)));
  }
  const valueOf = (id: number) => d.nodes.find((n) => n.id === id)?.value;

  // Dijkstra: the quiz's correct choice names the vertex the frame settles (ok[0])
  for (const f of wgraphDijkstra(d, 1)) {
    if (!f.quiz) continue;
    const settled = valueOf((f.ok ?? [])[0]);
    if (!f.quiz.choices[f.quiz.answer].startsWith(`${settled} `)) {
      fail("dijkstra: quiz answer != settled vertex", f.quiz.choices[f.quiz.answer], settled);
    }
  }
  // Prim: correct choice names the edge the frame marks ok
  for (const f of wgraphPrim(d, 1)) {
    if (!f.quiz) continue;
    const chosen = d.edges.find((e) => e.id === (f.ok ?? [])[0]);
    if (!chosen) { fail("prim: quiz frame has no ok edge"); continue; }
    const name = `${valueOf(chosen.a)}—${valueOf(chosen.b)} (${chosen.w})`;
    if (f.quiz.choices[f.quiz.answer] !== name) fail("prim: quiz answer != chosen edge", f.quiz.choices[f.quiz.answer], name);
  }
  // Kruskal: verdict quiz matches accept (ok) vs reject (bad)
  for (const f of wgraphKruskal(d)) {
    if (!f.quiz) continue;
    const accepted = (f.ok ?? []).length > 0;
    const saysAccept = f.quiz.answer === 0;
    if (accepted !== saysAccept) fail("kruskal: quiz verdict != frame verdict", f.note);
  }
}

console.log(fails === 0 ? "ALL PASS (400 sched + 400 paging + 300 wgraph trials)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
