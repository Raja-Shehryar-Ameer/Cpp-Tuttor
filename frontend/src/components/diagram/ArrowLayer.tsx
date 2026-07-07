import { TriangleAlert } from "lucide-react";
import type { RefObject } from "react";
import { useArrowPositions, type Arrow } from "../../hooks/useArrowPositions";
import type { Step } from "../../types/trace";

// Rounded orthogonal route: out of the pointer cell, through the arrow's
// gutter lane, then back into the target's right edge.
function path(a: Arrow): string {
  if (a.stub) return `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
  const dy = a.y2 - a.y1;
  const dir = dy >= 0 ? 1 : -1;
  const r = Math.min(12, Math.abs(dy) / 2);
  return [
    `M ${a.x1} ${a.y1}`,
    `L ${a.laneX - r} ${a.y1}`,
    `Q ${a.laneX} ${a.y1} ${a.laneX} ${a.y1 + dir * r}`,
    `L ${a.laneX} ${a.y2 - dir * r}`,
    `Q ${a.laneX} ${a.y2} ${a.laneX - r} ${a.y2}`,
    `L ${a.x2 + 3} ${a.y2}`,
  ].join(" ");
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
        <g
          key={arrow.key}
          className={`arrow${arrow.danger ? " danger" : ""}${arrow.faded ? " faded" : ""}`}
        >
          <path
            d={path(arrow)}
            markerEnd={arrow.danger ? "url(#arrow-bad)" : "url(#arrow-ok)"}
          />
          {arrow.danger && (
            <TriangleAlert
              className="arrow-warning-icon"
              size={12}
              x={arrow.stub ? arrow.x2 + 4 : arrow.laneX + 5}
              y={arrow.y2 - 6}
            />
          )}
        </g>
      ))}
    </svg>
  );
}
