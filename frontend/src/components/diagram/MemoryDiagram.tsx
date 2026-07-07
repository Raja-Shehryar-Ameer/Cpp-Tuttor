import { ArrowDown, ArrowUp, Layers, MemoryStick } from "lucide-react";
import { useRef } from "react";
import { useCurrentStep } from "../../store/traceStore";
import { ArrowLayer } from "./ArrowLayer";
import { HeapRegion } from "./HeapRegion";
import { StackFrame } from "./StackFrame";

// One memory column, mirroring a process address space: the stack sits at the
// top and grows downward as calls deepen; the heap is anchored to the bottom
// and grows upward as objects are allocated.
export function MemoryDiagram() {
  const step = useCurrentStep();
  const containerRef = useRef<HTMLDivElement>(null);
  // Innermost frame is first in the trace; draw outermost (main) at the top.
  const frames = step ? [...step.stack].reverse() : [];
  const activeFrameId = step?.stack[0]?.frameId ?? null;
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
          />
        ))}
        {frames.length === 0 && <div className="empty-note">no active frames</div>}
      </div>
      <div className="region-spacer" aria-hidden="true" />
      <div className="memory-region heap-region-wrap">
        <HeapRegion objects={step?.heap ?? []} />
        <div className="region-header">
          <MemoryStick size={13} aria-hidden="true" />
          <span>Heap</span>
          <span className="grow-hint">
            grows <ArrowUp size={11} aria-label="upward" />
          </span>
        </div>
      </div>
      <ArrowLayer containerRef={containerRef} step={step} />
    </div>
  );
}
