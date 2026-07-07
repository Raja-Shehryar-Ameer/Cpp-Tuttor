import { useCallback } from "react";
import { registerBox } from "../../store/boxRegistry";
import type { HeapObject } from "../../types/trace";
import { ValueBox } from "./ValueBox";

function HeapBox({ object }: { object: HeapObject }) {
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (el) registerBox(object.address, el);
    },
    [object.address],
  );
  return (
    <div ref={ref} className={`heap-object ${object.freed ? "freed" : ""}`}>
      <div className="heap-label">
        {object.label}
        {object.freed && <span className="freed-tag">freed</span>}
      </div>
      {object.elements.map((value, i) => (
        <ValueBox key={`${value.name}-${i}`} value={value} />
      ))}
    </div>
  );
}

export function HeapRegion({ objects }: { objects: HeapObject[] }) {
  return (
    <div className="heap-region">
      {objects.map((object) => (
        <HeapBox key={object.address} object={object} />
      ))}
      {objects.length === 0 && <div className="empty-note">nothing on the heap</div>}
    </div>
  );
}
