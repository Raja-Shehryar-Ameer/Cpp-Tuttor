import {
  ChevronFirst,
  Download,
  Link2,
  MemoryStick,
  Pause,
  Play,
  Scale,
  Shuffle,
  StepBack,
  StepForward,
  Swords,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_FRAMES,
  MAX_PAGE,
  MAX_REFS,
  PAGE_ALGOS,
  PAGE_PRESETS,
  pageReplace,
  pagingQuizzes,
  type PageAlgo,
  type PageRun,
} from "../../ds/paging";
import { writeLabParam } from "../../ds/permalink";
import { drawPageGridPng } from "../../utils/exportPng";
import { notify } from "../../store/toastStore";
import { PredictChips, QuizPanel, usePredictScore } from "./predict";
import { LAB_SPEEDS, SpeedSelect } from "./SpeedSelect";

// Page chips reuse the scheduler's warm process palette (.pc-0 … .pc-7),
// keyed by page number so page 7 is the same color everywhere it appears.
const chipOf = (page: number): string => `pc-${((page % 8) + 8) % 8}`;

const DEFAULT_REFS = PAGE_PRESETS[0].refs.join(" ");

/** One algorithm's frames×references grid (+ live panel and stat chips).
    Extracted so race mode can stack two of them under one shared scrubber. */
function PageGrid({ run, now, detail }: { run: PageRun; now: number; detail: boolean }) {
  const meta = PAGE_ALGOS.find((a) => a.key === run.algo)!;
  const clamped = Math.min(now, run.steps.length);
  const step = clamped > 0 ? run.steps[clamped - 1] : null;
  return (
    <section className="sched-results">
      <div className="sched-section-head">
        <h3>Frames over time — {meta.short}</h3>
        <span className="sched-hint">each column is memory AFTER that reference · ref {clamped} / {run.steps.length}</span>
      </div>
      <div className="page-grid-wrap">
        <table className="page-grid">
          <thead>
            <tr>
              <th className="pg-label">ref</th>
              {run.steps.map((s, j) => (
                <th key={j} className={j >= clamped ? "future" : j === clamped - 1 ? "current-col" : ""}>
                  <span className={`proc-chip ${chipOf(s.page)}`}>{s.page}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: run.frameCount }, (_, slot) => (
              <tr key={slot}>
                <th className="pg-label">f{slot}</th>
                {run.steps.map((s, j) => {
                  const cls = [
                    j >= clamped ? "future" : "",
                    j === clamped - 1 ? "current-col" : "",
                    s.slot === slot ? (s.hit ? "hit-cell" : "load-cell") : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <td key={j} className={cls}>{s.frames[slot] ?? "·"}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="pg-label" title="H = hit, F = fault">h/f</th>
              {run.steps.map((s, j) => (
                <td key={j} className={`${s.hit ? "pg-hit" : "pg-fault"}${j >= clamped ? " future" : ""}`}>
                  {s.hit ? "H" : "F"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {detail && (
        <div className="sched-live">
          <span className="sched-live-label">memory now</span>
          {(step?.frames ?? Array.from({ length: run.frameCount }, () => null)).map((p, k) => (
            <span
              key={k}
              className={`page-slot${step?.hand === k ? " hand" : ""}${step?.slot === k ? (step.hit ? " just-hit" : " just-loaded") : ""}`}
              title={step?.hand === k ? "the clock hand points here" : undefined}
            >
              <span className="pg-slot-name">f{k}</span>
              {p !== null ? (
                <span className={`proc-chip ${chipOf(p)}`}>{p}</span>
              ) : (
                <span className="proc-chip gantt-idle">—</span>
              )}
              {step && <em>{step.info[k]}</em>}
              {step?.hand === k && <em className="pg-hand">◄ hand</em>}
            </span>
          ))}
          <span className="sched-live-label">so far</span>
          <span className="ds-chip">{step?.faultsSoFar ?? 0} faults</span>
          <span className="ds-chip">{step?.hitsSoFar ?? 0} hits</span>
          {step?.victim !== null && step?.victim !== undefined && (
            <span className="ds-chip pg-victim">evicted page {step.victim}</span>
          )}
        </div>
      )}

      <div className="sched-stats">
        <span className="ds-chip">page faults {run.faults}</span>
        <span className="ds-chip">hits {run.hits}</span>
        <span className="ds-chip">hit ratio {(run.hitRatio * 100).toFixed(1)}%</span>
        <span className="ds-chip">fault ratio {((1 - run.hitRatio) * 100).toFixed(1)}%</span>
        {detail && <span className="ds-chip">hit ratio = hits ÷ references</span>}
      </div>
    </section>
  );
}

function parseRefs(raw: string): { refs: number[]; bad: string[] } {
  const refs: number[] = [];
  const bad: string[] = [];
  for (const token of raw.split(/[\s,;]+/).filter((t) => t.length > 0)) {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 0 && n <= MAX_PAGE) refs.push(n);
    else bad.push(token);
  }
  return { refs, bad };
}

export interface PagingInitial {
  algo: PageAlgo;
  frames: number;
  refs: number[];
  race?: PageAlgo;
}

export function PagingLab({ initial }: { initial?: PagingInitial }) {
  const [refText, setRefText] = useState(initial ? initial.refs.join(" ") : DEFAULT_REFS);
  const [algo, setAlgo] = useState<PageAlgo>(initial?.algo ?? "fifo");
  const [frameCount, setFrameCount] = useState(initial?.frames ?? 3);
  const [run, setRun] = useState<PageRun | null>(null);
  const [tick, setTick] = useState(0); // 0 = before the first reference
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);
  // Race mode: a second algorithm on the same reference string, stacked grids.
  const [race, setRace] = useState(initial?.race !== undefined);
  const [algoB, setAlgoB] = useState<PageAlgo>(initial?.race ?? "lru");
  const [runB, setRunB] = useState<PageRun | null>(null);
  // Predict mode: every reference asks hit-or-fault; full-memory faults also
  // ask which page gets evicted. quizPos = [step index, question index].
  const [predictOn, setPredictOn] = useState(false);
  const [quizPos, setQuizPos] = useState<[number, number] | null>(null);
  const quizDone = useRef(new Set<number>());
  const predict = usePredictScore();

  const meta = PAGE_ALGOS.find((a) => a.key === algo)!;

  const quizzesByStep = useMemo(
    () => (run ? pagingQuizzes(run).map((s) => s.quizzes) : []),
    [run],
  );

  const tickRef = useRef(tick);
  tickRef.current = tick;

  /** Advancing to tick `target` reveals step target-1. */
  const gated = (target: number): boolean =>
    predictOn && target >= 1 && (quizzesByStep[target - 1]?.length ?? 0) > 0 && !quizDone.current.has(target - 1);

  const dismissQuiz = () => {
    if (quizPos !== null) {
      quizDone.current.add(quizPos[0]);
      setQuizPos(null);
    }
  };

  useEffect(() => {
    if (!playing || !run) return;
    const t = window.setInterval(() => {
      const next = tickRef.current + 1;
      if (next > run.steps.length) {
        setPlaying(false);
        return;
      }
      if (gated(next)) {
        setPlaying(false);
        setQuizPos([next - 1, 0]);
        return;
      }
      setTick(next);
    }, LAB_SPEEDS[speed].ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, speed, predictOn]);

  const invalidate = () => {
    setRun(null);
    setRunB(null);
    setPlaying(false);
  };

  const validate = (): number[] | null => {
    const { refs, bad } = parseRefs(refText);
    if (bad.length > 0) {
      notify.error(`Pages are whole numbers 0–${MAX_PAGE} — I can't read ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}.`);
      return null;
    }
    if (refs.length === 0) {
      notify.error("Type a reference string first — page numbers separated by spaces or commas.");
      return null;
    }
    if (refs.length > MAX_REFS) {
      notify.error(`That's ${refs.length} references — keep it to ${MAX_REFS} so the grid stays readable.`);
      return null;
    }
    if (frameCount < 1 || frameCount > MAX_FRAMES) {
      notify.error(`Frames must be between 1 and ${MAX_FRAMES}.`);
      return null;
    }
    return refs;
  };

  const runNow = () => {
    const refs = validate();
    if (!refs) return;
    setRun(pageReplace(algo, refs, frameCount));
    setRunB(race ? pageReplace(algoB, refs, frameCount) : null);
    setTick(0);
    setPlaying(true);
    setCompare(false);
    quizDone.current = new Set();
    setQuizPos(null);
    writeLabParam({ lab: "paging", algo, frames: frameCount, refs, ...(race ? { race: algoB } : {}) });
  };

  // Auto-run a permalink payload once on mount.
  const autoRan = useRef(false);
  useEffect(() => {
    if (initial && !autoRan.current) {
      autoRan.current = true;
      setRun(pageReplace(initial.algo, initial.refs, initial.frames));
      setRunB(initial.race !== undefined ? pageReplace(initial.race, initial.refs, initial.frames) : null);
      setTick(0);
      setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    const refs = validate();
    if (!refs) return;
    writeLabParam({ lab: "paging", algo, frames: frameCount, refs, ...(race ? { race: algoB } : {}) });
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify.success("Shareable link copied — it reopens this reference string and auto-runs.");
    } catch {
      notify.info("Link is in the address bar — copy it from there.");
    }
  };

  const exportPng = () => {
    if (!run) return;
    drawPageGridPng(run, `paging-${run.algo}.png`);
    if (runB) drawPageGridPng(runB, `paging-${runB.algo}.png`);
  };

  const loadPreset = (name: string) => {
    const preset = PAGE_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    invalidate();
    setCompare(false);
    setRefText(preset.refs.join(" "));
    setFrameCount(preset.frames);
    notify.info(preset.hint);
  };

  const randomize = () => {
    invalidate();
    // A small hot pool with occasional strays, so hits actually happen.
    const poolSize = 4 + Math.floor(Math.random() * 3);
    const n = 12 + Math.floor(Math.random() * 7);
    const refs = Array.from({ length: n }, () =>
      Math.random() < 0.85 ? Math.floor(Math.random() * poolSize) : poolSize + Math.floor(Math.random() * 3),
    );
    setRefText(refs.join(" "));
  };

  // Comparison: the same reference string through every algorithm, plus the
  // frames sweep that makes Belady's anomaly visible as a rising fault count.
  const comparison = useMemo(() => {
    if (!compare) return null;
    const { refs } = parseRefs(refText);
    if (refs.length === 0) return null;
    return {
      algos: PAGE_ALGOS.map((a) => ({ meta: a, run: pageReplace(a.key, refs, frameCount) })),
      sweep: Array.from({ length: MAX_FRAMES }, (_, k) => pageReplace(algo, refs, k + 1)),
    };
  }, [compare, refText, frameCount, algo]);

  const shown = run;
  const now = shown ? Math.min(tick, shown.steps.length) : 0;
  const step = shown && now > 0 ? shown.steps[now - 1] : null;
  const finished = shown !== null && now >= shown.steps.length;
  const metaB = PAGE_ALGOS.find((a) => a.key === algoB)!;
  const note = shown
    ? runB && finished
      ? `Race over: ${meta.short} ${shown.faults} fault${shown.faults === 1 ? "" : "s"} vs ${metaB.short} ${runB.faults} — ${
          shown.faults === runB.faults ? "a dead heat" : `${shown.faults < runB.faults ? meta.short : metaB.short} wins with fewer faults`}.`
      : step
        ? finished
          ? `${step.note} All done: ${shown.faults} fault${shown.faults === 1 ? "" : "s"}, ${shown.hits} hit${shown.hits === 1 ? "" : "s"} — hit ratio ${(shown.hitRatio * 100).toFixed(1)}%.`
          : step.note
        : `${shown.frameCount} empty frames, ${shown.refs.length} references queued — press play.`
    : meta.blurb;

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <label className="ds-mode">
          algorithm:
          <select value={algo} onChange={(e) => { setAlgo(e.target.value as PageAlgo); invalidate(); }}>
            {PAGE_ALGOS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="ds-mode">
          frames:
          <input
            className="ds-input small"
            type="number"
            min={1}
            max={MAX_FRAMES}
            value={frameCount}
            onChange={(e) => { setFrameCount(Math.trunc(Number(e.target.value)) || 1); invalidate(); }}
          />
        </label>
        <button className="primary" onClick={runNow}>
          <Play size={13} /> Run
        </button>
        <button
          className={race ? "toggled" : ""}
          title="run a second algorithm on the same reference string, stacked under one scrubber"
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
            <select value={algoB} onChange={(e) => { setAlgoB(e.target.value as PageAlgo); setRun(null); setRunB(null); }}>
              {PAGE_ALGOS.map((a) => (
                <option key={a.key} value={a.key}>{a.short}</option>
              ))}
            </select>
          </label>
        )}
        {!race && (
          <button
            className={predictOn ? "toggled" : ""}
            title="pause before every reference and ask hit-or-fault (and who gets evicted)"
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
        <button
          className={compare ? "toggled" : ""}
          onClick={() => {
            if (!compare && !validate()) return;
            setCompare((c) => !c);
            invalidate();
          }}
          title="run this string through every algorithm, and this algorithm through every frame count"
        >
          <Scale size={13} /> Compare
        </button>
        <label className="ds-mode">
          preset:
          <select value="" onChange={(e) => loadPreset(e.target.value)}>
            <option value="" disabled>pick a classic…</option>
            {PAGE_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button onClick={randomize}><Shuffle size={13} /> Random</button>
        {run && (
          <>
            <button onClick={copyLink} title="copy a link that reopens this reference string and auto-runs">
              <Link2 size={13} /> Copy link
            </button>
            <button onClick={exportPng} title="download the frames grid as a PNG">
              <Download size={13} /> PNG
            </button>
          </>
        )}
        <button onClick={() => { setRefText(DEFAULT_REFS); setFrameCount(3); invalidate(); setCompare(false); writeLabParam(null); }}>
          <X size={13} /> Reset
        </button>
      </div>

      <div className="sched-body">
        <section className="sched-procs">
          <div className="sched-section-head">
            <h3>Reference string</h3>
            <span className="sched-hint">page numbers 0–{MAX_PAGE}, up to {MAX_REFS} references — #0, #1, #2… like array indices</span>
          </div>
          <input
            className="ds-input ref-input"
            value={refText}
            placeholder="e.g. 1 2 3 4 1 2 5 1 2 3 4 5"
            onChange={(e) => { setRefText(e.target.value); invalidate(); }}
            onKeyDown={(e) => { if (e.key === "Enter") runNow(); }}
          />
        </section>

        {compare && comparison && (
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>Every algorithm, same string ({frameCount} frames)</h3>
              <span className="sched-hint">OPT is the theoretical floor — fewest faults is marked</span>
            </div>
            <div className="sched-table-wrap">
              <table className="sched-table metrics">
                <thead>
                  <tr><th>algorithm</th><th>faults</th><th>hits</th><th>hit ratio</th></tr>
                </thead>
                <tbody>
                  {(() => {
                    const best = Math.min(...comparison.algos.map((c) => c.run.faults));
                    return comparison.algos.map(({ meta: m, run: r }) => (
                      <tr key={m.key} className={r.faults === best ? "best-row" : ""}>
                        <td>{m.short}</td>
                        <td>{r.faults}</td>
                        <td>{r.hits}</td>
                        <td>{(r.hitRatio * 100).toFixed(1)}%</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            <div className="sched-section-head sweep-head">
              <h3>{meta.short} across every frame count</h3>
              <span className="sched-hint">for FIFO, watch for rows where MORE frames mean MORE faults — Belady's anomaly</span>
            </div>
            <div className="sched-table-wrap">
              <table className="sched-table metrics">
                <thead>
                  <tr><th>frames</th><th>faults</th><th>hits</th><th>hit ratio</th><th /></tr>
                </thead>
                <tbody>
                  {comparison.sweep.map((r, k) => {
                    const anomaly = k > 0 && r.faults > comparison.sweep[k - 1].faults;
                    return (
                      <tr key={r.frameCount} className={anomaly ? "warn-row" : ""}>
                        <td>{r.frameCount}</td>
                        <td>{r.faults}</td>
                        <td>{r.hits}</td>
                        <td>{(r.hitRatio * 100).toFixed(1)}%</td>
                        <td>{anomaly ? "▲ Belady's anomaly!" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="sched-hint">Pick an algorithm above and press Run to watch it reference by reference.</p>
          </section>
        )}

        {shown && (
          <div className={runB ? "race-stack" : undefined}>
            <PageGrid run={shown} now={now} detail={!runB} />
            {runB && <PageGrid run={runB} now={now} detail={false} />}
          </div>
        )}

        {!shown && !compare && (
          <div className="sched-empty">
            <span className="empty-icon"><MemoryStick size={20} aria-hidden="true" /></span>
            <p>Type a reference string, pick frames and an algorithm, then press Run — or load a preset built to provoke a classic exam question.</p>
          </div>
        )}
      </div>

      {quizPos !== null && quizzesByStep[quizPos[0]]?.[quizPos[1]] && (
        <QuizPanel
          quiz={quizzesByStep[quizPos[0]][quizPos[1]]}
          onAnswer={predict.answer}
          onContinue={() => {
            const [step, qi] = quizPos;
            if (qi + 1 < quizzesByStep[step].length) {
              setQuizPos([step, qi + 1]); // second question: who gets evicted?
              return;
            }
            quizDone.current.add(step);
            setQuizPos(null);
            setTick(step + 1);
            setPlaying(true);
          }}
        />
      )}

      <div className="ds-caption">
        <span className="ds-teacher"><MemoryStick size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {shown && (
          <div className="transport ds-transport">
            <button onClick={() => { dismissQuiz(); setTick(0); }} disabled={now === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => { dismissQuiz(); setTick((i) => Math.max(0, i - 1)); }} disabled={now === 0} title="previous reference">
              <StepBack size={15} />
            </button>
            <button
              className="play-btn"
              onClick={() => { if (now >= shown.steps.length) setTick(0); setPlaying(!playing); }}
              title="play / pause"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              onClick={() => {
                const next = Math.min(shown.steps.length, now + 1);
                if (gated(next)) {
                  setPlaying(false);
                  setQuizPos([next - 1, 0]);
                  return;
                }
                setTick(next);
              }}
              disabled={now >= shown.steps.length}
              title="next reference"
            >
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={shown.steps.length}
              value={now}
              title="scrub through the reference string"
              onChange={(e) => { setPlaying(false); dismissQuiz(); setTick(Number(e.target.value)); }}
            />
            <SpeedSelect speed={speed} onChange={setSpeed} />
            <span className="step-counter">ref {now} / {shown.steps.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
