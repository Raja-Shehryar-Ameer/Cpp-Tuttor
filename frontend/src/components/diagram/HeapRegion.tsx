import { Ban, Droplet } from "lucide-react";
import { useCallback } from "react";
import { collectPointers, registerBox } from "../../store/boxRegistry";
import type { HeapObject, Step, Value } from "../../types/trace";
import { ValueBox } from "./ValueBox";

function HeapBox({ object, leaked }: { object: HeapObject; leaked: boolean }) {
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (el) registerBox(object.address, el);
    },
    [object.address],
  );
  return (
    <div ref={ref} className={`heap-object ${object.freed ? "freed" : ""}`}>
      <div className="heap-label">
        <span className="heap-label-text">{object.label}</span>
        {object.freed && (
          <span className="freed-tag">
            <Ban size={10} aria-hidden="true" /> freed
          </span>
        )}
        {leaked && (
          <span className="leak-tag" title="still allocated when the program exited">
            <Droplet size={10} aria-hidden="true" /> leaked
          </span>
        )}
      </div>
      {object.elements.map((value, i) => (
        <ValueBox key={`${value.name}-${i}`} value={value} />
      ))}
      <div className="heap-addr" title="actual address of this allocation">
        {object.address}
      </div>
    </div>
  );
}

/**
 * Lay heap objects out in POINTER-CHAIN order, not allocation order, so any
 * linked structure (list, tree, objects holding objects) reads left-to-right
 * regardless of the order the nodes were allocated in. Chain heads are stack
 * pointers whose target no heap object points at (in-degree 0 — a list head,
 * a tree root); each head's reachable objects follow depth-first. Anything
 * unreachable keeps allocation order.
 */
function chainOrder(step: Step): HeapObject[] {
  const byAddr = new Map(step.heap.map((o) => [o.address, o]));
  const pointers = collectPointers(step);
  const heapInDegree = new Set(
    pointers.filter((p) => p.sourceFrameId === null).map((p) => p.target),
  );
  const stackRefs = pointers.filter((p) => p.sourceFrameId !== null && byAddr.has(p.target));
  const roots = [...stackRefs.filter((p) => !heapInDegree.has(p.target)), ...stackRefs];

  const ordered: HeapObject[] = [];
  const seen = new Set<string>();
  const visit = (addr: string): void => {
    const obj = byAddr.get(addr);
    if (!obj || seen.has(addr)) return;
    seen.add(addr);
    ordered.push(obj);
    const follow = (value: Value): void => {
      if (value.kind === "pointer" && value.target && value.isInitialized) visit(value.target);
      value.elements?.forEach(follow);
    };
    obj.elements.forEach(follow);
  };
  roots.forEach((p) => visit(p.target));
  // No stack root (e.g. after exit): chains still start at their heads —
  // objects no other heap object points at — before plain allocation order.
  step.heap.forEach((o) => {
    if (!heapInDegree.has(o.address)) visit(o.address);
  });
  step.heap.forEach((o) => visit(o.address));
  return ordered;
}

// On the exit step, anything never freed is flagged as a leak.
export function HeapRegion({ step }: { step: Step | null }) {
  const objects = step ? chainOrder(step) : [];
  const exited = step?.event === "exit";
  return (
    <div className="heap-region">
      {objects.map((object) => (
        <HeapBox key={object.address} object={object} leaked={exited && !object.freed} />
      ))}
      {objects.length === 0 && <div className="empty-note">nothing on the heap</div>}
    </div>
  );
}
