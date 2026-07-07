// Non-reactive registry: ValueBoxes register their DOM node under their
// address; ArrowLayer measures them after layout. Kept outside Zustand so
// ref callbacks never trigger re-renders.

import type { Step, Value } from "../types/trace";

const boxes = new Map<string, HTMLElement>();

export function registerBox(address: string, el: HTMLElement): void {
  boxes.set(address, el);
}

export function getBox(address: string): HTMLElement | null {
  const el = boxes.get(address);
  if (el && !el.isConnected) {
    boxes.delete(address);
    return null;
  }
  return el ?? null;
}

export function purgeDisconnected(): void {
  for (const [address, el] of boxes) {
    if (!el.isConnected) boxes.delete(address);
  }
}

export interface PointerRef {
  address: string | null;
  target: string;
}

/** Every pointer with a target in the step, however deeply nested. */
export function collectPointers(step: Step): PointerRef[] {
  const found: PointerRef[] = [];
  const walk = (value: Value): void => {
    if (value.kind === "pointer" && value.target) {
      found.push({ address: value.address, target: value.target });
    }
    value.elements?.forEach(walk);
  };
  step.stack.forEach((frame) => frame.locals.forEach(walk));
  step.heap.forEach((object) => object.elements.forEach(walk));
  return found;
}
