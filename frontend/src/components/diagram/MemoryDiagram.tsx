import { ArrowDown, ArrowRight, Layers, MemoryStick } from "lucide-react";
import { useRef } from "react";
import { computeReturnInfo } from "../../hooks/useReturnInfo";
import { useCurrentStep, useTraceStore } from "../../store/traceStore";
import { ArrowLayer } from "./ArrowLayer";
import { HeapRegion } from "./HeapRegion";
import { StackFrame } from "./StackFrame";

// Python-Tutor-style split: the stack (frames) is the blue column on the
// left, the heap (objects) the amber column on the right, so pointers flow
// naturally left-to-right from variables into the objects they own.
export function MemoryDiagram() {
  const step = useCurrentStep();
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);
  const containerRef = useRef<HTMLDivElement>(null);
  // Innermost frame is first in the trace; draw outermost (main) at the top.
  const frames = step ? [...step.stack].reverse() : [];
  const activeFrameId = step?.stack[0]?.frameId ?? null;
  // On a return step, the value the collapsed frame handed back to the frame
  // now on top — shown as a bubble so recursion unwinding is legible.
  const returnInfo = computeReturnInfo(trace, currentStep);
  return (
    <div className="memory-diagram" ref={containerRef}>
      <div className="memory-region stack-region">
        <div className="region-header">
          <Layers size={13} aria-hidden="true" />
          <span>Stack</span>
          <span className="grow-hint">
            grows <ArrowDown size={11} aria-label="downward" />
          </span>
        </div>
        {frames.map((frame) => (
          <StackFrame
            key={frame.frameId}
            frame={frame}
            active={frame.frameId === activeFrameId}
            returnInfo={frame.frameId === activeFrameId ? returnInfo : null}
          />
        ))}
        {frames.length === 0 && <div className="empty-note">no active frames</div>}
      </div>
      <div className="memory-region heap-region-wrap">
        <div className="region-header">
          <MemoryStick size={13} aria-hidden="true" />
          <span>Heap</span>
          <span className="grow-hint">
            chains read <ArrowRight size={11} aria-label="forward" />
          </span>
        </div>
        <HeapRegion step={step} />
      </div>
      <ArrowLayer containerRef={containerRef} step={step} />
    </div>
  );
}
