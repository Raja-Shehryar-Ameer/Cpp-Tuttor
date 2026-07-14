// Deadlock engine: Banker's algorithm (safety check on Need = Max − Alloc)
// and deadlock detection (same scan on an outstanding Request matrix) share
// one narrated scan loop, so the matrices panel, safe-sequence strip, and
// RAG scene always agree. Pure logic — the lab component owns all rendering.
//
// Conventions (stated in the UI too):
//  - Multi-instance resources: Available/Allocation/Max/Request are vectors
//    and matrices of instance COUNTS, not booleans.
//  - Banker mode answers "is this state SAFE?" — Need(i) = Max(i) − Alloc(i)
//    must fit in Work for Pi to be assumed able to finish.
//  - Detection mode answers "is the system DEADLOCKED right now?" — Request(i)
//    is what Pi is waiting for TODAY; per Coffman, a process holding nothing
//    (all-zero Alloc row) starts out Finished since it can't block anyone.
//  - The scan always probes the lowest-index unfinished process first, so
//    runs are deterministic and match what a student would do by hand.

import type { Quiz } from "./engine.ts";
import { makeRng, numericChoices, pickVaried, type Rng } from "./rng.ts";
import type { StepQuizzes } from "./paging.ts";

export type DLMode = "banker" | "detect";

export const MAX_DL_PROCS = 7;
export const MAX_RES = 5;
export const MAX_UNITS = 20;

export const RES_NAMES = ["A", "B", "C", "D", "E"];
export const procName = (i: number): string => `P${i}`;

export interface DeadlockSpec {
  mode: DLMode;
  /** length m: currently free instances of each resource */
  available: number[];
  /** n×m: instances each process currently holds */
  alloc: number[][];
  /** banker mode, n×m: each process's declared maximum demand (≥ alloc) */
  max?: number[][];
  /** detect mode, n×m: each process's outstanding request */
  request?: number[][];
}

export interface DLModeMeta {
  key: DLMode;
  label: string;
  short: string;
  blurb: string;
}

export const DEADLOCK_MODES: DLModeMeta[] = [
  { key: "banker", label: "Banker's algorithm (safety check)", short: "Banker's",
    blurb: "Dijkstra's Banker: pretend every process may demand its declared maximum, then look for an order in which all of them can still finish. If one exists, the state is SAFE and that order is a safe sequence." },
  { key: "detect", label: "Deadlock detection (request matrix)", short: "Detection",
    blurb: "No maximums here — just what each process is waiting for RIGHT NOW. Any process whose request fits in the free pool can finish and return what it holds; whoever is left at the end is deadlocked." },
];

export type DLStepKind = "start" | "check" | "finish" | "pass-end" | "verdict";

export interface DLStep {
  kind: DLStepKind;
  /** row under the lens (check/finish), else null */
  proc: number | null;
  /** Work vector AFTER this step */
  work: number[];
  /** Finish flags AFTER this step */
  finish: boolean[];
  /** for "check": did Need/Request(proc) fit in Work? */
  canRun?: boolean;
  /** safe sequence built so far */
  seqSoFar: number[];
  note: string;
}

export interface DLRun {
  spec: DeadlockSpec;
  /** the comparison matrix the scan uses: banker Need = Max − Alloc; detect Request */
  need: number[][];
  steps: DLStep[];
  /** banker: state is safe; detect: no deadlock */
  safe: boolean;
  safeSeq: number[];
  /** processes that can never finish (unsafe knot / deadlocked set) */
  stuck: number[];
}

const vec = (xs: number[]): string => `(${xs.join(",")})`;
const fits = (need: number[], work: number[]): boolean => need.every((x, j) => x <= work[j]);

export function runDeadlock(spec: DeadlockSpec): DLRun {
  const n = spec.alloc.length;
  const m = spec.available.length;
  const needName = spec.mode === "banker" ? "Need" : "Request";
  const need: number[][] =
    spec.mode === "banker"
      ? spec.alloc.map((row, i) => row.map((a, j) => (spec.max?.[i]?.[j] ?? a) - a))
      : spec.alloc.map((_, i) => [...(spec.request?.[i] ?? Array.from({ length: m }, () => 0))]);

  const work = [...spec.available];
  const finish = spec.alloc.map((row) =>
    // Detection's classic head start: a process holding nothing can't be part
    // of a deadlock — it blocks nobody and needs nobody's release to leave.
    spec.mode === "detect" ? row.every((x) => x === 0) : false,
  );
  const seq: number[] = [];
  const steps: DLStep[] = [];
  const snap = (kind: DLStepKind, proc: number | null, note: string, canRun?: boolean) =>
    steps.push({ kind, proc, work: [...work], finish: [...finish], seqSoFar: [...seq], note, ...(canRun !== undefined ? { canRun } : {}) });

  const preFinished = finish.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  snap("start", null,
    spec.mode === "banker"
      ? `Work starts as Available ${vec(work)}. Find a process whose Need fits in Work — it can run to completion and hand everything back.`
      : `Work starts as Available ${vec(work)}.${preFinished.length > 0 ? ` ${preFinished.map(procName).join(", ")} hold${preFinished.length === 1 ? "s" : ""} nothing, so ${preFinished.length === 1 ? "it" : "they"} can't be deadlocked — marked finished up front.` : ""} Find a process whose Request fits in Work.`);

  for (;;) {
    let progress = false;
    for (let i = 0; i < n; i += 1) {
      if (finish[i]) continue;
      const can = fits(need[i], work);
      snap("check", i,
        can
          ? `${needName}(${procName(i)}) = ${vec(need[i])} ≤ Work ${vec(work)} — ${procName(i)} can finish.`
          : `${needName}(${procName(i)}) = ${vec(need[i])} needs more than Work ${vec(work)} — skip it for now.`,
        can);
      if (!can) continue;
      finish[i] = true;
      seq.push(i);
      for (let j = 0; j < m; j += 1) work[j] += spec.alloc[i][j];
      snap("finish", i, `${procName(i)} runs to completion and releases its allocation ${vec(spec.alloc[i])} — Work grows to ${vec(work)}.`);
      progress = true;
    }
    if (finish.every(Boolean)) break;
    if (!progress) {
      snap("pass-end", null, `A full pass over ${finish.filter((f) => !f).length} unfinished process${finish.filter((f) => !f).length === 1 ? "" : "es"} made no progress — nobody's ${needName.toLowerCase()} fits in Work ${vec(work)}.`);
      break;
    }
  }

  const stuck = finish.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  const safe = stuck.length === 0;
  snap("verdict", null,
    spec.mode === "banker"
      ? safe
        ? `Every process can finish — the state is SAFE. Safe sequence: ${seq.map(procName).join(" → ")}.`
        : `${stuck.map(procName).join(", ")} can never satisfy ${stuck.length === 1 ? "its" : "their"} Need — the state is UNSAFE. No safe sequence exists, so granting requests from here risks deadlock.`
      : safe
        ? `Every process can finish — no deadlock. Completion order: ${seq.map(procName).join(" → ")}.`
        : `${stuck.map(procName).join(", ")} wait for each other's resources forever — DEADLOCKED.`);

  return { spec, need, steps, safe, safeSeq: seq, stuck };
}

// ---------- RAG cycle (drawn by the lab's resource-allocation graph) ----------

export interface RagCycle {
  /** node keys in cycle order: "p3" for processes, "r1" for resources */
  nodes: string[];
  /** edge keys "p3>r1" (request) and "r1>p3" (assignment) on the cycle */
  edges: string[];
}

/** Find one request→assignment cycle among the stuck set — the visual knot
    behind the verdict. Edges: Pi→Rj when need[i][j] > 0, Rj→Pi when
    alloc[i][j] > 0 (restricted to stuck processes). Engine-side so the fuzz
    suite can assert every deadlocked run really exhibits a cycle to draw. */
export function findRagCycle(run: DLRun): RagCycle | null {
  if (run.stuck.length === 0) return null;
  const stuck = new Set(run.stuck);
  const m = run.spec.available.length;
  // adjacency over keys: p<i> -> r<j> (request), r<j> -> p<i> (assignment)
  const out = new Map<string, string[]>();
  for (const i of run.stuck) {
    out.set(`p${i}`, []);
    for (let j = 0; j < m; j += 1) {
      if (run.need[i][j] > 0) out.get(`p${i}`)!.push(`r${j}`);
    }
  }
  for (let j = 0; j < m; j += 1) {
    const holders = run.spec.alloc
      .map((row, i) => (stuck.has(i) && row[j] > 0 ? `p${i}` : null))
      .filter((x): x is string => x !== null);
    if (holders.length > 0) out.set(`r${j}`, holders);
  }
  // iterative DFS with a path stack, hunting for a back edge
  for (const start of out.keys()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    const visited = new Set<string>();
    const walk = (node: string): RagCycle | null => {
      path.push(node);
      onPath.add(node);
      for (const next of out.get(node) ?? []) {
        if (onPath.has(next)) {
          const cyc = path.slice(path.indexOf(next));
          return {
            nodes: cyc,
            edges: cyc.map((a, k) => `${a}>${cyc[(k + 1) % cyc.length]}`),
          };
        }
        if (!visited.has(next)) {
          const found = walk(next);
          if (found) return found;
        }
      }
      path.pop();
      onPath.delete(node);
      visited.add(node);
      return null;
    };
    const found = walk(start);
    if (found) return found;
  }
  return null;
}

// ---------- predict-mode quizzes ----------

/** Varied questions gated before scan steps (paging's {step, quizzes} shape).
    Pure — derived from a finished run plus a caller-supplied Rng. */
export function deadlockQuizzes(run: DLRun, rng: Rng = makeRng()): StepQuizzes[] {
  const needName = run.spec.mode === "banker" ? "Need" : "Request";
  const out: StepQuizzes[] = [];
  let lastKind: string | null = null;
  const resCount = run.spec.available.length;

  run.steps.forEach((step, si) => {
    const candidates: Quiz[] = [];
    const prev = si > 0 ? run.steps[si - 1] : null;

    if (step.kind === "check" && step.proc !== null && prev) {
      candidates.push({
        kind: "can-finish",
        prompt: `${needName}(${procName(step.proc)}) = ${vec(run.need[step.proc])}, Work = ${vec(prev.work)} — can ${procName(step.proc)} finish now?`,
        choices: ["Yes — its demand fits in Work", "No — it needs more than Work has"],
        answer: step.canRun ? 0 : 1,
        explain: step.note,
      });
      // "what is Need[i][j]?" — only worth asking with 2+ resources.
      if (resCount >= 2) {
        const j = rng.int(resCount);
        const cellQ = numericChoices(run.need[step.proc][j], rng);
        if (cellQ) {
          candidates.push({
            kind: "need-cell",
            prompt: run.spec.mode === "banker"
              ? `What is Need[${procName(step.proc)}][${RES_NAMES[j]}]?  (Need = Max − Allocation)`
              : `How many units of ${RES_NAMES[j]} is ${procName(step.proc)} requesting?`,
            ...cellQ,
            explain: run.spec.mode === "banker"
              ? `Need[${procName(step.proc)}][${RES_NAMES[j]}] = Max ${run.spec.max![step.proc][j]} − Alloc ${run.spec.alloc[step.proc][j]} = ${run.need[step.proc][j]}.`
              : `${procName(step.proc)}'s outstanding request for ${RES_NAMES[j]} is ${run.need[step.proc][j]}.`,
          });
        }
      }
    }

    if (step.kind === "finish" && step.proc !== null && prev) {
      // "who finishes next?" — the scan's central decision. Candidates are
      // the processes unfinished BEFORE this step; the answer is pinned,
      // capped at 5, then shuffled.
      const unfinished = prev.finish.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
      if (unfinished.length >= 2) {
        const others = rng.shuffle(unfinished.filter((i) => i !== step.proc)).slice(0, 4);
        const choices = rng.shuffle([step.proc, ...others]).map(procName);
        candidates.push({
          kind: "who-next",
          prompt: `Work = ${vec(prev.work)} — which process is satisfied next?`,
          choices,
          answer: choices.indexOf(procName(step.proc)),
          explain: `${needName}(${procName(step.proc)}) = ${vec(run.need[step.proc])} fits in Work ${vec(prev.work)} — the scan probes lowest index first, and ${procName(step.proc)} is the first that fits.`,
        });
      }
    }

    if (step.kind === "verdict") {
      candidates.push({
        kind: "verdict",
        prompt: run.spec.mode === "banker" ? "The scan is done — is this state safe?" : "The scan is done — is the system deadlocked?",
        choices: run.spec.mode === "banker"
          ? ["Safe — every process can finish", "Unsafe — someone can never finish"]
          : ["No deadlock — every process can finish", "Deadlocked — a knot of waiters remains"],
        answer: run.spec.mode === "banker" ? (run.safe ? 0 : 1) : (run.safe ? 0 : 1),
        explain: step.note,
      });
    }

    if (candidates.length === 0) return;
    // finish/verdict gates always ask; row probes only sometimes, so a long
    // scan doesn't quiz every single check.
    if (step.kind === "check" && rng.next() >= 0.45) return;
    const quiz: Quiz = pickVaried(candidates as (Quiz & { kind: string })[], lastKind, rng);
    lastKind = quiz.kind ?? null;
    out.push({ step: si, quizzes: [quiz] });
  });
  return out;
}

// ---------- presets ----------

export interface DeadlockPreset {
  name: string;
  hint: string;
  spec: DeadlockSpec;
}

export const DEADLOCK_PRESETS: DeadlockPreset[] = [
  {
    name: "Textbook safe state",
    hint: "The Silberschatz classic: 5 processes, 3 resources, Available (3,3,2) — safe, with sequence P1 → P3 → P4 → P0 → P2.",
    spec: {
      mode: "banker",
      available: [3, 3, 2],
      alloc: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
      max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
    },
  },
  {
    name: "One request too greedy",
    hint: "The textbook state after granting P1 (1,0,2) and then P0 (0,2,0) — Available shrinks to (2,1,0) and NO safe sequence survives. One granted request is all it takes.",
    spec: {
      mode: "banker",
      available: [2, 1, 0],
      alloc: [[0, 3, 0], [3, 0, 2], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
      max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
    },
  },
  {
    name: "Circular wait",
    hint: "Detection mode: P0 holds A and wants B, P1 holds B and wants C, P2 holds C and wants A — a perfect knot. Watch the RAG cycle light up.",
    spec: {
      mode: "detect",
      available: [0, 0, 0],
      alloc: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      request: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    },
  },
  {
    name: "Blocked but not deadlocked",
    hint: "Detection mode: everyone is waiting, but one free unit of C lets P2 finish, whose release unblocks the rest — blocked ≠ deadlocked.",
    spec: {
      mode: "detect",
      available: [0, 0, 1],
      alloc: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      request: [[0, 1, 0], [0, 0, 1], [0, 0, 1]],
    },
  },
];
