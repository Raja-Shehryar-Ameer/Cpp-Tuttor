import { useCallback } from "react";
import { registerBox } from "../../store/boxRegistry";
import type { Value, ValueKind } from "../../types/trace";

// ONE recursive component renders every Value kind; dispatch is kind-driven.

function useRegister(address: string | null) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el && address) registerBox(address, el);
    },
    [address],
  );
}

function Scalar({ value, className }: { value: Value; className: string }) {
  const ref = useRegister(value.address);
  return (
    <span ref={ref} className={`value-cell ${className}`} title={value.type}>
      {value.value ?? "?"}
    </span>
  );
}

function PointerCell({ value }: { value: Value }) {
  const ref = useRegister(value.address);
  const label = value.target === null ? "null" : "●";
  return (
    <span
      ref={ref}
      className={`value-cell pointer ${value.target === null ? "null-pointer" : ""}`}
      title={`${value.type} = ${value.value ?? "?"}`}
    >
      {label}
    </span>
  );
}

function Aggregate({ value, depth }: { value: Value; depth: number }) {
  const ref = useRegister(value.address);
  const kindClass = value.kind === "struct" ? "struct-box" : "array-box";
  return (
    <span ref={ref} className={`aggregate ${kindClass}`} title={value.type}>
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
