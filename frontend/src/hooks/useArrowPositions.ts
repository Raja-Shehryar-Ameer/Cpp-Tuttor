import { useLayoutEffect, useState, type RefObject } from "react";
import { collectPointers, getBox, purgeDisconnected } from "../store/boxRegistry";
import type { Step } from "../types/trace";

export type ArrowKind = "forward" | "lane" | "laneTop";

export interface Arrow {
  key: string;
  kind: ArrowKind;
  /** source anchor: right edge of the pointer cell */
  x1: number;
  y1: number;
  /** entry point on the target: left edge (forward), right edge (lane), or top (laneTop) */
  x2: number;
  y2: number;
  /** x of the vertical gutter lane (lane kinds only) */
  laneX: number;
  /** y of the horizontal approach run above the target row (laneTop only) */
  gapY: number;
  /** target freed — render red with a warning marker */
  danger: boolean;
  /** pointer belongs to a frame other than the active one — dim it */
  faded: boolean;
}

const LANE_GAP = 13; // px between adjacent gutter lanes
const LANE_PAD = 10; // min vertical clearance between arrows sharing a lane
const FORWARD_MAX_DY = 70; // beyond this a same-direction target is not "in the row"

type Measured = Omit<Arrow, "key" | "laneX">;

/**
 * Routing rules, all collision-free with boxes:
 * - "forward": target sits to the right in (roughly) the same row — a plain
 *   bezier into its LEFT edge, the natural linked-list look.
 * - "lane": target in the stack — out to a right-hand gutter lane, back into
 *   the target's RIGHT edge (nothing sits right of a stack frame).
 * - "laneTop": target in the heap but not forward — gutter lane, then along
 *   the empty gap above the target's row, entering its TOP edge.
 * Lanes are packed greedily (shortest spans first) so arrows never overlap.
 */
function measure(container: HTMLElement, step: Step): Arrow[] {
  purgeDisconnected();
  const origin = container.getBoundingClientRect();
  const freed = new Set(step.heap.filter((h) => h.freed).map((h) => h.address));
  const activeFrameId = step.stack[0]?.frameId ?? null;

  // Lanes must clear the full card widths, not just the measured value cells.
  let contentRight = 0;
  for (const card of container.querySelectorAll(".stack-frame, .heap-object")) {
    contentRight = Math.max(contentRight, card.getBoundingClientRect().right - origin.left);
  }

  const measured: Measured[] = [];
  for (const pointer of collectPointers(step)) {
    if (!pointer.address) continue;
    const fromEl = getBox(pointer.address);
    if (!fromEl) continue;
    // No box for the target (garbage or out-of-scope address): draw nothing.
    // Freed heap objects keep their boxes, so real dangling pointers still show.
    const toEl = getBox(pointer.target);
    if (!toEl) continue;

    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const x1 = from.right - origin.left;
    const y1 = from.top + from.height / 2 - origin.top;
    const toLeft = to.left - origin.left;
    const toRight = to.right - origin.left;
    const toTop = to.top - origin.top;
    const toCy = toTop + to.height / 2;
    const danger = freed.has(pointer.target);
    const faded =
      pointer.sourceFrameId !== null &&
      activeFrameId !== null &&
      pointer.sourceFrameId !== activeFrameId;

    if (toLeft > x1 + 14 && Math.abs(toCy - y1) < FORWARD_MAX_DY) {
      measured.push({ kind: "forward", x1, y1, x2: toLeft - 2, y2: toCy, gapY: 0, danger, faded });
    } else if (!toEl.closest(".heap-region")) {
      measured.push({ kind: "lane", x1, y1, x2: toRight + 2, y2: toCy, gapY: 0, danger, faded });
    } else {
      const entryX = toLeft + Math.min(22, to.width / 2);
      measured.push({
        kind: "laneTop",
        x1,
        y1,
        x2: entryX,
        y2: toTop - 2,
        gapY: toTop - 12,
        danger,
        faded,
      });
    }
    contentRight = Math.max(contentRight, x1, toRight);
  }

  // Assign gutter lanes: shortest vertical spans first so they hug the
  // content; longer arrows take outer lanes and never cross the short ones.
  const order = measured
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.kind !== "forward")
    .sort((a, b) => laneSpan(a.m) - laneSpan(b.m));
  const lanes: { top: number; bottom: number }[][] = [];
  const laneBase = contentRight + 22;
  const laneOf = new Map<number, number>();
  for (const { m, index } of order) {
    const end = m.kind === "laneTop" ? m.gapY : m.y2;
    const top = Math.min(m.y1, end) - LANE_PAD;
    const bottom = Math.max(m.y1, end) + LANE_PAD;
    let lane = lanes.findIndex((slots) => slots.every((s) => bottom < s.top || top > s.bottom));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push({ top, bottom });
    laneOf.set(index, lane);
  }

  return measured.map((m, index) => ({
    key: `a${index}`,
    ...m,
    laneX: laneBase + (laneOf.get(index) ?? 0) * LANE_GAP,
  }));
}

function laneSpan(m: Measured): number {
  const end = m.kind === "laneTop" ? m.gapY : m.y2;
  return Math.abs(end - m.y1);
}

export function useArrowPositions(
  containerRef: RefObject<HTMLElement | null>,
  step: Step | null,
): Arrow[] {
  const [arrows, setArrows] = useState<Arrow[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !step) {
      setArrows([]);
      return;
    }
    const update = () => setArrows(measure(container, step));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    container.addEventListener("scroll", update, true);
    // Boxes animate into place on mount; re-measure once they settle.
    container.addEventListener("animationend", update, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update, true);
      container.removeEventListener("animationend", update, true);
    };
  }, [containerRef, step]);

  return arrows;
}
