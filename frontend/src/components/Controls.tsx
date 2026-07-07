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
      else if (event.key === " ") setPlaying(!useTraceStore.getState().playing);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trace, stepForward, stepBack, setPlaying]);

  if (!trace || total === 0) return null;

  return (
    <div className="controls">
      <button onClick={() => setPlaying(!playing)} title="space">
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={stepBack} disabled={currentStep === 0} title="←">
        ◀ prev
      </button>
      <button onClick={stepForward} disabled={currentStep >= total - 1} title="→">
        next ▶
      </button>
      <input
        type="range"
        min={0}
        max={total - 1}
        value={currentStep}
        onChange={(e) => setStep(Number(e.target.value))}
      />
      <span className="step-counter">
        step {currentStep + 1} / {total}
      </span>
      {step && <span className={`event-badge event-${step.event}`}>{step.event}</span>}
      <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))}>
        {SPEEDS.map(([label, ms]) => (
          <option key={ms} value={ms}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
