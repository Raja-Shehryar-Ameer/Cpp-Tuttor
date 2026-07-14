// Fuzz suite for predict-mode quiz extractors.
// Run: node --experimental-strip-types frontend/tests/quiz.fuzz.ts
// Reproduce a failure: FUZZ_SEED=<printed base seed> node --experimental-strip-types frontend/tests/quiz.fuzz.ts
//
// Invariants (value-based, not positional — choice order is shuffled per run):
//  - every quiz: 2–5 unique choices, answer index in range.
//  - schedQuizzes: one quiz per multi-candidate dispatch; each kind's correct
//    choice matches ground truth recomputed from the run (dispatched process /
//    waiting time / remaining burst).
//  - pagingQuizzes: hit/fault answer matches the step; a second quiz always
//    appears on a real eviction; each second-quiz kind matches ground truth.
//  - wgraph quizzes: the correct choice matches what the SAME frame reveals
//    (settled vertex or its distance / Prim's chosen edge / Kruskal's verdict).
//  - variety: across all trials every question kind shows up at least once.

import { SCHED_ALGOS, schedQuizzes, schedule, type ProcSpec, type SchedRun } from "../src/ds/sched.ts";
import { PAGE_ALGOS, pageReplace, pagingQuizzes } from "../src/ds/paging.ts";
import { makeRng, type Rng } from "../src/ds/rng.ts";
import {
  wgraphAddEdge,
  wgraphAddNode,
  wgraphDijkstra,
  wgraphKruskal,
  wgraphPrim,
  type WGraph,
} from "../src/ds/wgraph.ts";
import type { Frame, Quiz } from "../src/ds/engine.ts";

const BASE_SEED = Number(process.env.FUZZ_SEED ?? Date.now() % 0xffffffff) >>> 0;
console.log(`base seed: ${BASE_SEED} (reproduce with FUZZ_SEED=${BASE_SEED})`);

let fails = 0;
let currentSeed = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error(`FAIL [seed ${currentSeed}]:`, label, ...ctx.map((c) => JSON.stringify(c)));
};
const kindsSeen = new Set<string>();

const checkShape = (quiz: Quiz, label: string) => {
  if (quiz.kind) kindsSeen.add(quiz.kind);
  if (quiz.choices.length < 2) fail(`${label}: trivial quiz emitted`, quiz);
  if (quiz.choices.length > 5) fail(`${label}: choice set exceeds cap`, quiz.choices);
  if (new Set(quiz.choices).size !== quiz.choices.length) fail(`${label}: duplicate choices`, quiz.choices);
  if (quiz.answer < 0 || quiz.answer >= quiz.choices.length) fail(`${label}: answer index invalid`, quiz);
};

// ---- scheduler ----

/** ticks `p` has run strictly before time t — ground truth for wait/remaining. */
const ranBefore = (run: SchedRun, p: string, t: number): number =>
  run.ticks.filter((st) => st.t < t && st.running === p).length;

for (let t = 0; t < 400; t += 1) {
  currentSeed = BASE_SEED + t;
  const rng = makeRng(currentSeed);
  const n = 2 + rng.int(5);
  const procs: ProcSpec[] = Array.from({ length: n }, (_, i) => ({
    name: `P${i + 1}`,
    arrival: rng.int(8),
    burst: 1 + rng.int(8),
    priority: 1 + rng.int(5),
  }));
  const algo = SCHED_ALGOS[rng.int(SCHED_ALGOS.length)].key;
  const run = schedule(algo, procs, 1 + rng.int(4));
  const quizzes = schedQuizzes(run, rng);
  // Every dispatch with at least one OTHER ready process must produce a quiz —
  // the winner is never sliced out just because its name sorts late.
  const quizTicks = new Set(quizzes.map((q) => q.tick));
  for (const st of run.ticks) {
    if (!st.running) continue;
    const prev = run.ticks[st.t - 1];
    if (prev && prev.running === st.running) continue;
    const others = new Set(st.ready.filter((nm) => nm !== st.running));
    if (others.size >= 1 && !quizTicks.has(st.t)) {
      fail("sched: dispatch with ready candidates dropped its quiz", st.t, algo, st.ready);
    }
  }
  const seen = new Set<number>();
  for (const { tick, quiz } of quizzes) {
    if (seen.has(tick)) fail("sched: duplicate quiz tick", tick);
    seen.add(tick);
    const state = run.ticks[tick];
    if (!state || state.t !== tick) { fail("sched: quiz tick out of range", tick); continue; }
    checkShape(quiz, "sched");
    const prev = run.ticks[tick - 1];
    if (prev && prev.running === state.running) fail("sched: quiz on non-dispatch tick", tick, algo);
    const p = state.running!;
    const spec = procs.find((s) => s.name === p)!;
    const picked = quiz.choices[quiz.answer];
    if (quiz.kind === "dispatch") {
      if (picked !== p) fail("sched: answer is not the dispatched process", picked, p, algo);
    } else if (quiz.kind === "wait-so-far") {
      const want = tick - spec.arrival - ranBefore(run, p, tick);
      if (Number(picked) !== want) fail("sched: wait-so-far answer wrong", picked, want, p, tick);
    } else if (quiz.kind === "remaining") {
      const want = spec.burst - ranBefore(run, p, tick);
      if (Number(picked) !== want) fail("sched: remaining answer wrong", picked, want, p, tick);
    } else {
      fail("sched: unknown quiz kind", quiz.kind);
    }
  }
}

// ---- sched spot check: 8 processes at t=0, winner must survive the cap ----
{
  // FCFS at t=0 dispatches P1 while P2..P8 wait — 7 other candidates. At t=0
  // "who runs?" is the only possible kind (nothing has waited or run yet), the
  // choice set caps at 5, and it must still contain P1 (the correct answer).
  currentSeed = BASE_SEED;
  const many: ProcSpec[] = Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}`, arrival: 0, burst: 3, priority: 1 }));
  const run = schedule("fcfs", many, 2);
  for (let k = 0; k < 50; k += 1) {
    const q0 = schedQuizzes(run, makeRng(BASE_SEED + k)).find((q) => q.tick === 0);
    if (!q0) { fail("sched spot: first dispatch produced no quiz despite 7 waiting"); continue; }
    if (q0.quiz.kind !== "dispatch") fail("sched spot: t=0 quiz should be the dispatch kind", q0.quiz.kind);
    if (q0.quiz.choices.length > 5) fail("sched spot: choice set exceeds cap", q0.quiz.choices);
    if (q0.quiz.choices[q0.quiz.answer] !== "P1") fail("sched spot: winner sliced out of choices", q0.quiz);
  }
}

// ---- paging ----
for (let t = 0; t < 400; t += 1) {
  currentSeed = BASE_SEED + 1000 + t;
  const rng = makeRng(currentSeed);
  const refs = Array.from({ length: 1 + rng.int(25) }, () => rng.int(8));
  const frames = 1 + rng.int(6);
  const algo = PAGE_ALGOS[rng.int(PAGE_ALGOS.length)].key;
  const run = pageReplace(algo, refs, frames);
  const quizzes = pagingQuizzes(run, rng);
  if (quizzes.length !== run.steps.length) fail("paging: quiz entry per step missing");
  quizzes.forEach(({ step, quizzes: qs }, i) => {
    if (step !== i) fail("paging: step index mismatch");
    const s = run.steps[i];
    const hf = qs[0];
    if (!hf) { fail("paging: missing hit/fault quiz", i); return; }
    checkShape(hf, "paging");
    if ((hf.choices[hf.answer] === "Hit") !== s.hit) fail("paging: hit/fault answer wrong", i, s.hit, hf);
    const before = i > 0 ? run.steps[i - 1].frames : run.steps[i].frames.map(() => null);
    const resident = before.filter((p): p is number => p !== null);
    const expectEvict = s.victim !== null && resident.length >= 2 && resident.includes(s.victim);
    if (expectEvict && qs.length !== 2) fail("paging: eviction step missing its second quiz", i, s.victim);
    if (qs.length > 2) fail("paging: more than two quizzes at one step", i);
    if (qs.length === 2) {
      const q2 = qs[1];
      checkShape(q2, "paging");
      const picked = q2.choices[q2.answer];
      if (q2.kind === "evict") {
        if (!expectEvict) fail("paging: evict quiz without an eviction", i);
        if (Number(picked) !== s.victim) fail("paging: eviction answer wrong", q2, s.victim);
      } else if (q2.kind === "faults-so-far") {
        if (Number(picked) !== s.faultsSoFar) fail("paging: faults-so-far answer wrong", picked, s.faultsSoFar);
      } else if (q2.kind === "lru-coldest") {
        if (algo !== "lru") fail("paging: lru-coldest on a non-LRU run", algo);
        const lastUse = (p: number): number => {
          for (let k = i - 1; k >= 0; k -= 1) if (refs[k] === p) return k;
          return -1;
        };
        const coldest = resident.reduce((a, b) => (lastUse(a) < lastUse(b) ? a : b));
        if (Number(picked) !== coldest) fail("paging: lru-coldest answer wrong", picked, coldest, i);
      } else {
        fail("paging: unknown second-quiz kind", q2.kind);
      }
    }
  });
}

// ---- wgraph ----
const apply = (d: WGraph, frames: Frame[]): WGraph =>
  (frames.length > 0 ? (frames[frames.length - 1].data as WGraph) : d);

for (let t = 0; t < 300; t += 1) {
  currentSeed = BASE_SEED + 2000 + t;
  const rng: Rng = makeRng(currentSeed);
  let d: WGraph = { kind: "wgraph", nodes: [], edges: [], directed: false };
  const nV = 3 + rng.int(5);
  for (let v = 1; v <= nV; v += 1) d = apply(d, wgraphAddNode(d, v));
  for (let v = 2; v <= nV; v += 1) d = apply(d, wgraphAddEdge(d, 1 + rng.int(v - 1), v, 1 + rng.int(20)));
  for (let k = 0; k < nV; k += 1) {
    const a = 1 + rng.int(nV);
    const b = 1 + rng.int(nV);
    if (a !== b) d = apply(d, wgraphAddEdge(d, a, b, 1 + rng.int(20)));
  }
  const valueOf = (id: number) => d.nodes.find((n) => n.id === id)?.value;

  // Dijkstra: settle-who names the settled vertex (ok[0]); settle-dist states
  // its locked-in distance (the frame's own d= label).
  for (const f of wgraphDijkstra(d, 1, undefined, rng)) {
    if (!f.quiz) continue;
    checkShape(f.quiz, "dijkstra");
    const settledId = (f.ok ?? [])[0];
    const settled = valueOf(settledId);
    const picked = f.quiz.choices[f.quiz.answer];
    if (f.quiz.kind === "settle-who") {
      if (!picked.startsWith(`${settled} `)) fail("dijkstra: quiz answer != settled vertex", picked, settled);
    } else if (f.quiz.kind === "settle-dist") {
      const want = Number((f.labels?.[settledId] ?? "").replace("d=", ""));
      if (Number(picked) !== want) fail("dijkstra: settle-dist answer wrong", picked, want);
    } else {
      fail("dijkstra: unknown quiz kind", f.quiz.kind);
    }
  }
  // Prim: correct choice names the edge the frame marks ok
  for (const f of wgraphPrim(d, 1, rng)) {
    if (!f.quiz) continue;
    checkShape(f.quiz, "prim");
    const chosen = d.edges.find((e) => e.id === (f.ok ?? [])[0]);
    if (!chosen) { fail("prim: quiz frame has no ok edge"); continue; }
    const name = `${valueOf(chosen.a)}—${valueOf(chosen.b)} (${chosen.w})`;
    if (f.quiz.choices[f.quiz.answer] !== name) fail("prim: quiz answer != chosen edge", f.quiz.choices[f.quiz.answer], name);
  }
  // Kruskal: verdict quiz matches accept (ok) vs reject (bad)
  for (const f of wgraphKruskal(d)) {
    if (!f.quiz) continue;
    checkShape(f.quiz, "kruskal");
    const accepted = (f.ok ?? []).length > 0;
    const saysAccept = f.quiz.answer === 0;
    if (accepted !== saysAccept) fail("kruskal: quiz verdict != frame verdict", f.note);
  }
}

// ---- variety: every kind must have appeared somewhere across the trials ----
for (const kind of ["dispatch", "wait-so-far", "remaining", "hit-fault", "evict", "faults-so-far", "lru-coldest", "settle-who", "settle-dist", "prim-edge", "kruskal-verdict"]) {
  if (!kindsSeen.has(kind)) fail(`variety: kind "${kind}" never appeared across all trials`);
}

console.log(fails === 0 ? "ALL PASS (400 sched + 400 paging + 300 wgraph trials)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
