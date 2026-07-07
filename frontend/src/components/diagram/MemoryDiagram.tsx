import { useRef } from "react";
import { useCurrentStep } from "../../store/traceStore";
import { ArrowLayer } from "./ArrowLayer";
import { HeapRegion } from "./HeapRegion";
import { StackFrame } from "./StackFrame";

export function MemoryDiagram() {
  const step = useCurrentStep();
  const containerRef = useRef<HTMLDivElement>(null);
  // Innermost frame is first in the trace; draw outermost (main) at the top.
  const frames = step ? [...step.stack].reverse() : [];
  return (
    <div className="memory-diagram" ref={containerRef}>
      <div className="diagram-column">
        <h3>Stack</h3>
        {frames.map((frame) => (
          <StackFrame
            key={frame.frameId}
            frame={frame}
            active={frame === frames[frames.length - 1]}
          />
        ))}
        {frames.length === 0 && <div className="empty-note">no active frames</div>}
      </div>
      <div className="diagram-column">
        <h3>Heap</h3>
        <HeapRegion objects={step?.heap ?? []} />
      </div>
      <ArrowLayer containerRef={containerRef} step={step} />
    </div>
  );
}
