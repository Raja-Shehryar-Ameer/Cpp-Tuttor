import { useLayoutEffect, useState, type RefObject } from "react";
import { collectPointers, getBox, purgeDisconnected } from "../store/boxRegistry";
import type { Step } from "../types/trace";

export interface Arrow {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** target missing entirely — draw a stub */
  stub: boolean;
  /** target freed or missing — render red with a warning marker */
  danger: boolean;
}

function measure(container: HTMLElement, step: Step): Arrow[] {
  purgeDisconnected();
  const origin = container.getBoundingClientRect();
  const freed = new Set(step.heap.filter((h) => h.freed).map((h) => h.address));
  const arrows: Arrow[] = [];
  collectPointers(step).forEach((pointer, index) => {
    if (!pointer.address) return;
    const fromEl = getBox(pointer.address);
    if (!fromEl) return;
    const from = fromEl.getBoundingClientRect();
    const x1 = from.right - origin.left;
    const y1 = from.top + from.height / 2 - origin.top;
    const toEl = getBox(pointer.target);
    if (!toEl) {
      arrows.push({ key: `a${index}`, x1, y1, x2: x1 + 34, y2: y1 - 14, stub: true, danger: true });
      return;
    }
    const to = toEl.getBoundingClientRect();
    arrows.push({
      key: `a${index}`,
      x1,
      y1,
      x2: to.left - origin.left,
      y2: to.top + to.height / 2 - origin.top,
      stub: false,
      danger: freed.has(pointer.target),
    });
  });
  return arrows;
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
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update, true);
    };
  }, [containerRef, step]);

  return arrows;
}
