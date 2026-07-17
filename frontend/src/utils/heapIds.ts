import type { Step } from "../types/trace";

/**
 * Per-step map from heap address → stable display id ("H1", "H2", …),
 * numbered by first appearance across the whole trace. The badge names the
 * OBJECT, not the address: an address that reappears un-freed after having
 * been seen freed (allocator reuse) gets a fresh id, while a freed object
 * that is still displayed (dangling-pointer teachable moment) keeps its id.
 */
export function computeHeapIds(steps: readonly Step[]): ReadonlyMap<string, string>[] {
  let n = 0;
  const state = new Map<string, { id: string; freed: boolean }>();
  return steps.map((step) => {
    const ids = new Map<string, string>();
    for (const object of step.heap) {
      let entry = state.get(object.address);
      if (!entry || (entry.freed && !object.freed)) {
        entry = { id: `H${++n}`, freed: object.freed };
        state.set(object.address, entry);
      } else if (object.freed) {
        entry.freed = true;
      }
      ids.set(object.address, entry.id);
    }
    return ids;
  });
}
