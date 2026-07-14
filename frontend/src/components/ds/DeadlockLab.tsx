// Deadlock lab: Banker's safety check and deadlock detection over
// multi-instance resources. Left panel edits the matrices; the stage narrates
// the scan step by step (Work growing, Finish flags flipping, the safe
// sequence building) next to a live resource-allocation graph that lights up
// the deadlock cycle when the verdict is bad.

import {
  ChevronFirst,
  Download,
  Link2,
  Lock,
  Minus,
  Pause,
  Play,
  Plus,
  Shuffle,
  StepBack,
  StepForward,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEADLOCK_MODES,
  DEADLOCK_PRESETS,
  deadlockQuizzes,
  findRagCycle,
  MAX_DL_PROCS,
  MAX_RES,
  MAX_UNITS,
  procName,
  RES_NAMES,
  runDeadlock,
  type DeadlockSpec,
  type DLMode,
  type DLRun,
} from "../../ds/deadlock";
import { writeLabParam } from "../../ds/permalink";
import { drawBankerPng, exportSvgsPng } from "../../utils/exportPng";
import { notify } from "../../store/toastStore";
import { PredictChips, QuizPanel, usePredictScore } from "./predict";
import { LAB_SPEEDS, SpeedSelect } from "./SpeedSelect";

const procChip = (i: number): string => `proc-chip pc-${i % 8}`;

const DEFAULT = DEADLOCK_PRESETS[0].spec;

const cloneMat = (m: number[][]): number[][] => m.map((r) => [...r]);

// ---------- resource-allocation graph ----------

/** Static-topology SVG: processes on top, resources (with instance dots)
    below. Only classes change per step — finished processes fade, and the
    detected cycle gets a bold static highlight at the verdict. */
function RagScene({
  run,
  step,
  svgRef,
}: {
  run: DLRun;
  step: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const spec = run.spec;
  const n = spec.alloc.length;
  const m = spec.available.length;
  const W = 560;
  const H = 250;
  const px = (i: number): number => ((i + 0.5) / n) * W;
  const rx = (j: number): number => ((j + 0.5) / m) * W;
  const PY = 42;
  const RY = H - 60;
  const st = run.steps[step];
  const atVerdict = st.kind === "verdict";
  const cycle = useMemo(() => (run.stuck.length > 0 ? findRagCycle(run) : null), [run]);
  const cycleEdges = new Set(atVerdict && cycle ? cycle.edges : []);
  const cycleNodes = new Set(atVerdict && cycle ? cycle.nodes : []);

  const total = (j: number): number => spec.available[j] + spec.alloc.reduce((s, row) => s + row[j], 0);
  const allocated = (j: number): number => spec.alloc.reduce((s, row) => s + row[j], 0);

  // an edge fades once its process has finished at the current step
  const doneCls = (i: number): string => (st.finish[i] ? " rag-done" : "");

  return (
    <svg ref={svgRef} className="ds-svg rag-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="resource-allocation graph">
      <defs>
        <marker id="rag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" className="rag-arrowhead" />
        </marker>
      </defs>
      {/* request/claim edges: P → R (dashed) */}
      {spec.alloc.map((_, i) =>
        run.need[i].map((k, j) =>
          k > 0 ? (
            <g key={`q${i}-${j}`} className={`rag-edge rag-req${doneCls(i)}${cycleEdges.has(`p${i}>r${j}`) ? " rag-cycle" : ""}`}>
              <line x1={px(i)} y1={PY + 20} x2={rx(j)} y2={RY - 4} markerEnd="url(#rag-arrow)" />
              {k > 1 && <text x={(px(i) + rx(j)) / 2 - 8} y={(PY + RY) / 2} className="rag-mult">×{k}</text>}
            </g>
          ) : null,
        ),
      )}
      {/* assignment edges: R → P (solid) */}
      {spec.alloc.map((row, i) =>
        row.map((k, j) =>
          k > 0 ? (
            <g key={`a${i}-${j}`} className={`rag-edge rag-assign${doneCls(i)}${cycleEdges.has(`r${j}>p${i}`) ? " rag-cycle" : ""}`}>
              <line x1={rx(j)} y1={RY - 4} x2={px(i)} y2={PY + 20} markerEnd="url(#rag-arrow)" />
              {k > 1 && <text x={(px(i) + rx(j)) / 2 + 8} y={(PY + RY) / 2 + 12} className="rag-mult">×{k}</text>}
            </g>
          ) : null,
        ),
      )}
      {/* processes */}
      {spec.alloc.map((_, i) => (
        <g
          key={`p${i}`}
          className={`rag-proc${st.finish[i] ? " rag-finished" : ""}${st.proc === i && (st.kind === "check" || st.kind === "finish") ? " rag-active" : ""}${cycleNodes.has(`p${i}`) ? " rag-cycle-node" : ""}`}
        >
          <circle cx={px(i)} cy={PY} r={19} />
          <text x={px(i)} y={PY + 4} textAnchor="middle" className="rag-label">{procName(i)}</text>
          {st.finish[i] && <text x={px(i) + 22} y={PY - 12} className="rag-check">✓</text>}
        </g>
      ))}
      {/* resources with instance dots */}
      {spec.available.map((_, j) => {
        const tot = total(j);
        const usedCount = allocated(j);
        const cols = Math.min(tot, 5);
        const rows = Math.max(1, Math.ceil(tot / 5));
        const bw = Math.max(44, cols * 12 + 14);
        const bh = rows * 12 + 22;
        return (
          <g key={`r${j}`} className={`rag-res${cycleNodes.has(`r${j}`) ? " rag-cycle-node" : ""}`}>
            <rect x={rx(j) - bw / 2} y={RY} width={bw} height={bh} rx={4} />
            <text x={rx(j)} y={RY + bh + 15} textAnchor="middle" className="rag-label">{RES_NAMES[j]}</text>
            {Array.from({ length: tot }, (_, k) => (
              <circle
                key={k}
                className={k < usedCount ? "rag-dot rag-dot-used" : "rag-dot"}
                cx={rx(j) - bw / 2 + 13 + (k % 5) * 12}
                cy={RY + 13 + Math.floor(k / 5) * 12}
                r={4}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export interface DeadlockInitial {
  mode: DLMode;
  avail: number[];
  alloc: number[][];
  max?: number[][];
  req?: number[][];
}

export function DeadlockLab({ initial }: { initial?: DeadlockInitial }) {
  const [mode, setMode] = useState<DLMode>(initial?.mode ?? "banker");
  const [available, setAvailable] = useState<number[]>(initial ? [...initial.avail] : [...DEFAULT.available]);
  const [alloc, setAlloc] = useState<number[][]>(initial ? cloneMat(initial.alloc) : cloneMat(DEFAULT.alloc));
  const [max, setMax] = useState<number[][]>(initial?.max ? cloneMat(initial.max) : cloneMat(DEFAULT.max!));
  const [request, setRequest] = useState<number[][]>(
    initial?.req ? cloneMat(initial.req) : alloc0Request(initial ? initial.alloc.length : DEFAULT.alloc.length, initial ? initial.avail.length : DEFAULT.available.length),
  );
  const [run, setRun] = useState<DLRun | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [predictOn, setPredictOn] = useState(false);
  const [quizAt, setQuizAt] = useState<number | null>(null);
  const quizDone = useRef(new Set<number>());
  const predict = usePredictScore();
  const ragRef = useRef<SVGSVGElement | null>(null);

  const n = alloc.length;
  const m = available.length;
  const meta = DEADLOCK_MODES.find((x) => x.key === mode)!;

  const quizByStep = useMemo(
    () => new Map(run ? deadlockQuizzes(run).map((q) => [q.step, q.quizzes[0]]) : []),
    [run],
  );

  const stepRef = useRef(step);
  stepRef.current = step;

  const gated = (target: number): boolean =>
    predictOn && quizByStep.has(target) && !quizDone.current.has(target);

  const dismissQuiz = () => {
    if (quizAt !== null) {
      quizDone.current.add(quizAt);
      setQuizAt(null);
    }
  };

  useEffect(() => {
    if (!playing || !run) return;
    const t = window.setInterval(() => {
      const next = stepRef.current + 1;
      if (next > run.steps.length - 1) {
        setPlaying(false);
        return;
      }
      if (gated(next)) {
        setPlaying(false);
        setQuizAt(next);
        return;
      }
      setStep(next);
    }, LAB_SPEEDS[speed].ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, speed, predictOn]);

  const invalidate = () => {
    setRun(null);
    setPlaying(false);
    setQuizAt(null);
  };

  const editCell = (which: "alloc" | "max" | "request" | "avail", i: number, j: number, raw: string) => {
    invalidate();
    const v = Math.max(0, Math.min(MAX_UNITS, Math.trunc(Number(raw)) || 0));
    if (which === "avail") setAvailable((a) => a.map((x, k) => (k === j ? v : x)));
    else {
      const set = which === "alloc" ? setAlloc : which === "max" ? setMax : setRequest;
      set((mat) => mat.map((row, ri) => (ri === i ? row.map((x, k) => (k === j ? v : x)) : row)));
    }
  };

  const resize = (dn: number, dm: number) => {
    invalidate();
    const nn = Math.max(1, Math.min(MAX_DL_PROCS, n + dn));
    const nm = Math.max(1, Math.min(MAX_RES, m + dm));
    if (nn === n && nm === m) {
      if (n + dn > MAX_DL_PROCS) notify.warning(`Up to ${MAX_DL_PROCS} processes — beyond that the matrices stop being readable.`);
      if (m + dm > MAX_RES) notify.warning(`Up to ${MAX_RES} resource types (${RES_NAMES.join(", ")}).`);
      return;
    }
    const fitRow = (row: number[]): number[] => Array.from({ length: nm }, (_, j) => row[j] ?? 0);
    const fitMat = (mat: number[][]): number[][] => Array.from({ length: nn }, (_, i) => fitRow(mat[i] ?? []));
    setAvailable((a) => fitRow(a));
    setAlloc(fitMat);
    setMax(fitMat);
    setRequest(fitMat);
  };

  const validate = (): boolean => {
    const errors: string[] = [];
    if (mode === "banker") {
      alloc.forEach((row, i) =>
        row.forEach((a, j) => {
          if (max[i][j] < a) errors.push(`Max[${procName(i)}][${RES_NAMES[j]}] = ${max[i][j]} is below its allocation ${a} — a process can't hold more than its declared maximum.`);
        }),
      );
    }
    if (errors.length > 0) {
      notify.error(errors.length === 1 ? errors[0] : `${errors[0]} (and ${errors.length - 1} more issue${errors.length > 2 ? "s" : ""} like it)`);
      return false;
    }
    return true;
  };

  const buildSpec = (): DeadlockSpec => ({
    mode,
    available: [...available],
    alloc: cloneMat(alloc),
    ...(mode === "banker" ? { max: cloneMat(max) } : { request: cloneMat(request) }),
  });

  const runNow = () => {
    if (!validate()) return;
    const spec = buildSpec();
    setRun(runDeadlock(spec));
    setStep(0);
    setPlaying(true);
    quizDone.current = new Set();
    setQuizAt(null);
    writeLabParam({
      lab: "deadlock",
      mode,
      avail: spec.available,
      alloc: spec.alloc,
      ...(mode === "banker" ? { max: spec.max } : { req: spec.request }),
    });
  };

  // Auto-run a permalink payload once on mount.
  const autoRan = useRef(false);
  useEffect(() => {
    if (initial && !autoRan.current) {
      autoRan.current = true;
      setRun(runDeadlock({
        mode: initial.mode,
        available: [...initial.avail],
        alloc: cloneMat(initial.alloc),
        ...(initial.mode === "banker" ? { max: cloneMat(initial.max!) } : { request: cloneMat(initial.req!) }),
      }));
      setStep(0);
      setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    if (!validate()) return;
    writeLabParam({
      lab: "deadlock",
      mode,
      avail: [...available],
      alloc: cloneMat(alloc),
      ...(mode === "banker" ? { max: cloneMat(max) } : { req: cloneMat(request) }),
    });
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify.success("Shareable link copied — it reopens these matrices and auto-runs.");
    } catch {
      notify.info("Link is in the address bar — copy it from there.");
    }
  };

  const exportPng = () => {
    if (!run) return;
    drawBankerPng(run, `deadlock-${run.spec.mode}.png`);
    if (ragRef.current) void exportSvgsPng([ragRef.current], "deadlock-rag.png");
  };

  const loadPreset = (name: string) => {
    const preset = DEADLOCK_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    invalidate();
    setMode(preset.spec.mode);
    setAvailable([...preset.spec.available]);
    setAlloc(cloneMat(preset.spec.alloc));
    if (preset.spec.max) setMax(cloneMat(preset.spec.max));
    else setMax(cloneMat(preset.spec.alloc)); // detect presets: max mirrors alloc until edited
    if (preset.spec.request) setRequest(cloneMat(preset.spec.request));
    else setRequest(alloc0Request(preset.spec.alloc.length, preset.spec.available.length));
    notify.info(preset.hint);
  };

  const randomize = () => {
    invalidate();
    const nn = 3 + Math.floor(Math.random() * 3);
    const nm = 2 + Math.floor(Math.random() * 2);
    const rnd = (k: number): number => Math.floor(Math.random() * k);
    const al = Array.from({ length: nn }, () => Array.from({ length: nm }, () => rnd(4)));
    setAvailable(Array.from({ length: nm }, () => rnd(4)));
    setAlloc(al);
    setMax(al.map((row) => row.map((a) => a + rnd(4))));
    setRequest(Array.from({ length: nn }, () => Array.from({ length: nm }, () => rnd(4))));
  };

  const st = run?.steps[Math.min(step, (run?.steps.length ?? 1) - 1)];
  const lastStep = run ? run.steps.length - 1 : 0;
  const atVerdict = st?.kind === "verdict";
  const note = run && st ? st.note : meta.blurb;
  const needLabel = mode === "banker" ? "Need = Max − Alloc" : "Request";

  const matrixTable = (
    title: string,
    mat: number[][],
    which: "alloc" | "max" | "request" | null,
    hint?: string,
  ) => (
    <div className="dl-matrix">
      <div className="sched-section-head">
        <h3>{title}</h3>
        {hint && <span className="sched-hint">{hint}</span>}
      </div>
      <table className="sched-table dl-table">
        <thead>
          <tr>
            <th />
            {available.map((_, j) => <th key={j}>{RES_NAMES[j]}</th>)}
          </tr>
        </thead>
        <tbody>
          {mat.map((row, i) => (
            <tr key={i} className={run && st && st.proc === i && (st.kind === "check" || st.kind === "finish") ? "dl-row-active" : run && st?.finish[i] ? "dl-row-done" : ""}>
              <th><span className={procChip(i)}>{procName(i)}</span></th>
              {row.map((v, j) => (
                <td key={j}>
                  {which ? (
                    <input
                      className="ds-input cell"
                      type="number"
                      min={0}
                      max={MAX_UNITS}
                      value={v}
                      onChange={(e) => editCell(which, i, j, e.target.value)}
                    />
                  ) : (
                    v
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <label className="ds-mode">
          mode:
          <select value={mode} onChange={(e) => { setMode(e.target.value as DLMode); invalidate(); }}>
            {DEADLOCK_MODES.map((x) => (
              <option key={x.key} value={x.key}>{x.label}</option>
            ))}
          </select>
        </label>
        <label className="ds-mode">
          procs:
          <span className="dl-stepper">
            <button className="icon-btn ghost" onClick={() => resize(-1, 0)} title="remove a process"><Minus size={13} /></button>
            <strong>{n}</strong>
            <button className="icon-btn ghost" onClick={() => resize(1, 0)} title="add a process"><Plus size={13} /></button>
          </span>
        </label>
        <label className="ds-mode">
          resources:
          <span className="dl-stepper">
            <button className="icon-btn ghost" onClick={() => resize(0, -1)} title="remove a resource type"><Minus size={13} /></button>
            <strong>{m}</strong>
            <button className="icon-btn ghost" onClick={() => resize(0, 1)} title="add a resource type"><Plus size={13} /></button>
          </span>
        </label>
        <button className="primary" onClick={runNow}>
          <Play size={13} /> Run
        </button>
        <button
          className={predictOn ? "toggled" : ""}
          title="pause during the scan and ask you to predict each decision"
          onClick={() => {
            setPredictOn((p) => !p);
            predict.reset();
            dismissQuiz();
          }}
        >
          <Target size={13} /> Predict
        </button>
        <PredictChips state={predict.state} />
        <label className="ds-mode">
          preset:
          <select value="" onChange={(e) => loadPreset(e.target.value)}>
            <option value="" disabled>pick a classic…</option>
            {DEADLOCK_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button onClick={randomize}><Shuffle size={13} /> Random</button>
        {run && (
          <>
            <button onClick={copyLink} title="copy a link that reopens these matrices and auto-runs">
              <Link2 size={13} /> Copy link
            </button>
            <button onClick={exportPng} title="download the matrices and the resource-allocation graph as PNGs">
              <Download size={13} /> PNG
            </button>
          </>
        )}
        <button onClick={() => {
          invalidate();
          setMode("banker");
          setAvailable([...DEFAULT.available]);
          setAlloc(cloneMat(DEFAULT.alloc));
          setMax(cloneMat(DEFAULT.max!));
          setRequest(alloc0Request(DEFAULT.alloc.length, DEFAULT.available.length));
          writeLabParam(null);
        }}>
          <X size={13} /> Reset
        </button>
      </div>

      <div className="sched-body">
        <section className="sched-procs">
          <div className="dl-matrices">
            {matrixTable("Allocation", alloc, "alloc", "instances each process holds now")}
            {mode === "banker"
              ? matrixTable("Max", max, "max", "declared maximum demand — never below Allocation")
              : matrixTable("Request", request, "request", "what each process is waiting for right now")}
            <div className="dl-matrix">
              <div className="sched-section-head">
                <h3>Available</h3>
                <span className="sched-hint">free instances of each resource</span>
              </div>
              <table className="sched-table dl-table">
                <thead>
                  <tr>{available.map((_, j) => <th key={j}>{RES_NAMES[j]}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    {available.map((v, j) => (
                      <td key={j}>
                        <input
                          className="ds-input cell"
                          type="number"
                          min={0}
                          max={MAX_UNITS}
                          value={v}
                          onChange={(e) => editCell("avail", 0, j, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {run && matrixTable(needLabel, run.need, null)}
          </div>
        </section>

        {run && st && (
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>The scan — {meta.short}</h3>
              <span className="sched-hint">step {step} / {lastStep} · Work grows as processes finish and release</span>
            </div>
            <div className="sched-live dl-live">
              <span className="sched-live-label">Work</span>
              {st.work.map((v, j) => (
                <span key={j} className="ds-chip dl-work-chip">{RES_NAMES[j]} = {v}</span>
              ))}
              <span className="sched-live-label">finished</span>
              {st.finish.every((f) => !f) && <span className="ds-chip">none yet</span>}
              {st.finish.map((f, i) => (f ? <span key={i} className={procChip(i)}>{procName(i)} ✓</span> : null))}
            </div>
            <div className="dl-seq">
              <span className="sched-live-label">{mode === "banker" ? "safe sequence" : "completion order"}</span>
              {st.seqSoFar.length === 0 && <span className="ds-chip">—</span>}
              {st.seqSoFar.map((i, k) => (
                <span key={k} className="dl-seq-item">
                  {k > 0 && <span className="dl-seq-arrow">→</span>}
                  <span className={procChip(i)}>{procName(i)}</span>
                </span>
              ))}
            </div>
            {atVerdict && (
              <div className={`dl-verdict ${run.safe ? "dl-safe" : "dl-bad"}`}>
                {run.spec.mode === "banker"
                  ? run.safe ? `SAFE — ${run.safeSeq.map(procName).join(" → ")}` : `UNSAFE — ${run.stuck.map(procName).join(", ")} can never finish`
                  : run.safe ? "NO DEADLOCK — every process can finish" : `DEADLOCKED — ${run.stuck.map(procName).join(", ")}`}
              </div>
            )}
            <div className="sched-section-head">
              <h3>Resource-allocation graph</h3>
              <span className="sched-hint">
                solid: resource assigned to process · dashed: process {mode === "banker" ? "may still claim" : "is requesting"}
                {run.stuck.length > 0 ? " · the cycle lights up at the verdict" : ""}
              </span>
            </div>
            <RagScene run={run} step={Math.min(step, lastStep)} svgRef={ragRef} />
          </section>
        )}

        {!run && (
          <div className="sched-empty">
            <span className="empty-icon"><Lock size={20} aria-hidden="true" /></span>
            <p>Fill the matrices (or load a preset), then press Run — the scan hunts for a safe sequence and the graph shows who is waiting on whom.</p>
          </div>
        )}
      </div>

      {quizAt !== null && quizByStep.has(quizAt) && (
        <QuizPanel
          quiz={quizByStep.get(quizAt)!}
          onAnswer={predict.answer}
          onContinue={() => {
            quizDone.current.add(quizAt);
            setStep(quizAt);
            setQuizAt(null);
            setPlaying(true);
          }}
        />
      )}

      <div className="ds-caption">
        <span className="ds-teacher"><Lock size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {run && (
          <div className="transport ds-transport">
            <button onClick={() => { dismissQuiz(); setStep(0); }} disabled={step === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => { dismissQuiz(); setStep((i) => Math.max(0, i - 1)); }} disabled={step === 0} title="previous step">
              <StepBack size={15} />
            </button>
            <button className="play-btn" onClick={() => { if (step >= lastStep) setStep(0); setPlaying(!playing); }} title="play / pause">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              onClick={() => {
                const next = Math.min(lastStep, step + 1);
                if (gated(next)) {
                  setPlaying(false);
                  setQuizAt(next);
                  return;
                }
                setStep(next);
              }}
              disabled={step >= lastStep}
              title="next step"
            >
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={lastStep}
              value={Math.min(step, lastStep)}
              title="scrub through the scan"
              onChange={(e) => { setPlaying(false); dismissQuiz(); setStep(Number(e.target.value)); }}
            />
            <SpeedSelect speed={speed} onChange={setSpeed} />
            <span className="step-counter">step {Math.min(step, lastStep)} / {lastStep}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** All-zero request matrix for fresh detect-mode editing. */
function alloc0Request(n: number, m: number): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: m }, () => 0));
}
