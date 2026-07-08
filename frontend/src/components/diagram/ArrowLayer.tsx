import { TriangleAlert } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useArrowPositions, type Arrow } from "../../hooks/useArrowPositions";
import type { Step } from "../../types/trace";

// "forward": plain bezier into the target's left edge (chain look).
// "down": drop corridor just past the source, along the gap above the
// target's row, into its top edge — heap targets below the source.
// "lane": rounded orthogonal via a gutter lane into the target's right edge.
// "laneTop": gutter lane, then along the gap above the target's row and down
// into its top edge — used for backward heap pointers.
function path(a: Arrow): string {
  if (a.kind === "forward") {
    const bend = Math.max(22, (a.x2 - a.x1) / 2);
    return `M ${a.x1} ${a.y1} C ${a.x1 + bend} ${a.y1}, ${a.x2 - bend} ${a.y2}, ${a.x2} ${a.y2}`;
  }
  if (a.kind === "down") {
    const r = Math.min(12, Math.max(1, (a.gapY - a.y1) / 2), Math.max(1, a.laneX - a.x1));
    const dirH = a.x2 >= a.laneX ? 1 : -1; // which way the gap run heads
    const r2 = Math.min(10, Math.abs(a.x2 - a.laneX) / 2);
    const yIn = Math.min(a.gapY + r2, a.y2);
    return [
      `M ${a.x1} ${a.y1}`,
      `L ${a.laneX - r} ${a.y1}`,
      `Q ${a.laneX} ${a.y1} ${a.laneX} ${a.y1 + r}`,
      `L ${a.laneX} ${a.gapY - r2}`,
      `Q ${a.laneX} ${a.gapY} ${a.laneX + dirH * r2} ${a.gapY}`,
      `L ${a.x2 - dirH * r2} ${a.gapY}`,
      `Q ${a.x2} ${a.gapY} ${a.x2} ${yIn}`,
      `L ${a.x2} ${a.y2}`,
    ].join(" ");
  }
  if (a.kind === "lane") {
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
  // laneTop
  const dir = a.gapY >= a.y1 ? 1 : -1;
  const r = Math.min(12, Math.abs(a.gapY - a.y1) / 2 || 1);
  const rIn = Math.min(10, (a.laneX - a.x2) / 2, a.y2 - a.gapY + 10);
  return [
    `M ${a.x1} ${a.y1}`,
    `L ${a.laneX - r} ${a.y1}`,
    `Q ${a.laneX} ${a.y1} ${a.laneX} ${a.y1 + dir * r}`,
    `L ${a.laneX} ${a.gapY - dir * r}`,
    `Q ${a.laneX} ${a.gapY} ${a.laneX - r} ${a.gapY}`,
    `L ${a.x2 + rIn} ${a.gapY}`,
    `Q ${a.x2} ${a.gapY} ${a.x2} ${a.gapY + rIn}`,
    `L ${a.x2} ${a.y2}`,
  ].join(" ");
}

function warnPos(a: Arrow): { x: number; y: number } {
  if (a.kind === "forward") return { x: a.x2 + 2, y: a.y2 - 6 };
  if (a.kind === "lane") return { x: a.laneX + 5, y: a.y2 - 6 };
  return { x: a.x2 + 8, y: a.gapY - 14 };
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
      {arrows.map((arrow) => {
        const d = path(arrow);
        const warn = warnPos(arrow);
        return (
          <g
            key={arrow.key}
            className={`arrow${arrow.danger ? " danger" : ""}${arrow.faded ? " faded" : ""}`}
          >
            <path
              d={d}
              // style.d transitions smoothly in Chromium; attribute is the fallback
              style={{ d: `path("${d}")` } as CSSProperties}
              markerEnd={arrow.danger ? "url(#arrow-bad)" : "url(#arrow-ok)"}
            />
            {arrow.danger && (
              <TriangleAlert className="arrow-warning-icon" size={12} x={warn.x} y={warn.y} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
