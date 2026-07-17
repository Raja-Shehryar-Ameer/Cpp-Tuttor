import { Ban, Droplet } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { collectPointers, registerBox } from "../../store/boxRegistry";
import type { HeapObject, Step, Value } from "../../types/trace";
import { ValueBox } from "./ValueBox";

function HeapBox({
  object,
  leaked,
  python,
  x,
  y,
  ready,
}: {
  object: HeapObject;
  leaked: boolean;
  python: boolean;
  x: number;
  y: number;
  ready: boolean;
}) {
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (el) registerBox(object.address, el);
    },
    [object.address],
  );
  return (
    <div
      ref={ref}
      data-addr={object.address}
      className={`heap-object ${object.freed ? "freed" : ""}`}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: ready ? undefined : 0 }}
    >
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
      {/* Python addresses are synthetic id()s, not allocations — never shown. */}
      {!python && (
        <div className="heap-addr" title="actual address of this allocation">
          {object.address}
        </div>
      )}
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
  const pointers = collectPointers(step);
  // Freed objects stay visible only while some live pointer still dangles at
  // them (the teachable moment); once nothing references them they are gone.
  const referenced = new Set(pointers.map((p) => p.target));
  const live = step.heap.filter((o) => !o.freed || referenced.has(o.address));
  const byAddr = new Map(live.map((o) => [o.address, o]));
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
  live.forEach((o) => {
    if (!heapInDegree.has(o.address)) visit(o.address);
  });
  live.forEach((o) => visit(o.address));
  return ordered;
}

const GAP_X = 48; // corridor between neighbours in a row (arrows live here)
const GAP_Y = 52; // corridor between rows (top-entry approach runs live here)

interface HeapLayout {
  pos: Map<string, { x: number; y: number }>;
  height: number;
}

/**
 * Serpentine (boustrophedon) placement: chain order fills row 0 left→right;
 * when width runs out the next row fills right→left, the one after that
 * left→right again, and so on. The last box of a row therefore sits directly
 * above the first box of the next, so a wrapping link is a short straight
 * drop instead of a long crossing arrow, and every row reads in the direction
 * the chain actually flows.
 */
function computeLayout(width: number, boxes: { addr: string; w: number; h: number }[]): HeapLayout {
  const rows: { addr: string; w: number; h: number }[][] = [];
  let row: typeof boxes = [];
  let filled = 0;
  for (const box of boxes) {
    if (row.length > 0 && filled + box.w > width) {
      rows.push(row);
      row = [];
      filled = 0;
    }
    row.push(box);
    filled += box.w + GAP_X;
  }
  if (row.length > 0) rows.push(row);

  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  rows.forEach((items, rowIndex) => {
    const rowHeight = Math.max(...items.map((b) => b.h));
    if (rowIndex % 2 === 0) {
      let x = 0;
      for (const b of items) {
        pos.set(b.addr, { x, y });
        x += b.w + GAP_X;
      }
    } else {
      let x = width;
      for (const b of items) {
        x -= b.w;
        pos.set(b.addr, { x: Math.max(0, x), y });
        x -= GAP_X;
      }
    }
    y += rowHeight + GAP_Y;
  });
  return { pos, height: rows.length > 0 ? y - GAP_Y : 0 };
}

function sameLayout(a: HeapLayout, b: HeapLayout): boolean {
  if (a.height !== b.height || a.pos.size !== b.pos.size) return false;
  for (const [addr, p] of a.pos) {
    const q = b.pos.get(addr);
    if (!q || q.x !== p.x || q.y !== p.y) return false;
  }
  return true;
}

// On the exit step, anything never freed is flagged as a leak — a C/C++
// concept only: Python frees everything itself, so nothing there can leak.
export function HeapRegion({ step, python }: { step: Step | null; python: boolean }) {
  const objects = step ? chainOrder(step) : [];
  const exited = step?.event === "exit" && !python;
  const regionRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<HeapLayout>({ pos: new Map(), height: 0 });

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const update = () => {
      // DOM order is chain order — boxes are rendered in it.
      const boxes = [...region.querySelectorAll<HTMLElement>(".heap-object")].map((el) => ({
        addr: el.dataset.addr ?? "",
        w: el.offsetWidth,
        h: el.offsetHeight,
      }));
      const next = computeLayout(region.clientWidth, boxes);
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(region);
    region.querySelectorAll(".heap-object").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [step]);

  return (
    <div
      className="heap-region"
      ref={regionRef}
      style={{ height: objects.length > 0 ? layout.height : undefined }}
    >
      {objects.map((object) => {
        const p = layout.pos.get(object.address);
        return (
          <HeapBox
            key={object.address}
            object={object}
            leaked={exited && !object.freed}
            python={python}
            x={p?.x ?? 0}
            y={p?.y ?? 0}
            ready={p !== undefined}
          />
        );
      })}
      {objects.length === 0 && (
        <div className="empty-note">{python ? "no objects yet" : "nothing on the heap"}</div>
      )}
    </div>
  );
}
