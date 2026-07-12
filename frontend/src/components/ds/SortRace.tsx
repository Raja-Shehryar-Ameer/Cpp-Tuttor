// Sorting Race: two algorithms, the same array, two panes stepping in
// lockstep under ONE shared cursor — with live comparison/swap counters read
// straight off each frame's cumulative stats.

import {
  ChevronFirst,
  Flag,
  Gauge,
  Pause,
  Play,
  Shuffle,
  StepBack,
  StepForward,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  arrayPush,
  sortBubble,
  sortHeap,
  sortInsertion,
  sortMerge,
  sortQuick,
  sortSelection,
  type DSData,
  type Frame,
  type ListNode,
} from "../../ds/engine";
import { notify } from "../../store/toastStore";
import { DSView } from "./DSView";

export type SortKey = "bubble" | "insertion" | "selection" | "merge" | "quick" | "heap";

export const RACE_SORTS: { key: SortKey; label: string; big: string; fn: (d: { items: ListNode[] }) => Frame[] }[] = [
  { key: "bubble", label: "Bubble", big: "O(n²)", fn: sortBubble },
  { key: "insertion", label: "Insertion", big: "O(n²)", fn: sortInsertion },
  { key: "selection", label: "Selection", big: "O(n²)", fn: sortSelection },
  { key: "merge", label: "Merge", big: "O(n log n)", fn: sortMerge },
  { key: "quick", label: "Quick", big: "O(n log n) avg", fn: sortQuick },
  { key: "heap", label: "Heap", big: "O(n log n)", fn: sortHeap },
];

export const MAX_RACE_VALUES = 16;

const SPEEDS = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
];

const DEFAULT_VALUES = "29, 5, 17, 3, 42, 11, 8, 36";

function parseValues(raw: string): { values: number[]; bad: string[] } {
  const values: number[] = [];
  const bad: string[] = [];
  for (const token of raw.split(/[\s,;]+/).filter((t) => t.length > 0)) {
    const n = Number(token);
    if (Number.isInteger(n) && n >= -999 && n <= 9999) values.push(n);
    else bad.push(token);
  }
  return { values, bad };
}

interface Lane {
  key: SortKey;
  frames: Frame[];
}

export function SortRace({ initial }: { initial?: { a: SortKey; b: SortKey; values: number[] } }) {
  const [valueText, setValueText] = useState(initial ? initial.values.join(", ") : DEFAULT_VALUES);
  const [algoA, setAlgoA] = useState<SortKey>(initial?.a ?? "bubble");
  const [algoB, setAlgoB] = useState<SortKey>(initial?.b ?? "merge");
  const [lanes, setLanes] = useState<[Lane, Lane] | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const total = lanes ? Math.max(lanes[0].frames.length, lanes[1].frames.length) : 0;

  const idxRef = useRef(idx);
  idxRef.current = idx;

  useEffect(() => {
    if (!playing || !lanes) return;
    const t = window.setInterval(() => {
      const next = idxRef.current + 1;
      if (next >= total) {
        setPlaying(false);
        return;
      }
      setIdx(next);
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
  }, [playing, lanes, total, speed]);

  const race = () => {
    const { values, bad } = parseValues(valueText);
    if (bad.length > 0) {
      notify.error(`Values are whole numbers -999 to 9999 — I can't read ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}.`);
      return;
    }
    if (values.length < 2) {
      notify.error("A race needs at least 2 values.");
      return;
    }
    if (values.length > MAX_RACE_VALUES) {
      notify.error(`Up to ${MAX_RACE_VALUES} values — two panes need room to breathe.`);
      return;
    }
    if (algoA === algoB) {
      notify.warning("Racing an algorithm against itself is a guaranteed tie — pick two different ones.");
      return;
    }
    // Build one array through the real op so both lanes share ids; each sort
    // deep-clones internally, so the lanes never interfere.
    let d: DSData = { kind: "array", items: [] };
    for (const v of values) {
      const frames = arrayPush(d as { items: ListNode[] }, v);
      d = frames[frames.length - 1].data;
    }
    const mk = (key: SortKey): Lane => ({ key, frames: RACE_SORTS.find((s) => s.key === key)!.fn(d as { items: ListNode[] }) });
    setLanes([mk(algoA), mk(algoB)]);
    setIdx(0);
    setPlaying(true);
  };

  const randomize = () => {
    const pool = new Set<number>();
    while (pool.size < 10) pool.add(1 + Math.floor(Math.random() * 99));
    setValueText([...pool].join(", "));
    setLanes(null);
    setPlaying(false);
  };

  // auto-run a permalink payload once on mount
  const autoRan = useRef(false);
  useEffect(() => {
    if (initial && !autoRan.current) {
      autoRan.current = true;
      race();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const winner = (): string | null => {
    if (!lanes || idx < total - 1) return null;
    const [a, b] = lanes;
    if (a.frames.length === b.frames.length) return null;
    return RACE_SORTS.find((s) => s.key === (a.frames.length < b.frames.length ? a.key : b.key))!.label;
  };

  const pane = (lane: Lane) => {
    const meta = RACE_SORTS.find((s) => s.key === lane.key)!;
    const shownIdx = Math.min(idx, lane.frames.length - 1);
    const frame = lane.frames[shownIdx];
    const finished = idx >= lane.frames.length - 1;
    return (
      <section className="race-pane" key={lane.key}>
        <div className="race-pane-head">
          <h3>{meta.label} sort</h3>
          <span className="ds-chip">{meta.big}</span>
          {frame.stats && (
            <>
              <span className="ds-chip">{frame.stats.comparisons} comparisons</span>
              <span className="ds-chip">{frame.stats.swaps} swaps</span>
            </>
          )}
          {finished && (
            <span className="ds-chip race-done">
              <Flag size={11} aria-hidden="true" /> done in {lane.frames.length - 1} steps
            </span>
          )}
        </div>
        <div className="race-canvas">
          <DSView frame={frame} />
        </div>
        <p className="race-note">{frame.note}</p>
      </section>
    );
  };

  const champion = winner();

  return (
    <div className="sched-lab">
      <div className="ds-opbar sched-bar">
        <input
          className="ds-input ref-input"
          value={valueText}
          placeholder={DEFAULT_VALUES}
          onChange={(e) => { setValueText(e.target.value); setLanes(null); setPlaying(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") race(); }}
        />
        <label className="ds-mode">
          left:
          <select value={algoA} onChange={(e) => { setAlgoA(e.target.value as SortKey); setLanes(null); }}>
            {RACE_SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <span className="sched-hint">vs</span>
        <label className="ds-mode">
          right:
          <select value={algoB} onChange={(e) => { setAlgoB(e.target.value as SortKey); setLanes(null); }}>
            {RACE_SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={race}>
          <Zap size={13} /> Race
        </button>
        <button onClick={randomize}><Shuffle size={13} /> Random</button>
      </div>

      <div className="sched-body">
        {champion && (
          <div className="race-banner">
            <Flag size={15} aria-hidden="true" />
            {champion} sort finished first on this input — fewer steps, not necessarily fewer of BOTH ops. Check the counters.
          </div>
        )}
        {lanes ? (
          <div className="race-grid">
            {pane(lanes[0])}
            {pane(lanes[1])}
          </div>
        ) : (
          <div className="sched-empty">
            <span className="empty-icon"><Zap size={20} aria-hidden="true" /></span>
            <p>Type some values, pick two algorithms, and press Race — both sort the SAME array in lockstep while the counters keep score.</p>
          </div>
        )}
      </div>

      <div className="ds-caption">
        <span className="ds-teacher"><Zap size={16} aria-hidden="true" /></span>
        <p className="ds-note">
          {lanes
            ? `Step ${Math.min(idx + 1, total)} / ${total} — a "step" is one narrated micro-action; the pane that runs out of steps first sorted first.`
            : "Same input, two strategies — the counters make the O(n²) vs O(n log n) gap concrete."}
        </p>
        {lanes && (
          <div className="transport ds-transport">
            <button onClick={() => setIdx(0)} disabled={idx === 0} title="restart">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} title="previous step">
              <StepBack size={15} />
            </button>
            <button className="play-btn" onClick={() => { if (idx >= total - 1) setIdx(0); setPlaying(!playing); }} title="play / pause">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} disabled={idx >= total - 1} title="next step">
              <StepForward size={15} />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={total - 1}
              value={idx}
              title="scrub both panes"
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
            />
            <button className="speed-btn" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} title="playback speed">
              <Gauge size={13} /> {SPEEDS[speed].label}
            </button>
            <span className="step-counter">{Math.min(idx + 1, total)} / {total}</span>
          </div>
        )}
      </div>
    </div>
  );
}
