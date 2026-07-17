import {
  ChevronFirst,
  ChevronLast,
  MapPin,
  Pause,
  Play,
  StepBack,
  StepForward,
} from "lucide-react";
import { useEffect } from "react";
import { useTraceStore } from "../store/traceStore";

const SPEEDS: [label: string, ms: number][] = [
  ["slow", 1500],
  ["normal", 800],
  ["fast", 300],
];

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || !!target.closest(".cm-editor"))
  );
}

export function Controls() {
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);
  const playing = useTraceStore((s) => s.playing);
  const speedMs = useTraceStore((s) => s.speedMs);
  const { setStep, stepForward, stepBack, setPlaying, setSpeedMs } = useTraceStore();

  const total = trace?.steps.length ?? 0;
  const step = trace?.steps[currentStep];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!trace || isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight") stepForward();
      else if (event.key === "ArrowLeft") stepBack();
      else if (event.key === "Home") setStep(0);
      else if (event.key === "End") setStep(Number.MAX_SAFE_INTEGER);
      else if (event.key === " ") setPlaying(!useTraceStore.getState().playing);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trace, stepForward, stepBack, setPlaying, setStep]);

  if (!trace || total === 0) return null;

  const atStart = currentStep === 0;
  const atEnd = currentStep >= total - 1;

  return (
    <div className="controls">
      <div className="transport">
        <button
          onClick={() => setStep(0)}
          disabled={atStart}
          title="First step (Home)"
          aria-label="First step"
        >
          <ChevronFirst size={16} aria-hidden="true" />
        </button>
        <button onClick={stepBack} disabled={atStart} title="Previous step (←)" aria-label="Previous step">
          <StepBack size={16} aria-hidden="true" />
        </button>
        <button
          className="play-btn"
          onClick={() => setPlaying(!playing)}
          title="Play / pause (space)"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <button onClick={stepForward} disabled={atEnd} title="Next step (→)" aria-label="Next step">
          <StepForward size={16} aria-hidden="true" />
        </button>
        <button
          onClick={() => setStep(Number.MAX_SAFE_INTEGER)}
          disabled={atEnd}
          title="Last step (End)"
          aria-label="Last step"
        >
          <ChevronLast size={16} aria-hidden="true" />
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={total - 1}
        value={currentStep}
        onChange={(e) => setStep(Number(e.target.value))}
        aria-label="step slider"
        // Fill the track up to the thumb so progress reads at a glance.
        style={{
          background: `linear-gradient(to right, var(--accent) ${
            total > 1 ? (currentStep / (total - 1)) * 100 : 0
          }%, var(--border) 0)`,
        }}
      />
      <span className="step-counter">
        step {currentStep + 1} / {total}
      </span>
      {step && <span className={`event-badge event-${step.event}`}>{step.event}</span>}
      {step && (
        <span className="location">
          <MapPin size={12} aria-hidden="true" />
          <code>{step.functionName}()</code> · line {step.line}
        </span>
      )}
      <select
        value={speedMs}
        onChange={(e) => setSpeedMs(Number(e.target.value))}
        title="playback speed"
        aria-label="playback speed"
      >
        {SPEEDS.map(([label, ms]) => (
          <option key={ms} value={ms}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
