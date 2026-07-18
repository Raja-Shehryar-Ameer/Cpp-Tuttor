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
  /** Registry key: the pointer's real address, or its structural path when the
   *  tracer emits none (Python references). Must match `pointerKey`. */
  address: string;
  target: string;
  /** Frame the pointer lives in, or null when it lives on the heap. */
  sourceFrameId: string | null;
}

/** Registry key for a value: its address, or its structural path as fallback.
 *  ValueBox registration and collectPointers MUST derive keys identically. */
export function pointerKey(value: Value, path: string): string {
  return value.address ?? path;
}

export function childPath(path: string, index: number, name: string): string {
  return `${path}/${index}:${name}`;
}

/** Every pointer with a target in the step, however deeply nested. */
export function collectPointers(step: Step): PointerRef[] {
  const found: PointerRef[] = [];
  const walk = (value: Value, sourceFrameId: string | null, path: string): void => {
    // Uninitialized pointers hold garbage — drawing arrows for them is noise.
    if (value.kind === "pointer" && value.target && value.isInitialized) {
      found.push({ address: pointerKey(value, path), target: value.target, sourceFrameId });
    }
    value.elements?.forEach((element, i) => walk(element, sourceFrameId, childPath(path, i, element.name)));
  };
  step.stack.forEach((frame) => frame.locals.forEach((v) => walk(v, frame.frameId, `${frame.frameId}/${v.name}`)));
  step.heap.forEach((object) => object.elements.forEach((v, i) => walk(v, null, childPath(object.address, i, v.name))));
  return found;
}
