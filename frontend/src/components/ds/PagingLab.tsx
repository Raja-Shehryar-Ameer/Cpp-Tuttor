import {
  ChevronFirst,
  Gauge,
  MemoryStick,
  Pause,
  Play,
  Scale,
  Shuffle,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MAX_FRAMES,
  MAX_PAGE,
  MAX_REFS,
  PAGE_ALGOS,
  PAGE_PRESETS,
  pageReplace,
  type PageAlgo,
  type PageRun,
} from "../../ds/paging";
import { notify } from "../../store/toastStore";

// Page chips reuse the scheduler's warm process palette (.pc-0 … .pc-7),
// keyed by page number so page 7 is the same color everywhere it appears.
const chipOf = (page: number): string => `pc-${((page % 8) + 8) % 8}`;

const SPEEDS = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
];

const DEFAULT_REFS = PAGE_PRESETS[0].refs.join(" ");

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

export function PagingLab() {
  const [refText, setRefText] = useState(DEFAULT_REFS);
  const [algo, setAlgo] = useState<PageAlgo>("fifo");
  const [frameCount, setFrameCount] = useState(3);
  const [run, setRun] = useState<PageRun | null>(null);
  const [tick, setTick] = useState(0); // 0 = before the first reference
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);

  const meta = PAGE_ALGOS.find((a) => a.key === algo)!;

  useEffect(() => {
    if (!playing || !run) return;
    const t = window.setInterval(() => {
      setTick((i) => {
        if (i + 1 > run.steps.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
  }, [playing, run, speed]);

  const invalidate = () => {
    setRun(null);
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
    setTick(0);
    setPlaying(true);
    setCompare(false);
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
  const note = shown
    ? step
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
        <button onClick={() => { setRefText(DEFAULT_REFS); setFrameCount(3); invalidate(); setCompare(false); }}>
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
          <section className="sched-results">
            <div className="sched-section-head">
              <h3>Frames over time — {meta.short}</h3>
              <span className="sched-hint">each column is memory AFTER that reference · ref {now} / {shown.steps.length}</span>
            </div>
            <div className="page-grid-wrap">
              <table className="page-grid">
                <thead>
                  <tr>
                    <th className="pg-label">ref</th>
                    {shown.steps.map((s, j) => (
                      <th key={j} className={j >= now ? "future" : j === now - 1 ? "current-col" : ""}>
                        <span className={`proc-chip ${chipOf(s.page)}`}>{s.page}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: shown.frameCount }, (_, slot) => (
                    <tr key={slot}>
                      <th className="pg-label">f{slot}</th>
                      {shown.steps.map((s, j) => {
                        const cls = [
                          j >= now ? "future" : "",
                          j === now - 1 ? "current-col" : "",
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
                    {shown.steps.map((s, j) => (
                      <td key={j} className={`${s.hit ? "pg-hit" : "pg-fault"}${j >= now ? " future" : ""}`}>
                        {s.hit ? "H" : "F"}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="sched-live">
              <span className="sched-live-label">memory now</span>
              {(step?.frames ?? Array.from({ length: shown.frameCount }, () => null)).map((p, k) => (
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

            <div className="sched-stats">
              <span className="ds-chip">page faults {shown.faults}</span>
              <span className="ds-chip">hits {shown.hits}</span>
              <span className="ds-chip">hit ratio {(shown.hitRatio * 100).toFixed(1)}%</span>
              <span className="ds-chip">fault ratio {((1 - shown.hitRatio) * 100).toFixed(1)}%</span>
              <span className="ds-chip">hit ratio = hits ÷ references</span>
            </div>
          </section>
        )}

        {!shown && !compare && (
          <div className="sched-empty">
            <span className="empty-icon"><MemoryStick size={20} aria-hidden="true" /></span>
            <p>Type a reference string, pick frames and an algorithm, then press Run — or load a preset built to provoke a classic exam question.</p>
          </div>
        )}
      </div>

      <div className="ds-caption">
        <span className="ds-teacher"><MemoryStick size={16} aria-hidden="true" /></span>
        <p key={note} className="ds-note">{note}</p>
        {shown && (
          <div className="transport ds-transport">
            <button onClick={() => setTick(0)} disabled={now === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => setTick((i) => Math.max(0, i - 1))} disabled={now === 0} title="previous reference">
              <StepBack size={15} />
            </button>
            <button
              className="play-btn"
              onClick={() => { if (now >= shown.steps.length) setTick(0); setPlaying(!playing); }}
              title="play / pause"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={() => setTick((i) => Math.min(shown.steps.length, i + 1))} disabled={now >= shown.steps.length} title="next reference">
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={shown.steps.length}
              value={now}
              title="scrub through the reference string"
              onChange={(e) => { setPlaying(false); setTick(Number(e.target.value)); }}
            />
            <button className="speed-btn" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} title="playback speed">
              <Gauge size={13} /> {SPEEDS[speed].label}
            </button>
            <span className="step-counter">ref {now} / {shown.steps.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
