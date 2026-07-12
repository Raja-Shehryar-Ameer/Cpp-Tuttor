import { Workflow, X } from "lucide-react";
import { useState } from "react";

// Thread-model lab: the three textbook mappings between user threads and
// kernel threads, with the one interaction every exam asks about — what
// happens to the OTHER threads when one blocks in a system call.

type Model = "m1" | "one2one" | "m2m";

const N_THREADS = 4;
const CORES = 2;

const MODELS: { key: Model; label: string; kernel: number; blurb: string; chips: string[] }[] = [
  {
    key: "m1", label: "Many-to-One (user-level threads)", kernel: 1,
    blurb: "All user threads multiplex onto ONE kernel thread. The kernel sees a single-threaded process — thread switching is a cheap library call, but one blocking syscall freezes every thread, and only one core is ever used.",
    chips: ["switch: user-space, very cheap", "blocking syscall: stalls ALL threads", "multicore: no — one kernel thread", "example: classic green threads"],
  },
  {
    key: "one2one", label: "One-to-One (kernel-level threads)", kernel: N_THREADS,
    blurb: "Every user thread gets its own kernel thread. The kernel schedules each one independently — true parallelism across cores, and a blocked thread blocks only itself. Cost: every create/switch is a kernel operation.",
    chips: ["switch: kernel-mode, heavier", "blocking syscall: blocks only that thread", "multicore: yes — real parallelism", "example: Linux pthreads, Windows threads"],
  },
  {
    key: "m2m", label: "Many-to-Many (hybrid)", kernel: 2,
    blurb: "Many user threads multiplex onto a smaller pool of kernel threads. A blocked thread takes one kernel thread down with it; the runtime remaps the rest onto the survivors. Flexible, but the scheduler logic is the hardest to build.",
    chips: ["switch: mostly user-space", "blocking syscall: costs one kernel thread", "multicore: yes — up to pool size", "example: Solaris LWPs, Go's M:N runtime"],
  },
];

interface Mapped {
  /** kernel slot each user thread feeds into, or null when it has nowhere to run */
  kernelOf: (number | null)[];
  kernelBlocked: boolean[];
  runningThreads: Set<number>;
  stalled: boolean; // whole process wedged (m1 with a blocked thread)
}

function mapThreads(model: Model, blocked: Set<number>): Mapped {
  const kernelCount = MODELS.find((m) => m.key === model)!.kernel;
  const kernelOf: (number | null)[] = Array(N_THREADS).fill(null);
  const kernelBlocked: boolean[] = Array(kernelCount).fill(false);
  const runningThreads = new Set<number>();

  if (model === "m1") {
    for (let i = 0; i < N_THREADS; i++) kernelOf[i] = 0;
    const stalled = blocked.size > 0;
    kernelBlocked[0] = stalled;
    if (!stalled) {
      const first = kernelOf.findIndex((_, i) => !blocked.has(i));
      if (first >= 0) runningThreads.add(first); // user-level scheduler picks one
    }
    return { kernelOf, kernelBlocked, runningThreads, stalled };
  }

  if (model === "one2one") {
    let coresLeft = CORES;
    for (let i = 0; i < N_THREADS; i++) {
      kernelOf[i] = i;
      kernelBlocked[i] = blocked.has(i);
      if (!blocked.has(i) && coresLeft > 0) {
        runningThreads.add(i);
        coresLeft -= 1;
      }
    }
    return { kernelOf, kernelBlocked, runningThreads, stalled: false };
  }

  // m2m: each blocked thread pins one kernel thread; the rest share survivors.
  let nextKernel = 0;
  for (let i = 0; i < N_THREADS && nextKernel < kernelCount; i++) {
    if (blocked.has(i)) {
      kernelOf[i] = nextKernel;
      kernelBlocked[nextKernel] = true;
      nextKernel += 1;
    }
  }
  const free: number[] = [];
  for (let k = 0; k < kernelCount; k++) if (!kernelBlocked[k]) free.push(k);
  let turn = 0;
  for (let i = 0; i < N_THREADS; i++) {
    if (blocked.has(i)) continue;
    if (free.length === 0) { kernelOf[i] = null; continue; } // pool exhausted
    kernelOf[i] = free[turn % free.length];
    if (turn < Math.min(free.length, CORES)) runningThreads.add(i);
    turn += 1;
  }
  return { kernelOf, kernelBlocked, runningThreads, stalled: free.length === 0 && blocked.size < N_THREADS };
}

const W = 660;
const T_Y = 92;
const K_Y = 218;
const CORE_Y = 316;

export function ThreadsLab() {
  const [model, setModel] = useState<Model>("m1");
  const [blocked, setBlocked] = useState<Set<number>>(new Set());

  const info = MODELS.find((m) => m.key === model)!;
  const mapped = mapThreads(model, blocked);

  const toggle = (i: number) =>
    setBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const switchModel = (m: Model) => {
    setModel(m);
    setBlocked(new Set());
  };

  const tx = (i: number) => W / 2 + (i - (N_THREADS - 1) / 2) * 120;
  const kx = (k: number) => W / 2 + (k - (info.kernel - 1) / 2) * (info.kernel > 2 ? 120 : 160);
  const cx = (c: number) => W / 2 + (c - (CORES - 1) / 2) * 160;

  const threadClass = (i: number): string => {
    if (blocked.has(i)) return "th-blocked";
    if (mapped.stalled) return "th-stalled";
    if (mapped.runningThreads.has(i)) return "th-running";
    return "";
  };

  const note = blocked.size === 0
    ? "Click a user thread to block it in a system call (e.g. a read() that waits on a disk) and watch what the model does to its siblings."
    : model === "m1"
      ? `T${[...blocked][0]! + 1} blocked in the kernel — and the kernel only knows about ONE thread, so the whole process stalls. Every other thread is innocent and stuck.`
      : model === "one2one"
        ? `${[...blocked].map((i) => `T${i + 1}`).join(", ")} blocked — the other kernel threads keep getting scheduled. Up to ${CORES} run truly in parallel on the cores.`
        : mapped.stalled
          ? "Every kernel thread in the pool is pinned by a blocked user thread — the survivors have nowhere to run. This is why pool sizing matters."
          : `${[...blocked].map((i) => `T${i + 1}`).join(", ")} pinned ${blocked.size} kernel thread${blocked.size === 1 ? "" : "s"}; the runtime remapped the rest onto the surviving pool.`;

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <label className="ds-mode">
          model:
          <select value={model} onChange={(e) => switchModel(e.target.value as Model)}>
            {MODELS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setBlocked(new Set())} disabled={blocked.size === 0}>
          <X size={13} /> Unblock all
        </button>
        <div className="sched-stats threads-chips">
          {info.chips.map((c) => (
            <span key={c} className="ds-chip">{c}</span>
          ))}
        </div>
      </div>

      <div className="sched-body">
        <div className="threads-stage">
          <svg className="ds-svg threads-svg" viewBox={`0 0 ${W} 370`} role="img" aria-label="thread mapping diagram">
            {/* bands */}
            <rect className="th-band user" x={16} y={30} width={W - 32} height={112} rx={10} />
            <text className="th-band-label" x={30} y={52}>USER SPACE — process</text>
            <rect className="th-band kernel" x={16} y={170} width={W - 32} height={96} rx={10} />
            <text className="th-band-label" x={30} y={192}>KERNEL SPACE</text>

            {/* mapping edges */}
            {Array.from({ length: N_THREADS }, (_, i) => {
              const k = mapped.kernelOf[i];
              if (k === null) return null;
              return (
                <line
                  key={`e${i}`}
                  className={`th-edge${blocked.has(i) ? " bad" : mapped.runningThreads.has(i) ? " hot" : ""}`}
                  x1={tx(i)} y1={T_Y + 24} x2={kx(k)} y2={K_Y - 20}
                />
              );
            })}
            {/* kernel → core edges: a kernel thread reaches a core when one of its user threads runs */}
            {Array.from({ length: info.kernel }, (_, k) => {
              const runningVia = Array.from(mapped.runningThreads).filter((i) => mapped.kernelOf[i] === k);
              if (runningVia.length === 0) return null;
              const core = k % CORES;
              return <line key={`c${k}`} className="th-edge hot" x1={kx(k)} y1={K_Y + 20} x2={cx(core)} y2={CORE_Y - 16} />;
            })}

            {/* user threads */}
            {Array.from({ length: N_THREADS }, (_, i) => (
              <g key={`t${i}`} className={`th-thread ${threadClass(i)}`} transform={`translate(${tx(i)}, ${T_Y})`}
                onClick={() => toggle(i)} role="button" aria-label={`toggle block on thread T${i + 1}`}>
                <circle r={24} />
                <text dy="4">T{i + 1}</text>
                {blocked.has(i) && <text className="th-state" dy="40">blocked</text>}
                {!blocked.has(i) && mapped.runningThreads.has(i) && <text className="th-state ok" dy="40">running</text>}
              </g>
            ))}

            {/* kernel threads */}
            {Array.from({ length: info.kernel }, (_, k) => (
              <g key={`k${k}`} className={`th-kernel${mapped.kernelBlocked[k] ? " blocked" : ""}`} transform={`translate(${kx(k)}, ${K_Y})`}>
                <rect x={-26} y={-18} width={52} height={36} rx={6} />
                <text dy="4">K{k + 1}</text>
              </g>
            ))}

            {/* cores */}
            {Array.from({ length: CORES }, (_, c) => (
              <g key={`core${c}`} className="th-core" transform={`translate(${cx(c)}, ${CORE_Y})`}>
                <rect x={-44} y={-16} width={88} height={32} rx={6} />
                <text dy="4">Core {c}</text>
              </g>
            ))}
          </svg>
        </div>

        <section className="sched-results">
          <div className="sched-section-head">
            <h3>User-level vs kernel-level threads</h3>
            <span className="sched-hint">the comparison table exams love</span>
          </div>
          <div className="sched-table-wrap">
            <table className="sched-table metrics">
              <thead>
                <tr><th /><th>user-level (many-to-one)</th><th>kernel-level (one-to-one)</th></tr>
              </thead>
              <tbody>
                <tr><td>managed by</td><td>thread library in the process</td><td>the operating system</td></tr>
                <tr><td>create / switch cost</td><td>cheap — no mode switch</td><td>expensive — kernel involved</td></tr>
                <tr><td>one thread blocks</td><td>whole process blocks</td><td>only that thread blocks</td></tr>
                <tr><td>multicore parallelism</td><td>none — one kernel thread</td><td>yes — one core per thread</td></tr>
                <tr><td>kernel visibility</td><td>sees a single thread</td><td>sees every thread</td></tr>
                <tr><td>typical examples</td><td>green threads, early Java</td><td>Linux pthreads, Windows</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="ds-caption">
        <span className="ds-teacher"><Workflow size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
      </div>
    </div>
  );
}
