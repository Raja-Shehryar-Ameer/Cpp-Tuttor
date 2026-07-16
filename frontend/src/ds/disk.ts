// Disk scheduling engine: every algorithm walks the same request queue and
// emits one move per head event, so the zigzag chart, the narrated steps, and
// the seek totals always agree. Pure logic — the lab component owns rendering.
//
// Conventions (stated in the UI too):
//  - SCAN / C-SCAN run out to the physical rim before turning; LOOK / C-LOOK
//    reverse at the last pending request.
//  - The C-SCAN / C-LOOK return jump IS counted in the total head movement
//    (the dominant exam convention — some textbooks exclude it).
//  - SSTF distance ties break toward the current travel direction, then
//    toward the lower cylinder.

import type { Quiz } from "./engine.ts";
import { makeRng, numericChoices, pickVaried, type Rng } from "./rng.ts";

export type DiskAlgo = "fcfs" | "sstf" | "scan" | "cscan" | "look" | "clook";
export type DiskDir = "up" | "down";

export interface DiskSpec {
  cylinders: number; // track numbers run 0 .. cylinders-1
  head: number; // starting head position
  requests: number[]; // pending cylinder requests, in arrival order
  dir: DiskDir; // initial travel direction (SCAN family only)
}

export interface DiskAlgoMeta {
  key: DiskAlgo;
  label: string;
  short: string;
  usesDirection: boolean;
  blurb: string;
}

export const DISK_ALGOS: DiskAlgoMeta[] = [
  { key: "fcfs", label: "FCFS (First Come First Served)", short: "FCFS", usesDirection: false,
    blurb: "Services requests strictly in arrival order. Fair by arrival, blind to geometry — the head zigzags wildly across the platter." },
  { key: "sstf", label: "SSTF (Shortest Seek Time First)", short: "SSTF", usesDirection: false,
    blurb: "Always jumps to the closest pending request. Great average seek time, but a far-away request can starve while nearby ones keep arriving." },
  { key: "scan", label: "SCAN (elevator)", short: "SCAN", usesDirection: true,
    blurb: "Sweeps in one direction servicing everything on the way, runs out to the rim, then reverses — like an elevator that visits the top floor even when nobody asked." },
  { key: "cscan", label: "C-SCAN (circular SCAN)", short: "C-SCAN", usesDirection: true,
    blurb: "Sweeps one way only: at the rim it flies back to the far edge and starts over. Uniform wait times — the return jump is the price." },
  { key: "look", label: "LOOK", short: "LOOK", usesDirection: true,
    blurb: "SCAN without the wasted trip: reverses at the last pending request instead of the physical rim." },
  { key: "clook", label: "C-LOOK", short: "C-LOOK", usesDirection: true,
    blurb: "C-SCAN without the wasted trip: wraps from the last request straight to the lowest pending one and keeps sweeping the same way." },
];

export const MAX_DISK_REQUESTS = 12;
export const MIN_CYL = 20;
export const MAX_CYL = 2000;
export const DEFAULT_CYL = 200;

export interface DiskMove {
  from: number;
  to: number;
  distance: number;
  /** cylinder serviced by this move, null for a pure sweep / empty jump */
  serviced: number | null;
  /** C-SCAN / C-LOOK wraparound */
  jump?: boolean;
  /** SCAN / C-SCAN run-out to the rim (services nothing) */
  sweep?: boolean;
}

export interface DiskStep {
  head: number; // head position AFTER this step
  servicing: number | null;
  pending: number[]; // still unserviced AFTER this step
  seekSoFar: number;
  note: string;
  jump?: boolean;
}

export interface DiskRun {
  algo: DiskAlgo;
  spec: DiskSpec;
  order: number[]; // service order
  moves: DiskMove[];
  steps: DiskStep[]; // steps[0] = initial state; steps[i+1] follows moves[i]
  totalSeek: number;
  avgSeek: number;
}

export function diskSchedule(algo: DiskAlgo, spec: DiskSpec): DiskRun {
  const { cylinders, dir } = spec;
  const rim = cylinders - 1;
  const pending = [...spec.requests];
  const order: number[] = [];
  const moves: DiskMove[] = [];
  let head = spec.head;
  let seek = 0;

  const meta = DISK_ALGOS.find((a) => a.key === algo)!;
  const steps: DiskStep[] = [{
    head,
    servicing: null,
    pending: [...pending],
    seekSoFar: 0,
    note: `${meta.short}: the head starts at cylinder ${head}${meta.usesDirection ? `, heading ${dir === "up" ? "toward higher cylinders" : "toward lower cylinders"}` : ""} — ${pending.length} request${pending.length === 1 ? "" : "s"} waiting.`,
  }];

  const moveTo = (to: number, serviced: number | null, note: string, flags?: { jump?: boolean; sweep?: boolean }) => {
    const distance = Math.abs(to - head);
    seek += distance;
    moves.push({ from: head, to, distance, serviced, ...flags });
    head = to;
    if (serviced !== null) {
      pending.splice(pending.indexOf(serviced), 1);
      order.push(serviced);
    }
    steps.push({ head, servicing: serviced, pending: [...pending], seekSoFar: seek, note, ...(flags?.jump ? { jump: true } : {}) });
  };

  /** Service every pending request at-or-beyond the head in direction d, nearest first. */
  const serviceAhead = (d: DiskDir) => {
    for (;;) {
      const ahead = pending.filter((p) => (d === "up" ? p >= head : p <= head));
      if (ahead.length === 0) return;
      const next = d === "up" ? Math.min(...ahead) : Math.max(...ahead);
      moveTo(next, next, `heading ${d}: ${next} is the next request ${d === "up" ? "above" : "below"} the head — ${Math.abs(next - head)} cylinder${Math.abs(next - head) === 1 ? "" : "s"} away.`);
    }
  };

  switch (algo) {
    case "fcfs": {
      for (const r of spec.requests) {
        moveTo(r, r, `FCFS: next in the queue is ${r} — |${r} − ${head}| = ${Math.abs(r - head)} cylinders.`);
      }
      break;
    }

    case "sstf": {
      let curDir: DiskDir = dir;
      while (pending.length > 0) {
        let best = pending[0];
        for (const p of pending) {
          const dp = Math.abs(p - head);
          const db = Math.abs(best - head);
          if (dp < db) best = p;
          else if (dp === db && p !== best) {
            const pUp = p >= head;
            const bUp = best >= head;
            if (pUp !== bUp) {
              if ((curDir === "up") === pUp) best = p;
            } else if (p < best) best = p;
          }
        }
        const rest = pending.filter((p) => p !== best);
        const runnerUp = rest.length > 0
          ? rest.reduce((a, b) => (Math.abs(a - head) <= Math.abs(b - head) ? a : b))
          : null;
        const note = runnerUp !== null
          ? `SSTF: ${best} is closest to ${head} (${Math.abs(best - head)} away, vs ${runnerUp} → ${Math.abs(runnerUp - head)}).`
          : `SSTF: ${best} is the last request — ${Math.abs(best - head)} cylinders away.`;
        if (best !== head) curDir = best > head ? "up" : "down";
        moveTo(best, best, note);
      }
      break;
    }

    case "scan": {
      let d: DiskDir = dir;
      while (pending.length > 0) {
        serviceAhead(d);
        if (pending.length === 0) break;
        const edge = d === "up" ? rim : 0;
        if (head !== edge) {
          moveTo(edge, null, `no more requests ${d === "up" ? "above" : "below"} — SCAN still sweeps on to the rim (cylinder ${edge}) before turning.`, { sweep: true });
        }
        d = d === "up" ? "down" : "up";
      }
      break;
    }

    case "cscan": {
      serviceAhead(dir);
      if (pending.length > 0) {
        const edge = dir === "up" ? rim : 0;
        const home = dir === "up" ? 0 : rim;
        if (head !== edge) {
          moveTo(edge, null, `sweep on to the rim (cylinder ${edge}) — C-SCAN services in one direction only.`, { sweep: true });
        }
        const landed = pending.includes(home) ? home : null;
        moveTo(home, landed, `wrap around: ${edge} → ${home}. The return jump counts as ${rim} cylinders here — some textbooks exclude it.`, { jump: true });
        serviceAhead(dir);
      }
      break;
    }

    case "look": {
      let d: DiskDir = dir;
      while (pending.length > 0) {
        serviceAhead(d);
        if (pending.length === 0) break;
        d = d === "up" ? "down" : "up";
        // LOOK reverses in place at the last request — no run-out move.
      }
      break;
    }

    case "clook": {
      serviceAhead(dir);
      if (pending.length > 0) {
        const wrapTo = dir === "up" ? Math.min(...pending) : Math.max(...pending);
        moveTo(wrapTo, wrapTo, `wrap to the ${dir === "up" ? "lowest" : "highest"} pending request (${wrapTo}) — C-LOOK's jump counts as ${Math.abs(wrapTo - head)} cylinders here.`, { jump: true });
        serviceAhead(dir);
      }
      break;
    }
  }

  const n = spec.requests.length || 1;
  return { algo, spec, order, moves, steps, totalSeek: seek, avgSeek: seek / n };
}

export interface DiskQuiz {
  /** predict mode pauses BEFORE this step index and asks */
  step: number;
  quiz: Quiz;
}

/** One question per head move, varied in type per gate. Pure — same
    Rng-parameter contract as schedQuizzes, so the fuzz suite can replay any
    failure from its seed while the lab gets fresh questions each run. */
export function diskQuizzes(run: DiskRun, rng: Rng = makeRng()): DiskQuiz[] {
  const meta = DISK_ALGOS.find((a) => a.key === run.algo)!;
  const out: DiskQuiz[] = [];
  let lastKind: string | null = null;

  run.moves.forEach((mv, i) => {
    const before = run.steps[i];
    const after = run.steps[i + 1];
    const candidates: (Quiz & { kind: string })[] = [];

    // "who's next?" — the algorithm's core decision. Winner pinned in before
    // the cap-5 slice, then shuffled, so it can never be sliced out.
    if (mv.serviced !== null && !mv.jump && before.pending.length > 1) {
      const others = before.pending.filter((p) => p !== mv.serviced);
      const choices = rng.shuffle([mv.serviced, ...rng.shuffle(others).slice(0, 4)]).map(String);
      candidates.push({
        kind: "next-served",
        prompt: `the head is at ${mv.from} — which request does ${meta.short} service next?`,
        choices,
        answer: choices.indexOf(String(mv.serviced)),
        explain: after.note,
      });
    }

    // "how far is that move?"
    if (mv.distance > 0 && mv.serviced !== null) {
      const distQ = numericChoices(mv.distance, rng);
      if (distQ) {
        candidates.push({
          kind: "move-distance",
          prompt: `the head moves ${mv.from} → ${mv.to} — how many cylinders is that?`,
          ...distQ,
          explain: `|${mv.to} − ${mv.from}| = ${mv.distance}.`,
        });
      }
    }

    // "total so far?" — only once a few moves have accumulated.
    if (i >= 2) {
      const sumQ = numericChoices(after.seekSoFar, rng);
      if (sumQ) {
        candidates.push({
          kind: "seek-so-far",
          prompt: `after this move (${mv.from} → ${mv.to}), what is the total head movement so far?`,
          ...sumQ,
          explain: `${run.moves.slice(0, i + 1).map((m) => m.distance).join(" + ")} = ${after.seekSoFar}.`,
        });
      }
    }

    // "which way now?" — asked exactly where the head turns or wraps.
    const prev = run.moves[i - 1];
    const dirOf = (m: DiskMove): DiskDir | null => (m.to === m.from ? null : m.to > m.from ? "up" : "down");
    if (prev && dirOf(mv) !== null && dirOf(prev) !== null && dirOf(mv) !== dirOf(prev)) {
      const upFirst = rng.next() < 0.5;
      const choices = upFirst
        ? ["toward higher cylinders", "toward lower cylinders"]
        : ["toward lower cylinders", "toward higher cylinders"];
      const answerText = dirOf(mv) === "up" ? "toward higher cylinders" : "toward lower cylinders";
      candidates.push({
        kind: "direction",
        prompt: `the head just reached ${mv.from} — which way does ${meta.short} move now?`,
        choices,
        answer: choices.indexOf(answerText),
        explain: after.note,
      });
    }

    if (candidates.length > 0) {
      const quiz = pickVaried(candidates, lastKind, rng);
      lastKind = quiz.kind ?? null;
      out.push({ step: i + 1, quiz });
    }
  });
  return out;
}

/** Classroom presets — each one exists to provoke a specific exam question. */
export const DISK_PRESETS: { name: string; hint: string; cylinders: number; head: number; dir: DiskDir; requests: number[] }[] = [
  {
    name: "Textbook queue (Silberschatz)",
    hint: "The classic 200-cylinder queue — run all six algorithms and compare the totals.",
    cylinders: 200, head: 53, dir: "up",
    requests: [98, 183, 37, 122, 14, 124, 65, 67],
  },
  {
    name: "SSTF starvation",
    hint: "A tight cluster plus one far request — watch SSTF leave 190 waiting until the very end.",
    cylinders: 200, head: 50, dir: "up",
    requests: [48, 52, 55, 47, 53, 51, 190],
  },
  {
    name: "SCAN vs LOOK",
    hint: "Nothing above 120 — SCAN still climbs to the rim while LOOK turns straight back.",
    cylinders: 200, head: 100, dir: "up",
    requests: [110, 115, 120, 30, 60, 10],
  },
  {
    name: "C-SCAN wraparound",
    hint: "Most requests sit far below a high-riding head — the return jump dominates the total.",
    cylinders: 200, head: 170, dir: "up",
    requests: [180, 190, 10, 40, 55, 25],
  },
];
