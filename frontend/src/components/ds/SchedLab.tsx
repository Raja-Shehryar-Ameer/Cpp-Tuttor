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
  Swords,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_ARRIVAL,
  MAX_BURST,
  MAX_PROCS,
  SCHED_ALGOS,
  SCHED_PRESETS,
  schedQuizzes,
  schedule,
  type ProcSpec,
  type SchedAlgo,
  type SchedRun,
} from "../../ds/sched";
import { notify } from "../../store/toastStore";
import { PredictChips, QuizPanel, usePredictScore } from "./predict";

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

/** One algorithm's full result view — Gantt, live row, metrics, stat chips.
    Extracted so race mode can stack two of them under one shared scrubber. */
function SchedResult({ run, procs, now }: { run: SchedRun; procs: ProcSpec[]; now: number }) {
  const meta = SCHED_ALGOS.find((a) => a.key === run.algo)!;
  const clamped = Math.min(now, run.makespan);
  const tickState = run.ticks[Math.min(clamped, run.ticks.length - 1)];
  const finished = clamped >= run.makespan;
  const unit = Math.max(26, Math.min(56, Math.floor(760 / Math.max(run.makespan, 1))));
  return (
    <section className="sched-results">
      <div className="sched-section-head">
        <h3>Gantt chart — {meta.short}{meta.usesQuantum ? ` (q=${run.quantum})` : ""}</h3>
        <span className="sched-hint">t = {clamped} / {run.makespan}</span>
      </div>
      <div className="gantt-wrap">
        <div className="gantt" style={{ width: run.makespan * unit + 2 }}>
          {run.slices.map((s, i) => (
            <div
              key={i}
              className={`gantt-slice ${colorOf(procs, s.name)}${s.end <= clamped ? "" : s.start < clamped ? " partial" : " future"}`}
              style={{ left: s.start * unit, width: (s.end - s.start) * unit }}
              title={`${s.name ?? "idle"}: ${s.start} → ${s.end}`}
            >
              {(s.end - s.start) * unit >= 26 && <span>{s.name ?? "—"}</span>}
            </div>
          ))}
          <div className="gantt-cursor" style={{ left: clamped * unit }} />
          <div className="gantt-ticks">
            {Array.from({ length: run.makespan + 1 }, (_, t) =>
              (unit >= 18 || t % 5 === 0 || t === run.makespan) ? (
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
            {run.metrics.map((m) => {
              const done = m.completion <= clamped;
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
              <td>{run.avgTurnaround.toFixed(2)}</td>
              <td>{run.avgWaiting.toFixed(2)}</td>
              <td>{run.avgResponse.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sched-stats">
        <span className="ds-chip">CPU utilization {(run.cpuUtilization * 100).toFixed(1)}%</span>
        <span className="ds-chip">throughput {run.throughput.toFixed(3)} proc/unit</span>
        <span className="ds-chip">context switches {run.contextSwitches}</span>
        <span className="ds-chip">idle {run.idle} unit{run.idle === 1 ? "" : "s"}</span>
        <span className="ds-chip">turnaround = completion − arrival</span>
        <span className="ds-chip">waiting = turnaround − burst</span>
        <span className="ds-chip">response = first run − arrival</span>
      </div>
    </section>
  );
}

export function SchedLab() {
  const [procs, setProcs] = useState<ProcSpec[]>(DEFAULT_PROCS);
  const [algo, setAlgo] = useState<SchedAlgo>("fcfs");
  const [quantum, setQuantum] = useState(2);
  const [run, setRun] = useState<SchedRun | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);
  // Race mode: a second algorithm on the same workload, stacked under one scrubber.
  const [race, setRace] = useState(false);
  const [algoB, setAlgoB] = useState<SchedAlgo>("sjf");
  const [runB, setRunB] = useState<SchedRun | null>(null);
  // Predict mode: pause before each dispatch decision and ask who runs next.
  const [predictOn, setPredictOn] = useState(false);
  const [quizAt, setQuizAt] = useState<number | null>(null);
  const quizDone = useRef(new Set<number>());
  const predict = usePredictScore();

  const meta = SCHED_ALGOS.find((a) => a.key === algo)!;

  const quizByTick = useMemo(
    () => new Map(run ? schedQuizzes(run).map((q) => [q.tick, q.quiz]) : []),
    [run],
  );

  const tickRef = useRef(tick);
  tickRef.current = tick;

  const gated = (target: number): boolean =>
    predictOn && quizByTick.has(target) && !quizDone.current.has(target);

  const dismissQuiz = () => {
    if (quizAt !== null) {
      quizDone.current.add(quizAt);
      setQuizAt(null);
    }
  };

  useEffect(() => {
    if (!playing || !run) return;
    const stop = Math.max(run.makespan, runB?.makespan ?? 0);
    const t = window.setInterval(() => {
      const next = tickRef.current + 1;
      if (next > stop) {
        setPlaying(false);
        return;
      }
      if (gated(next)) {
        setPlaying(false);
        setQuizAt(next);
        return;
      }
      setTick(next);
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, runB, speed, predictOn]);

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
    setRun(schedule(algo, procs, quantum));
    setRunB(race ? schedule(algoB, procs, quantum) : null);
    setTick(0);
    setPlaying(true);
    setCompare(false);
    quizDone.current = new Set();
    setQuizAt(null);
  };

  // Comparison table: the same workload pushed through every algorithm.
  const comparison = useMemo(
    () => (compare ? SCHED_ALGOS.map((a) => ({ meta: a, run: schedule(a.key, procs, quantum) })) : []),
    [compare, procs, quantum],
  );

  const shown = run;
  const span = shown ? Math.max(shown.makespan, runB?.makespan ?? 0) : 0;
  const now = shown ? Math.min(tick, span) : 0;
  const tickState = shown?.ticks[Math.min(now, shown.ticks.length - 1)];
  const finished = shown !== null && now >= span;
  const metaB = SCHED_ALGOS.find((a) => a.key === algoB)!;
  const laneState = (r: SchedRun): string =>
    now >= r.makespan ? "done" : r.ticks[Math.min(now, r.ticks.length - 1)]?.running ?? "idle";
  const note = shown
    ? runB
      ? finished
        ? `Race over: ${meta.short} avg waiting ${shown.avgWaiting.toFixed(2)} vs ${metaB.short} ${runB.avgWaiting.toFixed(2)} — ${
            shown.avgWaiting === runB.avgWaiting ? "a tie on waiting time" : `${shown.avgWaiting < runB.avgWaiting ? meta.short : metaB.short} wins on waiting time`}.`
        : `t=${now}: ${meta.short} → ${laneState(shown)} · ${metaB.short} → ${laneState(runB)}.`
      : finished
        ? `Done at t=${shown.makespan}: avg waiting ${shown.avgWaiting.toFixed(2)}, avg turnaround ${shown.avgTurnaround.toFixed(2)}, ${shown.contextSwitches} context switch${shown.contextSwitches === 1 ? "" : "es"}.`
        : tickState?.events.join(" · ") || `t=${now}: ${tickState?.running ?? "idle"} on the CPU.`
    : meta.blurb;

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
        <button
          className={race ? "toggled" : ""}
          title="run a second algorithm on the same workload, stacked under one scrubber"
          onClick={() => {
            setRace((r) => !r);
            setRun(null);
            setRunB(null);
            setPlaying(false);
            setCompare(false);
            setPredictOn(false);
          }}
        >
          <Swords size={13} /> Race
        </button>
        {race && (
          <label className="ds-mode">
            vs:
            <select value={algoB} onChange={(e) => { setAlgoB(e.target.value as SchedAlgo); setRun(null); setRunB(null); }}>
              {SCHED_ALGOS.map((a) => (
                <option key={a.key} value={a.key}>{a.short}</option>
              ))}
            </select>
          </label>
        )}
        {!race && (
          <button
            className={predictOn ? "toggled" : ""}
            title="pause before every dispatch and ask you who runs next"
            onClick={() => {
              setPredictOn((p) => !p);
              predict.reset();
              dismissQuiz();
            }}
          >
            <Target size={13} /> Predict
          </button>
        )}
        <PredictChips state={predict.state} />
        <button className={compare ? "toggled" : ""} onClick={() => { if (!compare && !validate()) return; setCompare((c) => !c); setRun(null); setRunB(null); setRace(false); setPlaying(false); }}
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
        <button onClick={() => { setProcs(DEFAULT_PROCS.map((p) => ({ ...p }))); setRun(null); setRunB(null); setCompare(false); }}>
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
          <div className={runB ? "race-stack" : undefined}>
            <SchedResult run={shown} procs={procs} now={now} />
            {runB && <SchedResult run={runB} procs={procs} now={now} />}
          </div>
        )}

        {!shown && !compare && (
          <div className="sched-empty">
            <span className="empty-icon"><Cpu size={20} aria-hidden="true" /></span>
            <p>Set up the workload, pick an algorithm, and press Schedule — or load a preset built to provoke a classic exam question.</p>
          </div>
        )}
      </div>

      {quizAt !== null && quizByTick.has(quizAt) && (
        <QuizPanel
          quiz={quizByTick.get(quizAt)!}
          onAnswer={predict.answer}
          onContinue={() => {
            quizDone.current.add(quizAt);
            setTick(quizAt);
            setQuizAt(null);
            setPlaying(true);
          }}
        />
      )}

      <div className="ds-caption">
        <span className="ds-teacher"><Cpu size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {shown && (
          <div className="transport ds-transport">
            <button onClick={() => { dismissQuiz(); setTick(0); }} disabled={now === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => { dismissQuiz(); setTick((i) => Math.max(0, i - 1)); }} disabled={now === 0} title="previous tick">
              <StepBack size={15} />
            </button>
            <button className="play-btn" onClick={() => { if (now >= span) setTick(0); setPlaying(!playing); }} title="play / pause">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              onClick={() => {
                const next = Math.min(span, now + 1);
                if (gated(next)) {
                  setPlaying(false);
                  setQuizAt(next);
                  return;
                }
                setTick(next);
              }}
              disabled={now >= span}
              title="next tick"
            >
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={span}
              value={now}
              title="scrub through time"
              onChange={(e) => { setPlaying(false); dismissQuiz(); setTick(Number(e.target.value)); }}
            />
            <button className="speed-btn" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} title="playback speed">
              <Gauge size={13} /> {SPEEDS[speed].label}
            </button>
            <span className="step-counter">t = {now} / {span}</span>
          </div>
        )}
      </div>
    </div>
  );
}
