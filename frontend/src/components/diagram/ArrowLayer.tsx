import type { RefObject } from "react";
import { useArrowPositions, type Arrow } from "../../hooks/useArrowPositions";
import type { Step } from "../../types/trace";

function path(a: Arrow): string {
  const bend = Math.max(28, Math.abs(a.x2 - a.x1) / 2);
  return `M ${a.x1} ${a.y1} C ${a.x1 + bend} ${a.y1}, ${a.x2 - bend} ${a.y2}, ${a.x2} ${a.y2}`;
}

export function ArrowLayer({
  containerRef,
  step,
}: {
  containerRef: RefObject<HTMLElement | null>;
  step: Step | null;
}) {
  const arrows = useArrowPositions(containerRef, step);
  return (
    <svg className="arrow-layer" aria-hidden="true">
      <defs>
        <marker id="arrow-ok" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" className="arrow-head-ok" />
        </marker>
        <marker id="arrow-bad" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" className="arrow-head-bad" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <g key={arrow.key} className={arrow.danger ? "arrow danger" : "arrow"}>
          <path
            d={path(arrow)}
            markerEnd={arrow.danger ? "url(#arrow-bad)" : "url(#arrow-ok)"}
          />
          {arrow.danger && (
            <text x={arrow.x2 + 4} y={arrow.y2 + 4} className="arrow-warning">
              ⚠
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
