// CPU scheduling engine: a unit-tick simulation shared by every algorithm so
// Gantt slices, ready-queue snapshots, and metrics always agree. Pure logic —
// the lab component owns all rendering.
//
// Conventions (stated in the UI too):
//  - Lower priority number = higher priority (classic textbook convention).
//  - Ties break by arrival time, then by input order.
//  - A preempted process re-enters the ready queue BEHIND processes that
//    arrived at that same tick (the common exam convention for RR).

export interface ProcSpec {
  name: string;
  arrival: number;
  burst: number;
  priority: number;
}

export type SchedAlgo =
  | "fcfs"
  | "sjf"
  | "srtf"
  | "ljf"
  | "lrtf"
  | "hrrn"
  | "prio"
  | "priop"
  | "rr";

export interface AlgoMeta {
  key: SchedAlgo;
  label: string;
  short: string;
  preemptive: boolean;
  usesPriority: boolean;
  usesQuantum: boolean;
  blurb: string;
}

export const SCHED_ALGOS: AlgoMeta[] = [
  { key: "fcfs", label: "FCFS (First Come First Served)", short: "FCFS", preemptive: false, usesPriority: false, usesQuantum: false,
    blurb: "Runs jobs strictly in arrival order. Simple, fair by arrival — but a long early job makes everyone wait (convoy effect)." },
  { key: "sjf", label: "SJF (Shortest Job First, non-preemptive)", short: "SJF", preemptive: false, usesPriority: false, usesQuantum: false,
    blurb: "Picks the shortest burst among arrived jobs, then runs it to completion. Provably minimal average waiting time — if bursts are known." },
  { key: "srtf", label: "SRTF (Shortest Remaining Time First, preemptive SJF)", short: "SRTF", preemptive: true, usesPriority: false, usesQuantum: false,
    blurb: "Preemptive SJF: a new arrival with less remaining work kicks the running job off the CPU." },
  { key: "ljf", label: "LJF (Longest Job First, non-preemptive)", short: "LJF", preemptive: false, usesPriority: false, usesQuantum: false,
    blurb: "The contrarian: longest burst first. Mostly an exam exercise — watch the average waiting time explode." },
  { key: "lrtf", label: "LRTF (Longest Remaining Time First, preemptive)", short: "LRTF", preemptive: true, usesPriority: false, usesQuantum: false,
    blurb: "Preemptive LJF: always runs whichever job has the MOST work left, so everyone finishes late together." },
  { key: "hrrn", label: "HRRN (Highest Response Ratio Next)", short: "HRRN", preemptive: false, usesPriority: false, usesQuantum: false,
    blurb: "Picks the job with the highest (wait + burst) / burst. SJF's fairness patch — long jobs age their way to the front, so nobody starves." },
  { key: "prio", label: "Priority (non-preemptive)", short: "Priority", preemptive: false, usesPriority: true, usesQuantum: false,
    blurb: "Highest priority among arrived jobs runs to completion. Lower number = higher priority. Low-priority jobs can starve." },
  { key: "priop", label: "Priority (preemptive)", short: "Priority-P", preemptive: true, usesPriority: true, usesQuantum: false,
    blurb: "A higher-priority arrival preempts the running job immediately. Lower number = higher priority." },
  { key: "rr", label: "Round Robin (quantum q)", short: "RR", preemptive: true, usesPriority: false, usesQuantum: true,
    blurb: "Everyone gets the CPU for at most q ticks, then goes to the back of the queue. Fair response time; smaller q = more context switches." },
];

export interface GanttSlice {
  name: string | null; // null = CPU idle
  start: number;
  end: number;
}

export interface ProcMetrics extends ProcSpec {
  completion: number;
  turnaround: number; // completion - arrival
  waiting: number; // turnaround - burst
  response: number; // first run - arrival
}

export interface TickState {
  t: number;
  running: string | null;
  /** ready-queue snapshot AFTER the dispatch decision at time t (running excluded) */
  ready: string[];
  /** human notes for events that happened at time t (arrivals, dispatches, preemptions, completions) */
  events: string[];
}

export interface SchedRun {
  algo: SchedAlgo;
  quantum: number;
  slices: GanttSlice[];
  ticks: TickState[];
  metrics: ProcMetrics[];
  avgTurnaround: number;
  avgWaiting: number;
  avgResponse: number;
  contextSwitches: number;
  idle: number;
  makespan: number;
  cpuUtilization: number; // 0..1
  throughput: number; // processes per time unit
}

export const MAX_PROCS = 10;
export const MAX_ARRIVAL = 50;
export const MAX_BURST = 50;

interface Live extends ProcSpec {
  index: number; // input order, the last tie-breaker
  remaining: number;
  firstRun: number | null;
  completion: number | null;
}

/** Why this job won the CPU — one clause, in the algorithm's own vocabulary. */
function reasonFor(algo: SchedAlgo, p: Live, t: number): string {
  switch (algo) {
    case "fcfs": return `arrived earliest (t=${p.arrival})`;
    case "sjf": return `shortest burst (${p.burst})`;
    case "srtf": return `least remaining work (${p.remaining})`;
    case "ljf": return `longest burst (${p.burst})`;
    case "lrtf": return `most remaining work (${p.remaining})`;
    case "hrrn": {
      const ratio = (t - p.arrival + p.burst) / p.burst;
      return `highest response ratio (${ratio.toFixed(2)})`;
    }
    case "prio": case "priop": return `highest priority (${p.priority})`;
    case "rr": return "next in the queue";
  }
}

export function schedule(algo: SchedAlgo, specs: ProcSpec[], quantum = 2): SchedRun {
  const procs: Live[] = specs.map((s, index) => ({
    ...s, index, remaining: s.burst, firstRun: null, completion: null,
  }));

  const byArrival = [...procs].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const rrQueue: Live[] = []; // RR only: explicit FIFO
  let arrivedUpTo = 0; // cursor into byArrival

  const ticks: TickState[] = [];
  let running: Live | null = null;
  let quantumLeft = 0;
  let lastDispatched: string | null = null;
  let contextSwitches = 0;
  let idle = 0;
  let t = 0;

  const preemptive = algo === "srtf" || algo === "lrtf" || algo === "priop";

  const better = (a: Live, b: Live): boolean => {
    // true when a should run instead of b
    const tie = a.arrival !== b.arrival ? a.arrival - b.arrival : a.index - b.index;
    switch (algo) {
      case "fcfs": return tie < 0;
      case "sjf": return a.burst !== b.burst ? a.burst < b.burst : tie < 0;
      case "srtf": return a.remaining !== b.remaining ? a.remaining < b.remaining : tie < 0;
      case "ljf": return a.burst !== b.burst ? a.burst > b.burst : tie < 0;
      case "lrtf": return a.remaining !== b.remaining ? a.remaining > b.remaining : tie < 0;
      case "hrrn": {
        const ra = (t - a.arrival + a.burst) / a.burst;
        const rb = (t - b.arrival + b.burst) / b.burst;
        return ra !== rb ? ra > rb : tie < 0;
      }
      case "prio": case "priop":
        return a.priority !== b.priority ? a.priority < b.priority : tie < 0;
      case "rr": return tie < 0; // unused — RR picks from its queue
    }
  };

  const readyPool = (): Live[] =>
    procs.filter((p) => p.arrival <= t && p.remaining > 0 && p !== running);

  const pickBest = (pool: Live[]): Live | null => {
    let best: Live | null = null;
    for (const p of pool) if (best === null || better(p, best)) best = p;
    return best;
  };

  const total = procs.length;
  let done = 0;
  const guard = procs.reduce((s, p) => s + p.burst, 0) + Math.max(...procs.map((p) => p.arrival), 0) + 4;

  while (done < total && t <= guard) {
    const events: string[] = [];

    // 1. arrivals at time t (input order for ties)
    while (arrivedUpTo < byArrival.length && byArrival[arrivedUpTo].arrival <= t) {
      const p = byArrival[arrivedUpTo++];
      if (p.arrival === t) events.push(`${p.name} arrives (burst ${p.burst}${algo === "prio" || algo === "priop" ? `, priority ${p.priority}` : ""})`);
      if (algo === "rr") rrQueue.push(p);
    }

    // 2. quantum expiry (RR): requeue behind this tick's arrivals
    if (algo === "rr" && running && quantumLeft === 0) {
      events.push(`${running.name}'s quantum expired — back of the queue`);
      rrQueue.push(running);
      running = null;
    }

    // 3. preemption check
    if (preemptive && running) {
      const challenger = pickBest(readyPool());
      if (challenger && better(challenger, running)) {
        events.push(`${challenger.name} preempts ${running.name} — ${reasonFor(algo, challenger, t)}`);
        running = null; // challenger is picked up in step 4
      }
    }

    // 4. dispatch
    if (!running) {
      if (algo === "rr") {
        running = rrQueue.shift() ?? null;
        if (running) quantumLeft = quantum;
      } else {
        running = pickBest(readyPool());
      }
      if (running) {
        if (running.name !== lastDispatched && lastDispatched !== null) contextSwitches += 1;
        lastDispatched = running.name;
        if (running.firstRun === null) running.firstRun = t;
        if (!events.some((e) => e.includes("preempts"))) {
          events.push(`${running.name} gets the CPU — ${reasonFor(algo, running, t)}`);
        }
      }
    }

    // 5. snapshot, then run one tick
    const readyNames = algo === "rr"
      ? rrQueue.map((p) => p.name)
      : readyPool().sort((a, b) => (better(a, b) ? -1 : 1)).map((p) => p.name);
    ticks.push({ t, running: running?.name ?? null, ready: readyNames, events });

    if (running) {
      running.remaining -= 1;
      quantumLeft -= 1;
      if (running.remaining === 0) {
        running.completion = t + 1;
        done += 1;
        events.push(`${running.name} finishes at t=${t + 1}`);
        running = null;
      }
    } else {
      idle += 1;
      if (events.length === 0) events.push("CPU idle — nothing has arrived yet");
    }
    t += 1;
  }

  // merge per-tick runs into Gantt slices
  const slices: GanttSlice[] = [];
  for (const tick of ticks) {
    const prev = slices[slices.length - 1];
    if (prev && prev.name === tick.running) prev.end = tick.t + 1;
    else slices.push({ name: tick.running, start: tick.t, end: tick.t + 1 });
  }

  const metrics: ProcMetrics[] = procs.map((p) => {
    const completion = p.completion ?? t;
    return {
      name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority,
      completion,
      turnaround: completion - p.arrival,
      waiting: completion - p.arrival - p.burst,
      response: (p.firstRun ?? completion) - p.arrival,
    };
  });

  const n = metrics.length || 1;
  const makespan = t;
  return {
    algo, quantum, slices, ticks, metrics,
    avgTurnaround: metrics.reduce((s, m) => s + m.turnaround, 0) / n,
    avgWaiting: metrics.reduce((s, m) => s + m.waiting, 0) / n,
    avgResponse: metrics.reduce((s, m) => s + m.response, 0) / n,
    contextSwitches, idle, makespan,
    cpuUtilization: makespan > 0 ? (makespan - idle) / makespan : 0,
    throughput: makespan > 0 ? metrics.length / makespan : 0,
  };
}

/** Classroom presets — each one exists to provoke a specific exam question. */
export const SCHED_PRESETS: { name: string; hint: string; procs: ProcSpec[] }[] = [
  {
    name: "Convoy effect",
    hint: "One long job arrives first — compare FCFS against SJF/SRTF.",
    procs: [
      { name: "P1", arrival: 0, burst: 24, priority: 3 },
      { name: "P2", arrival: 1, burst: 3, priority: 1 },
      { name: "P3", arrival: 2, burst: 3, priority: 2 },
    ],
  },
  {
    name: "Preemption showcase",
    hint: "Short jobs land mid-run — SRTF and Priority-P interrupt, SJF and Priority don't.",
    procs: [
      { name: "P1", arrival: 0, burst: 8, priority: 3 },
      { name: "P2", arrival: 1, burst: 4, priority: 1 },
      { name: "P3", arrival: 2, burst: 9, priority: 4 },
      { name: "P4", arrival: 3, burst: 5, priority: 2 },
    ],
  },
  {
    name: "Idle gap",
    hint: "Nothing arrives at t=0 and there's a hole in the middle — watch the idle slices.",
    procs: [
      { name: "P1", arrival: 2, burst: 4, priority: 2 },
      { name: "P2", arrival: 10, burst: 3, priority: 1 },
      { name: "P3", arrival: 11, burst: 2, priority: 3 },
    ],
  },
  {
    name: "Starvation setup",
    hint: "A low-priority job vs a stream of high-priority ones — then try HRRN to see aging fix it.",
    procs: [
      { name: "P1", arrival: 0, burst: 10, priority: 5 },
      { name: "P2", arrival: 1, burst: 4, priority: 1 },
      { name: "P3", arrival: 3, burst: 4, priority: 1 },
      { name: "P4", arrival: 5, burst: 4, priority: 2 },
    ],
  },
  {
    name: "RR quantum drill",
    hint: "Same set at q=1, 2, 4 — count context switches and compare response times.",
    procs: [
      { name: "P1", arrival: 0, burst: 5, priority: 2 },
      { name: "P2", arrival: 0, burst: 4, priority: 1 },
      { name: "P3", arrival: 0, burst: 2, priority: 3 },
      { name: "P4", arrival: 0, burst: 1, priority: 4 },
    ],
  },
];
