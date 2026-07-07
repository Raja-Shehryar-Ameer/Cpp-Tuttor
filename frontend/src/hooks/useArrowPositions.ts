import { useLayoutEffect, useState, type RefObject } from "react";
import { collectPointers, getBox, purgeDisconnected } from "../store/boxRegistry";
import type { Step } from "../types/trace";

export interface Arrow {
  key: string;
  /** source anchor: right edge of the pointer cell */
  x1: number;
  y1: number;
  /** target anchor: right edge of the target box */
  x2: number;
  y2: number;
  /** x of the vertical gutter lane this arrow travels through */
  laneX: number;
  /** target freed — render red with a warning marker */
  danger: boolean;
  /** pointer belongs to a frame other than the active one — dim it */
  faded: boolean;
}

const LANE_GAP = 13; // px between adjacent gutter lanes
const LANE_PAD = 10; // min vertical clearance between arrows sharing a lane

interface Measured {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  danger: boolean;
  faded: boolean;
}

/**
 * All arrows travel through a vertical gutter to the right of the boxes:
 * out of the pointer cell, along a lane, then back into the target's right
 * edge. Lanes are packed greedily (shortest spans first) so no two arrows
 * overlap in the same lane and none pass through a box.
 */
function measure(container: HTMLElement, step: Step): Arrow[] {
  purgeDisconnected();
  const origin = container.getBoundingClientRect();
  const freed = new Set(step.heap.filter((h) => h.freed).map((h) => h.address));
  const activeFrameId = step.stack[0]?.frameId ?? null;

  const measured: Measured[] = [];
  // Lanes must clear the full card widths, not just the measured value cells.
  let contentRight = 0;
  for (const card of container.querySelectorAll(".stack-frame, .heap-object")) {
    contentRight = Math.max(contentRight, card.getBoundingClientRect().right - origin.left);
  }
  for (const pointer of collectPointers(step)) {
    if (!pointer.address) continue;
    const fromEl = getBox(pointer.address);
    if (!fromEl) continue;
    const from = fromEl.getBoundingClientRect();
    const x1 = from.right - origin.left;
    const y1 = from.top + from.height / 2 - origin.top;
    const faded =
      pointer.sourceFrameId !== null &&
      activeFrameId !== null &&
      pointer.sourceFrameId !== activeFrameId;
    // No box for the target (garbage or out-of-scope address): draw nothing.
    // Freed heap objects keep their boxes, so real dangling pointers still show.
    const toEl = getBox(pointer.target);
    if (!toEl) continue;
    const to = toEl.getBoundingClientRect();
    measured.push({
      x1,
      y1,
      x2: to.right - origin.left,
      y2: to.top + to.height / 2 - origin.top,
      danger: freed.has(pointer.target),
      faded,
    });
    contentRight = Math.max(contentRight, x1, to.right - origin.left);
  }

  // Assign gutter lanes: shortest vertical spans first so they hug the
  // content; longer arrows take outer lanes and never cross the short ones.
  const order = measured
    .map((m, index) => ({ m, index }))
    .sort((a, b) => Math.abs(a.m.y2 - a.m.y1) - Math.abs(b.m.y2 - b.m.y1));
  const lanes: { top: number; bottom: number }[][] = [];
  const laneBase = contentRight + 22;
  const laneOf = new Map<number, number>();
  for (const { m, index } of order) {
    const top = Math.min(m.y1, m.y2) - LANE_PAD;
    const bottom = Math.max(m.y1, m.y2) + LANE_PAD;
    let lane = lanes.findIndex((slots) =>
      slots.every((s) => bottom < s.top || top > s.bottom),
    );
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
