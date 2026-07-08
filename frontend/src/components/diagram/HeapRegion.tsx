import { Ban } from "lucide-react";
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
        <span className="heap-label-text">{object.label}</span>
        {object.freed && (
          <span className="freed-tag">
            <Ban size={10} aria-hidden="true" /> freed
          </span>
        )}
      </div>
      {object.elements.map((value, i) => (
        <ValueBox key={`${value.name}-${i}`} value={value} />
      ))}
    </div>
  );
}

// Objects render in allocation order; the CSS wrap-reverse rows keep the
// oldest at the bottom-left and let chains read left-to-right, wrapping
// upward — the heap still grows up.
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
