import { Circle } from "lucide-react";
import { useCallback } from "react";
import { registerBox } from "../../store/boxRegistry";
import type { Value, ValueKind } from "../../types/trace";

// ONE recursive component renders every Value kind; dispatch is kind-driven.
// The inner .flash span is keyed by the displayed value: when the value
// changes between steps the span remounts and replays the flash animation.

function useRegister(address: string | null) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el && address) registerBox(address, el);
    },
    [address],
  );
}

// Tooltips carry the type plus the variable's actual address — real memory
// is the point of a C++ visualizer.
function describe(value: Value, note = ""): string {
  return `${value.type}${note}${value.address ? ` @ ${value.address}` : ""}`;
}

function Scalar({ value, className }: { value: Value; className: string }) {
  const ref = useRegister(value.address);
  const uninit = !value.isInitialized;
  const shown = uninit ? "?" : (value.value ?? "?");
  return (
    <span
      ref={ref}
      className={`value-cell ${className}${uninit ? " uninit" : ""}`}
      title={describe(value, uninit ? " (uninitialized)" : "")}
    >
      <span key={shown} className="flash">
        {shown}
      </span>
    </span>
  );
}

function PointerCell({ value }: { value: Value }) {
  const ref = useRegister(value.address);
  const isNull = value.target === null;
  return (
    <span
      ref={ref}
      className={`value-cell pointer${isNull ? " null-pointer" : ""}`}
      title={`${describe(value)} → ${value.value ?? "?"}`}
    >
      <span key={value.target ?? "null"} className="flash">
        {isNull ? "null" : <Circle size={8} strokeWidth={0} fill="currentColor" aria-label="pointer" />}
      </span>
    </span>
  );
}

function Aggregate({ value, depth }: { value: Value; depth: number }) {
  const ref = useRegister(value.address);
  const kindClass = value.kind === "struct" ? "struct-box" : "array-box";
  return (
    <span ref={ref} className={`aggregate ${kindClass}`} title={describe(value)}>
      {(value.elements ?? []).map((element, i) => (
        <span className="aggregate-item" key={`${element.name}-${i}`}>
          <span className="element-name">{element.name}</span>
          <ValueBody value={element} depth={depth + 1} />
        </span>
      ))}
      {(value.elements === null || value.elements.length === 0) && (
        <span className="value-cell">{value.value ?? "…"}</span>
      )}
    </span>
  );
}

function ValueBody({ value, depth }: { value: Value; depth: number }) {
  const kind: ValueKind = value.kind;
  switch (kind) {
    case "primitive":
      return <Scalar value={value} className="primitive" />;
    case "string":
      return <Scalar value={value} className="string" />;
    case "pointer":
      return <PointerCell value={value} />;
    case "array":
    case "vector":
    case "struct":
      return <Aggregate value={value} depth={depth} />;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled value kind: ${exhaustive as string}`);
    }
  }
}

export function ValueBox({ value }: { value: Value }) {
  return (
    <div className="value-row">
      <span className="var-name">{value.name}</span>
      <ValueBody value={value} depth={0} />
    </div>
  );
}
