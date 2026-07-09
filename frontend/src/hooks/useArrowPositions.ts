import { useLayoutEffect, useState, type RefObject } from "react";
import { collectPointers, getBox, purgeDisconnected } from "../store/boxRegistry";
import type { Step } from "../types/trace";

export type ArrowKind = "forward" | "backward" | "lane" | "laneTop" | "down";

export interface Arrow {
  key: string;
  kind: ArrowKind;
  /** source anchor: right edge of the pointer cell (left edge for "backward") */
  x1: number;
  y1: number;
  /** entry point on the target: left edge (forward), right edge (backward/lane), or top (laneTop/down) */
  x2: number;
  y2: number;
  /** x of the vertical run: gutter lane (lane kinds) or drop corridor (down) */
  laneX: number;
  /** y of the horizontal approach run above the target row (laneTop/down only) */
  gapY: number;
  /** target freed — render red with a warning marker */
  danger: boolean;
  /** pointer belongs to a frame other than the active one — dim it */
  faded: boolean;
}

const LANE_GAP = 13; // px between adjacent gutter lanes
const LANE_PAD = 10; // min vertical clearance between arrows sharing a lane
const FORWARD_MAX_DY = 70; // beyond this a same-direction target is not "in the row"

type Measured = Omit<Arrow, "key" | "laneX"> & { laneX?: number };

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Routing rules, all collision-free with boxes and independent of what the
 * data structure is — only geometry decides:
 * - "forward": target sits to the right in (roughly) the same row — a plain
 *   bezier into its LEFT edge, the natural chain look.
 * - "backward": target sits to the left in the same row (a serpentine
 *   right-to-left row) — the mirror bezier, leaving the pointer cell's LEFT
 *   edge into the target's RIGHT edge.
 * - "down": target sits below (stack pointer into the heap, or a chain that
 *   wrapped to the next row) — drop through the nearest clear vertical
 *   corridor, run along the gap above the target's row, enter its TOP edge.
 * - "lane": target in the stack — out to a right-hand gutter lane, back into
 *   the target's RIGHT edge (nothing sits right of a stack frame).
 * - "laneTop": target in the heap but not reachable by a straight run (above
 *   the source, or a same-row shot with another card in the way) — gutter
 *   lane, then along the gap above the target's row into its TOP.
 * Gutter lanes are packed greedily (shortest spans first); drop corridors
 * slide right past any card or other corridor they would hit.
 */
function measure(container: HTMLElement, step: Step): Arrow[] {
  purgeDisconnected();
  const origin = container.getBoundingClientRect();
  const freed = new Set(step.heap.filter((h) => h.freed).map((h) => h.address));
  const activeFrameId = step.stack[0]?.frameId ?? null;

  // Card rectangles double as the obstacle map for straight runs & corridors.
  const cards: { el: Element; rect: Rect }[] = [];
  let contentRight = 0;
  for (const card of container.querySelectorAll(".stack-frame, .heap-object")) {
    const r = card.getBoundingClientRect();
    const rect = {
      left: r.left - origin.left,
      right: r.right - origin.left,
      top: r.top - origin.top,
      bottom: r.bottom - origin.top,
    };
    cards.push({ el: card, rect });
    contentRight = Math.max(contentRight, rect.right);
  }

  // A straight (bezier) run is only allowed when no third card sits inside
  // the horizontal span crossed at the height band the curve sweeps through.
  const blocked = (fromCard: Element | null, toCard: Element | null, xa: number, xb: number, ya: number, yb: number): boolean => {
    const lo = Math.min(xa, xb) + 4;
    const hi = Math.max(xa, xb) - 4;
    const top = Math.min(ya, yb) - 6;
    const bottom = Math.max(ya, yb) + 6;
    return cards.some(
      ({ el, rect }) =>
        el !== fromCard &&
        el !== toCard &&
        rect.left < hi &&
        rect.right > lo &&
        rect.top < bottom &&
        rect.bottom > top,
    );
  };

  const measured: Measured[] = [];
  const topSeen = new Map<string, number>(); // arrows already entering a target's top
  const sideSeen = new Map<string, number>(); // arrows already entering a target's left/right edge
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
    const fromCard = fromEl.closest(".stack-frame, .heap-object");
    const toCard = toEl.closest(".stack-frame, .heap-object");
    const x1 = from.right - origin.left;
    const x1Left = from.left - origin.left;
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

    // Side entries fan out vertically so several arrows into one node stay apart.
    const fanY = (count: number) => {
      const offset = Math.ceil(count / 2) * 9 * (count % 2 === 0 ? 1 : -1);
      return Math.min(to.bottom - origin.top - 6, Math.max(toTop + 6, toCy + offset));
    };

    // Stack cells always enter heap targets from the left (the heap is the
    // right-hand column); within the heap, forward/backward mean "same row".
    const stackToHeap =
      !!fromEl.closest(".stack-region") && !!toEl.closest(".heap-region");
    const heapToHeap =
      !!fromEl.closest(".heap-region") && !!toEl.closest(".heap-region");
    const sameRow = Math.abs(toCy - y1) < FORWARD_MAX_DY;

    if (
      toLeft > x1 + 14 &&
      (stackToHeap || sameRow) &&
      !blocked(fromCard, toCard, x1, toLeft, y1, toCy)
    ) {
      const seen = sideSeen.get(pointer.target) ?? 0;
      sideSeen.set(pointer.target, seen + 1);
      measured.push({ kind: "forward", x1, y1, x2: toLeft - 2, y2: fanY(seen), gapY: 0, danger, faded });
    } else if (
      heapToHeap &&
      sameRow &&
      toRight < x1Left - 14 &&
      !blocked(fromCard, toCard, toRight, x1Left, toCy, y1)
    ) {
      // Serpentine right-to-left row: the mirror of "forward".
      const seen = sideSeen.get(pointer.target) ?? 0;
      sideSeen.set(pointer.target, seen + 1);
      measured.push({ kind: "backward", x1: x1Left, y1, x2: toRight + 2, y2: fanY(seen), gapY: 0, danger, faded });
    } else if (!toEl.closest(".heap-region")) {
      measured.push({ kind: "lane", x1, y1, x2: toRight + 2, y2: toCy, gapY: 0, danger, faded });
    } else {
      // Top entry: stagger arrows sharing a target so heads don't stack.
      const seen = topSeen.get(pointer.target) ?? 0;
      topSeen.set(pointer.target, seen + 1);
      const entryX = toLeft + Math.min(18, to.width / 2) + Math.min(seen * 12, to.width - 30);
      const below = toTop > y1 + 16;
      measured.push({
        kind: below ? "down" : "laneTop",
        x1,
        y1,
        x2: entryX,
        y2: toTop - 2,
        gapY: toTop - 10,
        danger,
        faded,
      });
    }
    contentRight = Math.max(contentRight, x1, toRight);
  }

  // Gutter lanes (lane + laneTop): shortest vertical spans first so they hug
  // the content; longer arrows take outer lanes and never cross the short ones.
  const order = measured
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.kind === "lane" || m.kind === "laneTop")
    .sort((a, b) => laneSpan(a.m) - laneSpan(b.m));
  const lanes: { top: number; bottom: number }[][] = [];
  const laneBase = contentRight + 22;
  for (const { m } of order) {
    const end = m.kind === "laneTop" ? m.gapY : m.y2;
    const top = Math.min(m.y1, end) - LANE_PAD;
    const bottom = Math.max(m.y1, end) + LANE_PAD;
    let lane = lanes.findIndex((slots) => slots.every((s) => bottom < s.top || top > s.bottom));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push({ top, bottom });
    m.laneX = laneBase + lane * LANE_GAP;
  }

  // Drop corridors (down): start just right of the pointer cell and slide
  // right past any card or already-placed corridor in the way, so the drop
  // stays as close to the source as the layout allows.
  const drops: { x: number; top: number; bottom: number }[] = [];
  for (const m of measured.filter((m) => m.kind === "down").sort((a, b) => laneSpan(a) - laneSpan(b))) {
    let dropX = m.x1 + 12;
    const top = m.y1 - 4;
    const bottom = m.gapY;
    for (let guard = 0; guard < 40; guard++) {
      const card = cards.find(
        ({ rect: c }) => c.top < bottom && c.bottom > top && dropX > c.left + 4 && dropX < c.right + 12,
      );
      if (card) {
        dropX = card.rect.right + 14;
        continue;
      }
      const other = drops.find(
        (d) => d.top < bottom && d.bottom > top && Math.abs(d.x - dropX) < 11,
      );
      if (other) {
        dropX = other.x + LANE_GAP;
        continue;
      }
      break;
    }
    drops.push({ x: dropX, top, bottom });
    m.laneX = dropX;
  }

  return measured.map((m, index) => ({ key: `a${index}`, ...m, laneX: m.laneX ?? 0 }));
}

function laneSpan(m: Measured): number {
  const end = m.kind === "laneTop" || m.kind === "down" ? m.gapY : m.y2;
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
    // Boxes animate/glide into place on mount and re-layout; re-measure once
    // they settle so arrows land on the final positions.
    container.addEventListener("animationend", update, true);
    container.addEventListener("transitionend", update, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update, true);
      container.removeEventListener("animationend", update, true);
      container.removeEventListener("transitionend", update, true);
    };
  }, [containerRef, step]);

  return arrows;
}
