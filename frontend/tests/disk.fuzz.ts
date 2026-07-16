// Fuzz suite for the disk scheduling engine + its predict-mode quizzes.
// Run: node --experimental-strip-types frontend/tests/disk.fuzz.ts
// Reproduce a failure: FUZZ_SEED=<printed base seed> node --experimental-strip-types frontend/tests/disk.fuzz.ts
//
// Invariants:
//  - every request is serviced exactly once; order is a permutation of the queue.
//  - moves chain head-to-head, distance = |to − from|, head stays on the platter,
//    totalSeek = Σ distances, steps mirror moves one-to-one.
//  - FCFS services in arrival order; SSTF always picks a true nearest request;
//    SCAN/LOOK reverse at most once; C-SCAN/C-LOOK sweep one way with exactly
//    one wrap jump; LOOK/C-LOOK never travel past the outermost request.
//  - SCAN ≥ LOOK and C-SCAN ≥ C-LOOK on the same spec (LOOK just skips run-outs).
//  - quizzes: 2–5 unique choices, valid answer index, each kind's correct
//    choice matches ground truth recomputed from the run; all kinds appear.
//  - presets teach what they claim (Silberschatz totals, SSTF starvation, …).

import {
  DISK_ALGOS,
  DISK_PRESETS,
  diskQuizzes,
  diskSchedule,
  MAX_DISK_REQUESTS,
  type DiskAlgo,
  type DiskDir,
  type DiskRun,
  type DiskSpec,
} from "../src/ds/disk.ts";
import { makeRng } from "../src/ds/rng.ts";
import type { Quiz } from "../src/ds/engine.ts";

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

const dirOf = (from: number, to: number): DiskDir | null => (to === from ? null : to > from ? "up" : "down");

/** Every structural invariant a single run must satisfy, whatever the algorithm. */
function checkRun(run: DiskRun): void {
  const { spec, algo } = run;
  const rim = spec.cylinders - 1;
  const a = algo;

  // order = permutation of the queue (requests are unique by construction)
  if (run.order.length !== spec.requests.length || new Set(run.order).size !== run.order.length ||
      !run.order.every((r) => spec.requests.includes(r))) {
    fail(`${a}: order is not a permutation of the queue`, run.order, spec.requests);
  }

  // moves chain, stay on the platter, distances honest
  let head = spec.head;
  let seek = 0;
  for (const mv of run.moves) {
    if (mv.from !== head) fail(`${a}: move does not start at the head`, mv, head);
    if (mv.distance !== Math.abs(mv.to - mv.from)) fail(`${a}: dishonest distance`, mv);
    if (mv.to < 0 || mv.to > rim || mv.from < 0 || mv.from > rim) fail(`${a}: head left the platter`, mv, rim);
    if (mv.serviced === null && !mv.jump && !mv.sweep) fail(`${a}: idle move is neither jump nor sweep`, mv);
    head = mv.to;
    seek += mv.distance;
  }
  if (run.totalSeek !== seek) fail(`${a}: totalSeek != sum of move distances`, run.totalSeek, seek);
  if (run.avgSeek !== run.totalSeek / spec.requests.length) fail(`${a}: avgSeek wrong`, run.avgSeek);

  // steps mirror moves one-to-one
  if (run.steps.length !== run.moves.length + 1) fail(`${a}: steps/moves count mismatch`);
  if (run.steps[0].head !== spec.head || run.steps[0].seekSoFar !== 0 ||
      JSON.stringify(run.steps[0].pending) !== JSON.stringify(spec.requests)) {
    fail(`${a}: initial step is not the initial state`, run.steps[0]);
  }
  run.moves.forEach((mv, i) => {
    const before = run.steps[i];
    const after = run.steps[i + 1];
    if (after.head !== mv.to) fail(`${a}: step head disagrees with move`, i, after.head, mv);
    if (after.servicing !== mv.serviced) fail(`${a}: step servicing disagrees with move`, i);
    if (after.seekSoFar !== before.seekSoFar + mv.distance) fail(`${a}: seekSoFar not cumulative`, i);
    const expectPending = before.pending.filter((p) => p !== mv.serviced);
    if (JSON.stringify(after.pending) !== JSON.stringify(expectPending)) {
      fail(`${a}: pending set drifted`, i, after.pending, expectPending);
    }
  });
  if (run.steps[run.steps.length - 1].pending.length !== 0) fail(`${a}: run ended with pending requests`);

  // per-algorithm behavior
  const realDirs = run.moves.filter((m) => m.to !== m.from);
  const jumps = run.moves.filter((m) => m.jump);
  const sweeps = run.moves.filter((m) => m.sweep);
  if (a !== "cscan" && a !== "clook" && jumps.length > 0) fail(`${a}: unexpected wrap jump`);
  if (a !== "scan" && a !== "cscan" && sweeps.length > 0) fail(`${a}: unexpected rim sweep`);
  if (jumps.length > 1) fail(`${a}: more than one wrap jump`);
  for (const s of sweeps) {
    if (s.to !== 0 && s.to !== rim) fail(`${a}: sweep did not land on the rim`, s);
  }

  if (a === "fcfs") {
    if (JSON.stringify(run.order) !== JSON.stringify(spec.requests)) fail("fcfs: order != arrival order", run.order);
  }

  if (a === "sstf") {
    run.moves.forEach((mv, i) => {
      const pending = run.steps[i].pending;
      const best = Math.min(...pending.map((p) => Math.abs(p - mv.from)));
      if (mv.serviced === null || Math.abs(mv.serviced - mv.from) !== best) {
        fail("sstf: did not pick a nearest request", mv, pending);
      }
    });
  }

  if (a === "scan" || a === "look") {
    let reversals = 0;
    for (let i = 1; i < realDirs.length; i += 1) {
      if (dirOf(realDirs[i].from, realDirs[i].to) !== dirOf(realDirs[i - 1].from, realDirs[i - 1].to)) reversals += 1;
    }
    if (reversals > 1) fail(`${a}: head reversed more than once`, reversals);
    if (a === "look" && run.moves.some((m) => m.serviced === null)) fail("look: emitted a move that services nothing");
  }

  if (a === "cscan" || a === "clook") {
    for (const mv of realDirs) {
      const d = dirOf(mv.from, mv.to);
      if (mv.jump) {
        if (d === spec.dir) fail(`${a}: wrap jump travels with the sweep, not against it`, mv);
      } else if (d !== spec.dir) {
        fail(`${a}: serviced/swept against the sweep direction`, mv);
      }
    }
    if (a === "cscan" && jumps.length === 1) {
      const edge = spec.dir === "up" ? rim : 0;
      const home = spec.dir === "up" ? 0 : rim;
      if (jumps[0].from !== edge || jumps[0].to !== home) fail("cscan: jump is not rim-to-rim", jumps[0]);
    }
    if (a === "clook" && jumps.length === 1) {
      const landed = jumps[0].serviced;
      const pendingBefore = run.steps[run.moves.indexOf(jumps[0])].pending;
      const want = spec.dir === "up" ? Math.min(...pendingBefore) : Math.max(...pendingBefore);
      if (landed !== want) fail("clook: jump did not land on the far pending extreme", jumps[0], want);
    }
  }

  if (a === "look" || a === "clook") {
    const lo = Math.min(spec.head, ...spec.requests);
    const hi = Math.max(spec.head, ...spec.requests);
    for (const mv of run.moves) {
      if (mv.to < lo || mv.to > hi) fail(`${a}: travelled past the outermost request`, mv, lo, hi);
    }
  }
}

/** Quiz answers must match ground truth recomputed from the run. */
function checkQuizzes(run: DiskRun, seed: number): void {
  const quizzes = diskQuizzes(run, makeRng(seed));
  let lastStep = 0;
  for (const { step, quiz } of quizzes) {
    if (step < 1 || step >= run.steps.length) { fail("quiz: gate step out of range", step); continue; }
    if (step <= lastStep) fail("quiz: gate steps not strictly increasing", step, lastStep);
    lastStep = step;
    checkShape(quiz, `quiz(${run.algo})`);
    const mv = run.moves[step - 1];
    const after = run.steps[step];
    const picked = quiz.choices[quiz.answer];
    if (quiz.kind === "next-served") {
      if (picked !== String(mv.serviced)) fail("quiz: next-served answer is not the serviced request", picked, mv);
      if (mv.serviced === null || mv.jump) fail("quiz: next-served asked on a non-service move", mv);
    } else if (quiz.kind === "move-distance") {
      if (Number(picked) !== mv.distance) fail("quiz: move-distance answer wrong", picked, mv.distance);
    } else if (quiz.kind === "seek-so-far") {
      if (Number(picked) !== after.seekSoFar) fail("quiz: seek-so-far answer wrong", picked, after.seekSoFar);
    } else if (quiz.kind === "direction") {
      const want = mv.to > mv.from ? "toward higher cylinders" : "toward lower cylinders";
      if (picked !== want) fail("quiz: direction answer wrong", picked, want);
      const prev = run.moves[step - 2];
      if (!prev || dirOf(prev.from, prev.to) === dirOf(mv.from, mv.to)) fail("quiz: direction asked where the head did not turn", step);
    } else {
      fail("quiz: unknown kind", quiz.kind);
    }
  }
}

// ---- random trials: every algorithm on every spec, plus the LOOK≤SCAN laws ----
for (let t = 0; t < 400; t += 1) {
  currentSeed = BASE_SEED + t;
  const rng = makeRng(currentSeed);
  // mostly classroom-sized platters, occasionally the 2000-cylinder cap
  const cylinders = rng.next() < 0.1 ? 2000 : 20 + rng.int(181);
  const n = 1 + rng.int(MAX_DISK_REQUESTS);
  const requests: number[] = [];
  const used = new Set<number>();
  while (requests.length < n) {
    const r = rng.int(cylinders);
    if (!used.has(r)) { used.add(r); requests.push(r); }
  }
  const spec: DiskSpec = {
    cylinders,
    // sometimes park the head exactly on a request or on the rim
    head: rng.next() < 0.15 ? rng.pick([0, cylinders - 1, requests[0]]) : rng.int(cylinders),
    requests,
    dir: rng.next() < 0.5 ? "up" : "down",
  };

  const runs = {} as Record<DiskAlgo, DiskRun>;
  for (const meta of DISK_ALGOS) {
    runs[meta.key] = diskSchedule(meta.key, spec);
    checkRun(runs[meta.key]);
    checkQuizzes(runs[meta.key], currentSeed + 7 * meta.key.length);
  }
  if (runs.scan.totalSeek < runs.look.totalSeek) {
    fail("scan beat look — run-outs cannot shorten the path", runs.scan.totalSeek, runs.look.totalSeek, spec);
  }
  if (runs.cscan.totalSeek < runs.clook.totalSeek) {
    fail("c-scan beat c-look — the rim jump cannot shorten the path", runs.cscan.totalSeek, runs.clook.totalSeek, spec);
  }
}

// ---- presets teach exactly what they claim ----
{
  currentSeed = BASE_SEED;
  const [textbook, starve, scanVsLook, wrap] = DISK_PRESETS.map((p) => ({
    cylinders: p.cylinders, head: p.head, requests: p.requests, dir: p.dir,
  }));

  // the classic Silberschatz queue — the totals every OS course quotes
  // (SCAN/C-SCAN run to the rim; the C-SCAN/C-LOOK jump is counted)
  const expect: Record<DiskAlgo, number> = { fcfs: 640, sstf: 236, scan: 331, cscan: 382, look: 299, clook: 322 };
  for (const meta of DISK_ALGOS) {
    const got = diskSchedule(meta.key, textbook).totalSeek;
    if (got !== expect[meta.key]) fail(`preset: Silberschatz ${meta.key} total should be ${expect[meta.key]}`, got);
  }
  const sstfOrder = diskSchedule("sstf", textbook).order;
  if (JSON.stringify(sstfOrder) !== JSON.stringify([65, 67, 37, 14, 98, 122, 124, 183])) {
    fail("preset: Silberschatz SSTF service order off", sstfOrder);
  }

  // SSTF starvation: the far request is served dead last
  const starved = diskSchedule("sstf", starve).order;
  if (starved[starved.length - 1] !== 190) fail("preset: SSTF starvation queue should serve 190 last", starved);

  // SCAN pays for the rim trip that LOOK skips
  const scanRun = diskSchedule("scan", scanVsLook);
  const lookRun = diskSchedule("look", scanVsLook);
  if (!(scanRun.totalSeek > lookRun.totalSeek)) fail("preset: SCAN should beat LOOK's total here", scanRun.totalSeek, lookRun.totalSeek);
  if (!scanRun.moves.some((m) => m.sweep && m.to === 199)) fail("preset: SCAN should sweep to the rim");
  if (lookRun.moves.some((m) => m.to > 120)) fail("preset: LOOK should turn back at 120");

  // C-SCAN wraparound: exactly one full-width jump dominates the total
  const wrapRun = diskSchedule("cscan", wrap);
  const jump = wrapRun.moves.find((m) => m.jump);
  if (!jump || jump.distance !== 199) fail("preset: C-SCAN wrap should be the full 199-cylinder jump", jump);
}

// ---- variety: every question kind must have appeared across the trials ----
for (const kind of ["next-served", "move-distance", "seek-so-far", "direction"]) {
  if (!kindsSeen.has(kind)) fail(`variety: kind "${kind}" never appeared across all trials`);
}

console.log(fails === 0 ? "ALL PASS (400 specs × 6 algorithms + quiz ground truth + presets)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
