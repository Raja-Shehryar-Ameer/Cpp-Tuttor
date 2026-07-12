import {
  ChevronFirst,
  Cpu,
  Gauge,
  Pause,
  Play,
  Plus,
  Scale,
  Shuffle,
  StepBack,
  StepForward,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MAX_ARRIVAL,
  MAX_BURST,
  MAX_PROCS,
  SCHED_ALGOS,
  SCHED_PRESETS,
  schedule,
  type ProcSpec,
  type SchedAlgo,
  type SchedRun,
} from "../../ds/sched";
import { notify } from "../../store/toastStore";

// Process colors: warm, high-contrast, no blue/purple. Index-stable so P1 is
// always the same color across Gantt, queue chips, and the metrics table.
const PROC_COLORS = 8; // .pc-0 … .pc-7 in CSS, cycled

const colorOf = (procs: ProcSpec[], name: string | null): string =>
  name === null ? "gantt-idle" : `pc-${procs.findIndex((p) => p.name === name) % PROC_COLORS}`;

const SPEEDS = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
];

const DEFAULT_PROCS: ProcSpec[] = SCHED_PRESETS[1].procs;

export function SchedLab() {
  const [procs, setProcs] = useState<ProcSpec[]>(DEFAULT_PROCS);
  const [algo, setAlgo] = useState<SchedAlgo>("fcfs");
  const [quantum, setQuantum] = useState(2);
  const [run, setRun] = useState<SchedRun | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);

  const meta = SCHED_ALGOS.find((a) => a.key === algo)!;

  useEffect(() => {
    if (!playing || !run) return;
    const t = window.setInterval(() => {
      setTick((i) => {
        if (i + 1 > run.makespan) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
  }, [playing, run, speed]);

  const editProc = (i: number, field: keyof ProcSpec, raw: string) => {
    setRun(null);
    setPlaying(false);
    setProcs((ps) =>
      ps.map((p, k) => {
        if (k !== i) return p;
        if (field === "name") return { ...p, name: raw.slice(0, 6) || `P${i + 1}` };
        const n = Math.trunc(Number(raw));
        return { ...p, [field]: Number.isFinite(n) ? Math.max(0, n) : 0 };
      }),
    );
  };

  const addProc = () => {
    if (procs.length >= MAX_PROCS) {
      notify.warning(`Up to ${MAX_PROCS} processes — beyond that the Gantt chart stops being readable.`);
      return;
    }
    setRun(null);
    setProcs((ps) => [...ps, { name: `P${ps.length + 1}`, arrival: 0, burst: 4, priority: ps.length + 1 }]);
  };

  const removeProc = (i: number) => {
    setRun(null);
    setProcs((ps) => ps.filter((_, k) => k !== i));
  };

  const randomize = () => {
    setRun(null);
    const n = 4 + Math.floor(Math.random() * 3);
    setProcs(
      Array.from({ length: n }, (_, i) => ({
        name: `P${i + 1}`,
        arrival: Math.floor(Math.random() * 9),
        burst: 1 + Math.floor(Math.random() * 10),
        priority: 1 + Math.floor(Math.random() * 5),
      })),
    );
  };

  const loadPreset = (name: string) => {
    const preset = SCHED_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    setRun(null);
    setPlaying(false);
    setProcs(preset.procs.map((p) => ({ ...p })));
    notify.info(preset.hint);
  };

  const validate = (): boolean => {
    if (procs.length === 0) {
      notify.error("Add at least one process first.");
      return false;
    }
    for (const p of procs) {
      if (p.burst < 1 || p.burst > MAX_BURST) {
        notify.error(`${p.name}: burst must be between 1 and ${MAX_BURST}.`);
        return false;
      }
      if (p.arrival > MAX_ARRIVAL) {
        notify.error(`${p.name}: arrival must be at most ${MAX_ARRIVAL}.`);
        return false;
      }
    }
    if (new Set(procs.map((p) => p.name)).size !== procs.length) {
      notify.error("Process names must be unique.");
      return false;
    }
    if (meta.usesQuantum && (quantum < 1 || quantum > 12)) {
      notify.error("Quantum must be between 1 and 12.");
      return false;
    }
    return true;
  };

  const runNow = () => {
    if (!validate()) return;
    const result = schedule(algo, procs, quantum);
    setRun(result);
    setTick(0);
    setPlaying(true);
    setCompare(false);
  };

  // Comparison table: the same workload pushed through every algorithm.
  const comparison = useMemo(
    () => (compare ? SCHED_ALGOS.map((a) => ({ meta: a, run: schedule(a.key, procs, quantum) })) : []),
    [compare, procs, quantum],
  );

  const shown = run;
  const now = shown ? Math.min(tick, shown.makespan) : 0;
  const tickState = shown?.ticks[Math.min(now, shown.ticks.length - 1)];
  const finished = shown !== null && now >= shown.makespan;
  const note = shown
    ? finished
      ? `Done at t=${shown.makespan}: avg waiting ${shown.avgWaiting.toFixed(2)}, avg turnaround ${shown.avgTurnaround.toFixed(2)}, ${shown.contextSwitches} context switch${shown.contextSwitches === 1 ? "" : "es"}.`
      : tickState?.events.join(" · ") || `t=${now}: ${tickState?.running ?? "idle"} on the CPU.`
    : meta.blurb;

  const unit = shown ? Math.max(26, Math.min(56, Math.floor(760 / Math.max(shown.makespan, 1)))) : 32;

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <label className="ds-mode">
          algorithm:
          <select value={algo} onChange={(e) => { setAlgo(e.target.value as SchedAlgo); setRun(null); setPlaying(false); }}>
            {SCHED_ALGOS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </label>
        {meta.usesQuantum && (
          <label className="ds-mode">
            q =
            <input
              className="ds-input small"
              type="number"
              min={1}
              max={12}
              value={quantum}
              onChange={(e) => { setQuantum(Math.trunc(Number(e.target.value)) || 1); setRun(null); }}
            />
          </label>
        )}
        <button className="primary" onClick={runNow}>
          <Play size={13} /> Schedule
        </button>
        <button className={compare ? "toggled" : ""} onClick={() => { if (!compare && !validate()) return; setCompare((c) => !c); setRun(null); setPlaying(false); }}
          title="run this workload through every algorithm and compare the averages">
          <Scale size={13} /> Compare all
        </button>
        <label className="ds-mode">
          preset:
          <select value="" onChange={(e) => loadPreset(e.target.value)}>
            <option value="" disabled>pick a classic…</option>
            {SCHED_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button onClick={randomize}><Shuffle size={13} /> Random</button>
        <button onClick={() => { setProcs(DEFAULT_PROCS.map((p) => ({ ...p }))); setRun(null); setCompare(false); }}>
          <X size={13} /> Reset
        </button>
      </div>

      <div className="sched-body">
        <section className="sched-procs">
          <div className="sched-section-head">
            <h3>Processes</h3>
            <span className="sched-hint">lower priority number = higher priority</span>
          </div>
          <table className="sched-table">
            <thead>
              <tr>
                <th>process</th><th>arrival</th><th>burst</th><th>priority</th><th aria-label="remove" />
              </tr>
            </thead>
            <tbody>
              {procs.map((p, i) => (
                <tr key={i}>
                  <td><span className={`proc-chip ${colorOf(procs, p.name)}`}>{p.name}</span></td>
                  <td><input className="ds-input cell" type="number" min={0} max={MAX_ARRIVAL} value={p.arrival} onChange={(e) => editProc(i, "arrival", e.target.value)} /></td>
                  <td><input className="ds-input cell" type="number" min={1} max={MAX_BURST} value={p.burst} onChange={(e) => editProc(i, "burst", e.target.value)} /></td>
                  <td><input className="ds-input cell" type="number" min={1} max={99} value={p.priority} onChange={(e) => editProc(i, "priority", e.target.value)} disabled={!meta.usesPriority && !compare} /></td>
                  <td>
                    <button className="icon-btn ghost" onClick={() => removeProc(i)} title={`remove ${p.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addProc}><Plus size={13} /> Add process</button>
        </section>

        {compare && comparison.length > 0 && (
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>Every algorithm, same workload</h3>
              <span className="sched-hint">RR uses q={quantum} — lowest average waiting time is marked</span>
            </div>
            <div className="sched-table-wrap">
              <table className="sched-table metrics">
                <thead>
                  <tr><th>algorithm</th><th>avg waiting</th><th>avg turnaround</th><th>avg response</th><th>ctx switches</th><th>finishes at</th></tr>
                </thead>
                <tbody>
                  {(() => {
                    const best = Math.min(...comparison.map((c) => c.run.avgWaiting));
                    return comparison.map(({ meta: m, run: r }) => (
                      <tr key={m.key} className={r.avgWaiting === best ? "best-row" : ""}>
                        <td>{m.short}{m.key === "rr" ? ` (q=${quantum})` : ""}</td>
                        <td>{r.avgWaiting.toFixed(2)}</td>
                        <td>{r.avgTurnaround.toFixed(2)}</td>
                        <td>{r.avgResponse.toFixed(2)}</td>
                        <td>{r.contextSwitches}</td>
                        <td>t={r.makespan}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            <p className="sched-hint">Pick an algorithm above and press Schedule to watch its Gantt chart tick by tick.</p>
          </section>
        )}

        {shown && (
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>Gantt chart — {meta.short}{meta.usesQuantum ? ` (q=${shown.quantum})` : ""}</h3>
              <span className="sched-hint">t = {now} / {shown.makespan}</span>
            </div>
            <div className="gantt-wrap">
              <div className="gantt" style={{ width: shown.makespan * unit + 2 }}>
                {shown.slices.map((s, i) => (
                  <div
                    key={i}
                    className={`gantt-slice ${colorOf(procs, s.name)}${s.end <= now ? "" : s.start < now ? " partial" : " future"}`}
                    style={{ left: s.start * unit, width: (s.end - s.start) * unit }}
                    title={`${s.name ?? "idle"}: ${s.start} → ${s.end}`}
                  >
                    {(s.end - s.start) * unit >= 26 && <span>{s.name ?? "—"}</span>}
                  </div>
                ))}
                <div className="gantt-cursor" style={{ left: now * unit }} />
                <div className="gantt-ticks">
                  {Array.from({ length: shown.makespan + 1 }, (_, t) =>
                    (unit >= 18 || t % 5 === 0 || t === shown.makespan) ? (
                      <span key={t} style={{ left: t * unit }}>{t}</span>
                    ) : null,
                  )}
                </div>
              </div>
            </div>

            <div className="sched-live">
              <span className="sched-live-label">CPU</span>
              {tickState?.running && !finished ? (
                <span className={`proc-chip ${colorOf(procs, tickState.running)}`}>{tickState.running}</span>
              ) : (
                <span className="proc-chip gantt-idle">{finished ? "done" : "idle"}</span>
              )}
              <span className="sched-live-label">ready queue</span>
              {tickState && tickState.ready.length > 0 && !finished ? (
                tickState.ready.map((name) => (
                  <span key={name} className={`proc-chip ${colorOf(procs, name)}`}>{name}</span>
                ))
              ) : (
                <span className="sched-hint">{finished ? "everyone finished" : "empty"}</span>
              )}
            </div>

            <div className="sched-table-wrap">
              <table className="sched-table metrics">
                <thead>
                  <tr>
                    <th>process</th><th>arrival</th><th>burst</th>{meta.usesPriority && <th>priority</th>}
                    <th>completion</th><th>turnaround</th><th>waiting</th><th>response</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.metrics.map((m) => {
                    const done = m.completion <= now;
                    return (
                      <tr key={m.name} className={done ? "" : "pending-row"}>
                        <td><span className={`proc-chip ${colorOf(procs, m.name)}`}>{m.name}</span></td>
                        <td>{m.arrival}</td>
                        <td>{m.burst}</td>
                        {meta.usesPriority && <td>{m.priority}</td>}
                        <td>{done ? m.completion : "…"}</td>
                        <td>{done ? m.turnaround : "…"}</td>
                        <td>{done ? m.waiting : "…"}</td>
                        <td>{done ? m.response : "…"}</td>
                      </tr>
                    );
                  })}
                  <tr className="avg-row">
                    <td colSpan={meta.usesPriority ? 5 : 4}>averages</td>
                    <td>{shown.avgTurnaround.toFixed(2)}</td>
                    <td>{shown.avgWaiting.toFixed(2)}</td>
                    <td>{shown.avgResponse.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="sched-stats">
              <span className="ds-chip">CPU utilization {(shown.cpuUtilization * 100).toFixed(1)}%</span>
              <span className="ds-chip">throughput {shown.throughput.toFixed(3)} proc/unit</span>
              <span className="ds-chip">context switches {shown.contextSwitches}</span>
              <span className="ds-chip">idle {shown.idle} unit{shown.idle === 1 ? "" : "s"}</span>
              <span className="ds-chip">turnaround = completion − arrival</span>
              <span className="ds-chip">waiting = turnaround − burst</span>
              <span className="ds-chip">response = first run − arrival</span>
            </div>
          </section>
        )}

        {!shown && !compare && (
          <div className="sched-empty">
            <span className="empty-icon"><Cpu size={20} aria-hidden="true" /></span>
            <p>Set up the workload, pick an algorithm, and press Schedule — or load a preset built to provoke a classic exam question.</p>
          </div>
        )}
      </div>

      <div className="ds-caption">
        <span className="ds-teacher"><Cpu size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {shown && (
          <div className="transport ds-transport">
            <button onClick={() => setTick(0)} disabled={now === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => setTick((i) => Math.max(0, i - 1))} disabled={now === 0} title="previous tick">
              <StepBack size={15} />
            </button>
            <button className="play-btn" onClick={() => { if (now >= shown.makespan) setTick(0); setPlaying(!playing); }} title="play / pause">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={() => setTick((i) => Math.min(shown.makespan, i + 1))} disabled={now >= shown.makespan} title="next tick">
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={shown.makespan}
              value={now}
              title="scrub through time"
              onChange={(e) => { setPlaying(false); setTick(Number(e.target.value)); }}
            />
            <button className="speed-btn" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} title="playback speed">
              <Gauge size={13} /> {SPEEDS[speed].label}
            </button>
            <span className="step-counter">t = {now} / {shown.makespan}</span>
          </div>
        )}
      </div>
    </div>
  );
}
