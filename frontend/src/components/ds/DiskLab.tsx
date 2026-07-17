import {
  ChevronFirst,
  Download,
  HardDrive,
  Link2,
  Pause,
  Play,
  RotateCcw,
  Scale,
  Shuffle,
  StepBack,
  StepForward,
  Swords,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CYL,
  DISK_ALGOS,
  DISK_PRESETS,
  diskQuizzes,
  diskSchedule,
  MAX_CYL,
  MAX_DISK_REQUESTS,
  MIN_CYL,
  type DiskAlgo,
  type DiskDir,
  type DiskRun,
} from "../../ds/disk";
import { writeLabParam } from "../../ds/permalink";
import { drawDiskChartPng } from "../../utils/exportPng";
import { notify } from "../../store/toastStore";
import { PredictChips, QuizPanel, usePredictScore } from "./predict";
import { LAB_SPEEDS, SpeedSelect } from "./SpeedSelect";

const DEFAULT_PRESET = DISK_PRESETS[0];

function parseRequests(raw: string, cylinders: number): { reqs: number[]; bad: string[] } {
  const reqs: number[] = [];
  const bad: string[] = [];
  for (const token of raw.split(/[\s,;]+/).filter((t) => t.length > 0)) {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 0 && n <= cylinders - 1) reqs.push(n);
    else bad.push(token);
  }
  return { reqs, bad };
}

/** One algorithm's head-movement zigzag (+ stat chips). Extracted so race
    mode can stack two of them under one shared scrubber. */
function DiskChart({ run, now }: { run: DiskRun; now: number }) {
  const meta = DISK_ALGOS.find((a) => a.key === run.algo)!;
  const clamped = Math.min(now, run.steps.length - 1);
  const step = run.steps[clamped];
  const { cylinders, head: start } = run.spec;
  const rim = cylinders - 1;

  const W = 640;
  const L = 30;
  const R = 30;
  const x = (c: number): number => L + (c / rim) * (W - L - R);
  const y0 = 64;
  const rowH = 30;
  const H = y0 + (run.steps.length - 1) * rowH + 26;
  const pointY = (i: number): number => y0 + i * rowH;
  const servedSet = new Set(run.order.slice(0, run.steps.slice(1, clamped + 1).filter((s) => s.servicing !== null).length));

  return (
    <section className="sched-results">
      <div className="sched-section-head">
        <h3>Head movement — {meta.short}</h3>
        <span className="sched-hint">move {clamped} / {run.steps.length - 1} · cylinders 0–{rim}</span>
      </div>
      <div className="gantt-wrap">
        <svg className="ds-svg disk-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: "100%", height: "auto" }}>
          {/* cylinder axis with the request queue on it */}
          <line className="disk-axis" x1={L} y1={34} x2={W - R} y2={34} />
          <text className="disk-tick" x={L} y={22} textAnchor="middle">0</text>
          <text className="disk-tick" x={W - R} y={22} textAnchor="middle">{rim}</text>
          <text className="disk-tick disk-start" x={x(start)} y={22} textAnchor="middle">{start}</text>
          <line className="disk-axis" x1={x(start)} y1={28} x2={x(start)} y2={40} />
          {run.spec.requests.map((r) => (
            <circle
              key={r}
              className={`disk-req${servedSet.has(r) ? " served" : ""}${step.servicing === r ? " now" : ""}`}
              cx={x(r)}
              cy={34}
              r={4.5}
            >
              <title>request {r}</title>
            </circle>
          ))}

          {/* the zigzag: one segment per head move, revealed as playback lands */}
          {run.moves.map((mv, i) => {
            const seg = i + 1; // steps index this move produces
            const state = seg < clamped ? "" : seg === clamped ? " seg-new" : " seg-future";
            const kind = mv.jump ? " seg-jump" : mv.sweep ? " seg-sweep" : "";
            return (
              <line
                key={i}
                className={`disk-seg${kind}${state}`}
                pathLength={1}
                x1={x(mv.from)}
                y1={pointY(i)}
                x2={x(mv.to)}
                y2={pointY(i + 1)}
              />
            );
          })}

          {/* serviced vertices, labeled like the textbook figure */}
          {run.moves.map((mv, i) => {
            const seg = i + 1;
            if (seg > clamped || mv.serviced === null) return null;
            const px = x(mv.to);
            const py = pointY(i + 1);
            const left = mv.to > rim * 0.82;
            return (
              <g key={i} className="disk-vertex">
                <circle cx={px} cy={py} r={3.4} />
                <text x={px + (left ? -9 : 9)} y={py + 4} textAnchor={left ? "end" : "start"}>{mv.to}</text>
              </g>
            );
          })}

          {/* head marker glides between vertices */}
          <g
            className="disk-headmark"
            style={{ transform: `translate(${x(step.head)}px, ${pointY(clamped)}px)` }}
          >
            <circle r={7} />
          </g>
        </svg>
      </div>

      <div className="sched-stats">
        <span className="ds-chip">head movement so far {step.seekSoFar}</span>
        <span className="ds-chip">serviced {run.spec.requests.length - step.pending.length} / {run.spec.requests.length}</span>
        {clamped >= run.steps.length - 1 && (
          <>
            <span className="ds-chip">total seek {run.totalSeek}</span>
            <span className="ds-chip">avg seek {run.avgSeek.toFixed(2)}</span>
            <span className="ds-chip">order {run.order.join(" → ")}</span>
          </>
        )}
        {meta.usesDirection && <span className="ds-chip">starts heading {run.spec.dir === "up" ? "↑ higher" : "↓ lower"}</span>}
      </div>
    </section>
  );
}

export interface DiskInitial {
  algo: DiskAlgo;
  head: number;
  cyl: number;
  reqs: number[];
  dir?: DiskDir;
  race?: DiskAlgo;
}

export function DiskLab({ initial }: { initial?: DiskInitial }) {
  const [reqText, setReqText] = useState(initial ? initial.reqs.join(" ") : DEFAULT_PRESET.requests.join(" "));
  const [cylinders, setCylinders] = useState(initial?.cyl ?? DEFAULT_PRESET.cylinders);
  const [head, setHead] = useState(initial?.head ?? DEFAULT_PRESET.head);
  const [dir, setDir] = useState<DiskDir>(initial?.dir ?? "up");
  const [algo, setAlgo] = useState<DiskAlgo>(initial?.algo ?? "fcfs");
  const [run, setRun] = useState<DiskRun | null>(null);
  const [tick, setTick] = useState(0); // step index: 0 = initial head position
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);
  // Race mode: a second algorithm on the same queue, stacked under one scrubber.
  const [race, setRace] = useState(initial?.race !== undefined);
  const [algoB, setAlgoB] = useState<DiskAlgo>(initial?.race ?? "sstf");
  const [runB, setRunB] = useState<DiskRun | null>(null);
  // Predict mode: pause before each head move and ask.
  const [predictOn, setPredictOn] = useState(false);
  const [quizAt, setQuizAt] = useState<number | null>(null);
  const quizDone = useRef(new Set<number>());
  const predict = usePredictScore();

  const meta = DISK_ALGOS.find((a) => a.key === algo)!;
  const metaB = DISK_ALGOS.find((a) => a.key === algoB)!;

  const quizByStep = useMemo(
    () => new Map(run ? diskQuizzes(run).map((q) => [q.step, q.quiz]) : []),
    [run],
  );

  const tickRef = useRef(tick);
  tickRef.current = tick;

  const gated = (target: number): boolean =>
    predictOn && quizByStep.has(target) && !quizDone.current.has(target);

  const dismissQuiz = () => {
    if (quizAt !== null) {
      quizDone.current.add(quizAt);
      setQuizAt(null);
    }
  };

  const span = run ? Math.max(run.steps.length, runB?.steps.length ?? 0) - 1 : 0;

  useEffect(() => {
    if (!playing || !run) return;
    const t = window.setInterval(() => {
      const next = tickRef.current + 1;
      if (next > span) {
        setPlaying(false);
        return;
      }
      if (gated(next)) {
        setPlaying(false);
        setQuizAt(next);
        return;
      }
      setTick(next);
    }, LAB_SPEEDS[speed].ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, runB, speed, predictOn]);

  const invalidate = () => {
    setRun(null);
    setRunB(null);
    setPlaying(false);
  };

  const validate = (): number[] | null => {
    if (cylinders < MIN_CYL || cylinders > MAX_CYL) {
      notify.error(`Cylinders must be between ${MIN_CYL} and ${MAX_CYL}.`);
      return null;
    }
    if (head < 0 || head > cylinders - 1) {
      notify.error(`The head must start between 0 and ${cylinders - 1}.`);
      return null;
    }
    const { reqs, bad } = parseRequests(reqText, cylinders);
    if (bad.length > 0) {
      notify.error(`Requests are cylinder numbers 0–${cylinders - 1} — I can't read ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}.`);
      return null;
    }
    if (reqs.length === 0) {
      notify.error("Type a request queue first — cylinder numbers separated by spaces or commas.");
      return null;
    }
    if (reqs.length > MAX_DISK_REQUESTS) {
      notify.error(`That's ${reqs.length} requests — keep it to ${MAX_DISK_REQUESTS} so the zigzag stays readable.`);
      return null;
    }
    if (new Set(reqs).size !== reqs.length) {
      notify.error("Each cylinder should appear once in the queue — duplicates don't add anything here.");
      return null;
    }
    return reqs;
  };

  const runNow = () => {
    const reqs = validate();
    if (!reqs) return;
    const spec = { cylinders, head, requests: reqs, dir };
    setRun(diskSchedule(algo, spec));
    setRunB(race ? diskSchedule(algoB, spec) : null);
    setTick(0);
    setPlaying(true);
    setCompare(false);
    quizDone.current = new Set();
    setQuizAt(null);
    writeLabParam({ lab: "disk", algo, head, cyl: cylinders, reqs, dir, ...(race ? { race: algoB } : {}) });
  };

  // Auto-run a permalink payload once on mount.
  const autoRan = useRef(false);
  useEffect(() => {
    if (initial && !autoRan.current) {
      autoRan.current = true;
      const spec = { cylinders: initial.cyl, head: initial.head, requests: initial.reqs, dir: initial.dir ?? "up" };
      setRun(diskSchedule(initial.algo, spec));
      setRunB(initial.race !== undefined ? diskSchedule(initial.race, spec) : null);
      setTick(0);
      setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    const reqs = validate();
    if (!reqs) return;
    writeLabParam({ lab: "disk", algo, head, cyl: cylinders, reqs, dir, ...(race ? { race: algoB } : {}) });
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify.success("Shareable link copied — it reopens this request queue and auto-runs.");
    } catch {
      notify.info("Link is in the address bar — copy it from there.");
    }
  };

  const exportPng = () => {
    if (!run) return;
    drawDiskChartPng(run, `disk-${run.algo}.png`);
    if (runB) drawDiskChartPng(runB, `disk-${runB.algo}.png`);
  };

  const loadPreset = (name: string) => {
    const preset = DISK_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    invalidate();
    setCompare(false);
    setReqText(preset.requests.join(" "));
    setCylinders(preset.cylinders);
    setHead(preset.head);
    setDir(preset.dir);
    notify.info(preset.hint);
  };

  const randomize = () => {
    invalidate();
    const n = 6 + Math.floor(Math.random() * 4);
    const picked = new Set<number>();
    while (picked.size < n) picked.add(Math.floor(Math.random() * cylinders));
    setReqText([...picked].join(" "));
    setHead(Math.floor(Math.random() * cylinders));
  };

  // Comparison table: the same queue pushed through every algorithm.
  const comparison = useMemo(() => {
    if (!compare) return null;
    const { reqs } = parseRequests(reqText, cylinders);
    if (reqs.length === 0) return null;
    const spec = { cylinders, head, requests: reqs, dir };
    return DISK_ALGOS.map((a) => ({ meta: a, run: diskSchedule(a.key, spec) }));
  }, [compare, reqText, cylinders, head, dir]);

  const shown = run;
  const now = shown ? Math.min(tick, span) : 0;
  const finished = shown !== null && now >= span;
  const stepA = shown ? shown.steps[Math.min(now, shown.steps.length - 1)] : null;
  const note = shown
    ? runB
      ? finished
        ? `Race over: ${meta.short} total seek ${shown.totalSeek} vs ${metaB.short} ${runB.totalSeek} — ${
            shown.totalSeek === runB.totalSeek ? "a dead heat" : `${shown.totalSeek < runB.totalSeek ? meta.short : metaB.short} wins with less head movement`}.`
        : `move ${now}: ${meta.short} at cylinder ${shown.steps[Math.min(now, shown.steps.length - 1)].head} · ${metaB.short} at ${runB.steps[Math.min(now, runB.steps.length - 1)].head}.`
      : finished
        ? `${stepA?.note} Done: total head movement ${shown.totalSeek}, average seek ${shown.avgSeek.toFixed(2)} per request.`
        : stepA?.note ?? ""
    : meta.blurb;

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <label className="ds-mode">
          algorithm:
          <select value={algo} onChange={(e) => { setAlgo(e.target.value as DiskAlgo); invalidate(); }}>
            {DISK_ALGOS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </label>
        {(meta.usesDirection || (race && metaB.usesDirection)) && (
          <label className="ds-mode">
            heading:
            <select value={dir} onChange={(e) => { setDir(e.target.value as DiskDir); invalidate(); }}>
              <option value="up">↑ higher cylinders</option>
              <option value="down">↓ lower cylinders</option>
            </select>
          </label>
        )}
        <button className="primary" onClick={runNow}>
          <Play size={13} /> Seek
        </button>
        <button
          className={race ? "toggled" : ""}
          title="run a second algorithm on the same request queue, stacked under one scrubber"
          onClick={() => {
            setRace((r) => !r);
            invalidate();
            setCompare(false);
            setPredictOn(false);
          }}
        >
          <Swords size={13} /> Race
        </button>
        {race && (
          <label className="ds-mode">
            vs:
            <select value={algoB} onChange={(e) => { setAlgoB(e.target.value as DiskAlgo); invalidate(); }}>
              {DISK_ALGOS.map((a) => (
                <option key={a.key} value={a.key}>{a.short}</option>
              ))}
            </select>
          </label>
        )}
        {!race && (
          <button
            className={predictOn ? "toggled" : ""}
            title="pause before every head move and ask where the head goes next"
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
            setRace(false);
          }}
          title="run this queue through every algorithm and compare the seek totals"
        >
          <Scale size={13} /> Compare all
        </button>
        <label className="ds-mode">
          preset:
          <select value="" onChange={(e) => loadPreset(e.target.value)}>
            <option value="" disabled>pick a classic…</option>
            {DISK_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button onClick={randomize}><Shuffle size={13} /> Random</button>
        {run && (
          <>
            <button onClick={copyLink} title="copy a link that reopens this request queue and auto-runs">
              <Link2 size={13} /> Copy link
            </button>
            <button onClick={exportPng} title="download the head-movement chart as a PNG">
              <Download size={13} /> PNG
            </button>
          </>
        )}
        <button onClick={() => { setReqText(DEFAULT_PRESET.requests.join(" ")); setCylinders(DEFAULT_PRESET.cylinders); setHead(DEFAULT_PRESET.head); setDir("up"); invalidate(); setCompare(false); writeLabParam(null); }}>
          <RotateCcw size={13} aria-hidden="true" /> Reset
        </button>
      </div>

      <div className="sched-body">
        <section className="sched-procs">
          <div className="sched-section-head">
            <h3>Request queue</h3>
            <span className="sched-hint">
              cylinder numbers 0–{cylinders - 1}, up to {MAX_DISK_REQUESTS} requests, serviced conventions: SCAN/C-SCAN touch the rim, the C-SCAN/C-LOOK jump counts
            </span>
          </div>
          <input
            className="ds-input ref-input"
            value={reqText}
            aria-label="request queue"
            placeholder="e.g. 98 183 37 122 14 124 65 67"
            onChange={(e) => { setReqText(e.target.value); invalidate(); }}
            onKeyDown={(e) => { if (e.key === "Enter") runNow(); }}
          />
          <div className="sched-stats">
            <label className="ds-mode">
              cylinders:
              <input
                className="ds-input small"
                type="number"
                min={MIN_CYL}
                max={MAX_CYL}
                value={cylinders}
                onChange={(e) => { setCylinders(Math.trunc(Number(e.target.value)) || DEFAULT_CYL); invalidate(); }}
              />
            </label>
            <label className="ds-mode">
              head at:
              <input
                className="ds-input small"
                type="number"
                min={0}
                max={cylinders - 1}
                value={head}
                onChange={(e) => { setHead(Math.trunc(Number(e.target.value)) || 0); invalidate(); }}
              />
            </label>
          </div>
        </section>

        {compare && comparison && (
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>Every algorithm, same queue</h3>
              <span className="sched-hint">head at {head}, heading {dir} — least total head movement is marked</span>
            </div>
            <div className="sched-table-wrap">
              <table className="sched-table metrics">
                <thead>
                  <tr><th>algorithm</th><th>total seek</th><th>avg seek</th><th>service order</th></tr>
                </thead>
                <tbody>
                  {(() => {
                    const best = Math.min(...comparison.map((c) => c.run.totalSeek));
                    return comparison.map(({ meta: m, run: r }) => (
                      <tr key={m.key} className={r.totalSeek === best ? "best-row" : ""}>
                        <td>{m.short}</td>
                        <td>{r.totalSeek}</td>
                        <td>{r.avgSeek.toFixed(2)}</td>
                        <td className="disk-order">{r.order.join(" → ")}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            <p className="sched-hint">Pick an algorithm above and press Seek to watch the head move request by request.</p>
          </section>
        )}

        {shown && (
          <div className={runB ? "race-stack" : undefined}>
            <DiskChart run={shown} now={now} />
            {runB && <DiskChart run={runB} now={now} />}
          </div>
        )}

        {!shown && !compare && (
          <div className="sched-empty">
            <span className="empty-icon"><HardDrive size={20} aria-hidden="true" /></span>
            <p>Type a request queue, pick an algorithm, and press Seek — or load a preset built to provoke a classic exam question.</p>
          </div>
        )}
      </div>

      {quizAt !== null && quizByStep.has(quizAt) && (
        <QuizPanel
          quiz={quizByStep.get(quizAt)!}
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
        <span className="ds-teacher"><HardDrive size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {shown && (
          <div className="transport ds-transport">
            <button onClick={() => { dismissQuiz(); setTick(0); }} disabled={now === 0} title="restart" aria-label="Restart">
              <ChevronFirst size={16} aria-hidden="true" />
            </button>
            <button onClick={() => { dismissQuiz(); setTick((i) => Math.max(0, i - 1)); }} disabled={now === 0} title="previous move" aria-label="Previous move">
              <StepBack size={16} aria-hidden="true" />
            </button>
            <button className="play-btn" onClick={() => { if (now >= span) setTick(0); setPlaying(!playing); }} title="play / pause" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
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
              title="next move"
              aria-label="Next move"
            >
              <StepForward size={16} aria-hidden="true" />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={span}
              value={now}
              title="scrub through the moves"
              aria-label="scrub through the moves"
              onChange={(e) => { setPlaying(false); dismissQuiz(); setTick(Number(e.target.value)); }}
            />
            <SpeedSelect speed={speed} onChange={setSpeed} />
            <span className="step-counter">move {now} / {span}</span>
          </div>
        )}
      </div>
    </div>
  );
}
