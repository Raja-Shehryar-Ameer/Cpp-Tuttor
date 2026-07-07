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
  /** Frame the pointer lives in, or null when it lives on the heap. */
  sourceFrameId: string | null;
}

/** Every pointer with a target in the step, however deeply nested. */
export function collectPointers(step: Step): PointerRef[] {
  const found: PointerRef[] = [];
  const walk = (value: Value, sourceFrameId: string | null): void => {
    // Uninitialized pointers hold garbage — drawing arrows for them is noise.
    if (value.kind === "pointer" && value.target && value.isInitialized) {
      found.push({ address: value.address, target: value.target, sourceFrameId });
    }
    value.elements?.forEach((element) => walk(element, sourceFrameId));
  };
  step.stack.forEach((frame) => frame.locals.forEach((v) => walk(v, frame.frameId)));
  step.heap.forEach((object) => object.elements.forEach((v) => walk(v, null)));
  return found;
}
