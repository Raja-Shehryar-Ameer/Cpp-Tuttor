import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { BNode, DSData, Frame, TreeNode, WEdge } from "../../ds/engine";

// SVG <line> endpoints cannot be CSS-transitioned, so every edge is a
// two-point <path>: its `d` glides along with the node transforms.
function Edge({ className, x1, y1, x2, y2, marker }: { className: string; x1: number; y1: number; x2: number; y2: number; marker?: boolean }) {
  const d = `M ${x1} ${y1} L ${x2} ${y2}`;
  return (
    <path
      className={className}
      d={d}
      style={{ d: `path("${d}")` } as CSSProperties}
      markerEnd={marker ? "url(#ds-arrow)" : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Motion. Every node <g> is keyed by its stable id and rendered at its FINAL
// position; GlideG then plays an additive FLIP animation from where the node
// sat on the previous frame down to zero. When the glide planner (below)
// detects that a node's straight path would pass through another node, the
// glide bends through a midpoint offset perpendicular to the motion, so swap
// partners arc around each other instead of gliding through.

const GLIDE_MS = 600;
const GLIDE_EASE = "cubic-bezier(0.25, 0.8, 0.3, 1)"; // keep in sync with --ease-glide

function GlideG({ x, y, lift = 0, className, children }: { x: number; y: number; lift?: number; className: string; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  const prev = useRef<{ x: number; y: number } | null>(null);
  const liftRef = useRef(lift);
  liftRef.current = lift;
  useLayoutEffect(() => {
    const el = ref.current;
    const p = prev.current;
    prev.current = { x, y };
    if (!el || !el.animate || !p) return;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx === 0 && dy === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const amp = liftRef.current;
    let frames: Keyframe[];
    if (amp > 0) {
      // A hop, not an arc: rise to FULL clearance before traveling, glide
      // across lifted, then drop into the slot. A mid-path arc peak cannot
      // clear an adjacent-slot swap — the boxes touch at ~7% progress, long
      // before a triangular profile has any height. The lift direction is
      // perpendicular to the motion, preferring upward (rightward for
      // vertical moves).
      const len = Math.hypot(dx, dy);
      let px = dy / len;
      let py = -dx / len;
      if (py > 0 || (py === 0 && px < 0)) {
        px = -px;
        py = -py;
      }
      frames = [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx + px * amp}px, ${dy + py * amp}px)`, offset: 0.12 },
        { transform: `translate(${px * amp}px, ${py * amp}px)`, offset: 0.88 },
        { transform: "translate(0px, 0px)" },
      ];
    } else {
      frames = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }];
    }
    el.animate(frames, { duration: GLIDE_MS, easing: GLIDE_EASE, composite: "add" });
  }, [x, y]);
  return (
    <g ref={ref} className={className} style={{ transform: `translate(${x}px, ${y}px)` }}>
      {children}
    </g>
  );
}

interface Mover {
  key: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Swept-AABB pass over every pair of nodes: solve, per axis, for the time
    window t ∈ [0,1] in which the two gliding boxes overlap; if the windows
    intersect, the straight paths would collide, so exactly one of the pair
    (the mover, or the left/up partner of a mutual swap) gets an arc whose
    amplitude `liftFor` guarantees clearance. Pure geometry — it knows nothing
    about which structure is on screen. */
function planLifts(
  prevPos: Map<number, { x: number; y: number }>,
  movers: Mover[],
  liftFor: (mover: Mover, other: Mover) => number,
): Map<number, number> {
  const lifts = new Map<number, number>();
  const win = (r0: number, r1: number, w: number): [number, number] | null => {
    const d = r1 - r0;
    if (d === 0) return Math.abs(r0) < w ? [0, 1] : null;
    let t0 = (-w - r0) / d;
    let t1 = (w - r0) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    const lo = Math.max(0, t0);
    const hi = Math.min(1, t1);
    return lo < hi ? [lo, hi] : null;
  };
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i];
      const b = movers[j];
      const a0 = prevPos.get(a.key) ?? { x: a.cx, y: a.cy };
      const b0 = prevPos.get(b.key) ?? { x: b.cx, y: b.cy };
      const da = Math.hypot(a.cx - a0.x, a.cy - a0.y);
      const db = Math.hypot(b.cx - b0.x, b.cy - b0.y);
      if (da === 0 && db === 0) continue; // nothing glides, nothing crosses
      const X = win(a0.x - b0.x, a.cx - b.cx, (a.w + b.w) / 2 - 3);
      if (!X) continue;
      const Y = win(a0.y - b0.y, a.cy - b.cy, (a.h + b.h) / 2 - 3);
      if (!Y) continue;
      if (Math.max(X[0], Y[0]) >= Math.min(X[1], Y[1])) continue;
      // Arc the node that travels farther; on an even swap, the left/up mover.
      let mover = a;
      let other = b;
      if (db > da + 0.5) {
        mover = b;
        other = a;
      } else if (Math.abs(da - db) <= 0.5) {
        const headA = a.cx - a0.x + (a.cy - a0.y);
        const headB = b.cx - b0.x + (b.cy - b0.y);
        if (headB < headA) {
          mover = b;
          other = a;
        }
      }
      lifts.set(mover.key, Math.max(lifts.get(mover.key) ?? 0, liftFor(mover, other)));
    }
  }
  return lifts;
}

/** Track previous-frame centers and plan this frame's arcs. */
function useLifts(movers: Mover[], liftFor: (mover: Mover, other: Mover) => number): Map<number, number> {
  const prev = useRef(new Map<number, { x: number; y: number }>());
  const lifts = planLifts(prev.current, movers, liftFor);
  useEffect(() => {
    prev.current = new Map(movers.map((m) => [m.key, { x: m.cx, y: m.cy }]));
  });
  return lifts;
}

const BOX_LIFT = () => 52; // box height 38 + comfortable clearance

interface Placed {
  id: number;
  value: number;
  x: number;
  y: number;
  color?: "red" | "black";
}

function nodeClass(id: number, frame: Frame): string {
  let cls = "ds-node";
  if (frame.hl.includes(id)) cls += " hl";
  if (frame.ok?.includes(id)) cls += " ok";
  if (frame.bad?.includes(id)) cls += " bad";
  if (frame.pivot?.includes(id)) cls += " pivot";
  return cls;
}

function Boxes({
  frame,
  placed,
  w,
  h,
  extras,
}: {
  frame: Frame;
  placed: Placed[];
  w: number;
  h: number;
  extras?: ReactNode;
}) {
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x + 31, cy: p.y + 19, w: 62, h: 38 })),
    BOX_LIFT,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <marker id="ds-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="ds-arrow-head" />
        </marker>
      </defs>
      {extras}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <rect className="ds-box" width={62} height={38} rx={9} />
          <text className="ds-value" x={31} y={24}>
            {p.value}
          </text>
        </GlideG>
      ))}
    </svg>
  );
}

function ListScene({ frame, nodes }: { frame: Frame; nodes: { id: number; value: number }[] }) {
  const placed = nodes.map((n, i) => ({ ...n, x: 66 + i * 102, y: 26 }));
  const w = Math.max(460, 66 + nodes.length * 102 + 70);
  return (
    <Boxes
      frame={frame}
      placed={placed}
      w={w}
      h={96}
      extras={
        <>
          <text className="ds-tag" x={12} y={50}>
            head
          </text>
          {nodes.length > 0 && <Edge className="ds-link" x1={40} y1={45} x2={60} y2={45} marker />}
          {placed.slice(0, -1).map((p) => (
            <Edge key={`l${p.id}`} className="ds-link" x1={p.x + 64} y1={45} x2={p.x + 96} y2={45} marker />
          ))}
          <text className="ds-tag" x={nodes.length === 0 ? 46 : 66 + nodes.length * 102 + 6} y={50}>
            null
          </text>
        </>
      }
    />
  );
}

function StackScene({ frame, items }: { frame: Frame; items: { id: number; value: number }[] }) {
  // Top-anchored: the newest item always sits at y=26 and older items hang
  // below it, so positions never depend on the canvas height — growing the
  // SVG for a taller pile cannot make settled boxes glide.
  const count = items.length;
  const h = Math.max(220, count * 46 + 76);
  const floorY = count === 0 ? 190 : 26 + count * 46 + 4;
  const placed = items.map((n, i) => ({ ...n, x: 90, y: 26 + (count - 1 - i) * 46 }));
  const top = placed[placed.length - 1];
  return (
    <Boxes
      frame={frame}
      placed={placed}
      w={330}
      h={h}
      extras={
        <>
          <line className="ds-floor" x1={70} y1={floorY} x2={172} y2={floorY} />
          {top && (
            <text className="ds-tag" x={168} y={top.y + 24}>
              ← top
            </text>
          )}
          {!top && (
            <text className="ds-tag" x={82} y={floorY - 18}>
              (empty)
            </text>
          )}
        </>
      }
    />
  );
}

function QueueScene({ frame, items }: { frame: Frame; items: { id: number; value: number }[] }) {
  const placed = items.map((n, i) => ({ ...n, x: 60 + i * 78, y: 30 }));
  const w = Math.max(460, 60 + items.length * 78 + 60);
  return (
    <Boxes
      frame={frame}
      placed={placed}
      w={w}
      h={110}
      extras={
        <>
          {items.length > 0 && (
            <>
              <text className="ds-tag" x={60} y={20}>
                front ↓
              </text>
              <text className="ds-tag" x={60 + (items.length - 1) * 78 + 8} y={92}>
                ↑ rear
              </text>
            </>
          )}
          {items.length === 0 && (
            <text className="ds-tag" x={60} y={55}>
              (empty)
            </text>
          )}
        </>
      }
    />
  );
}

function placeTree(root: TreeNode | null): { placed: Placed[]; edges: [Placed, Placed][]; w: number; h: number } {
  const placed: Placed[] = [];
  const edges: [Placed, Placed][] = [];
  let index = 0;
  let depthMax = 0;
  const walk = (n: TreeNode | null, depth: number): Placed | null => {
    if (!n) return null;
    depthMax = Math.max(depthMax, depth);
    const left = walk(n.left, depth + 1);
    const me: Placed = { id: n.id, value: n.value, color: n.color, x: 40 + index * 58, y: 40 + depth * 72 };
    index += 1;
    placed.push(me);
    const right = walk(n.right, depth + 1);
    if (left) edges.push([me, left]);
    if (right) edges.push([me, right]);
    return me;
  };
  walk(root, 0);
  return { placed, edges, w: Math.max(460, 40 + index * 58 + 40), h: Math.max(240, 40 + (depthMax + 1) * 72 + 30) };
}

function TreeScene({ frame, root }: { frame: Frame; root: TreeNode | null }) {
  const { placed, edges, w, h } = placeTree(root);
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x, cy: p.y, w: 42, h: 42 })),
    () => 52,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {edges.map(([a, b]) => (
        <Edge key={`e${b.id}`} className="ds-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      ))}
      {placed.map((p) => (
        <GlideG
          key={p.id}
          x={p.x}
          y={p.y}
          lift={lifts.get(p.id)}
          className={`${nodeClass(p.id, frame)}${p.color ? ` rb-${p.color}` : ""}`}
        >
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </GlideG>
      ))}
      {placed.length === 0 && (
        <text className="ds-tag" x={30} y={60}>
          (empty tree)
        </text>
      )}
    </svg>
  );
}

function GraphScene({
  frame,
  nodes,
  edges,
}: {
  frame: Frame;
  nodes: { id: number; value: number }[];
  edges: [number, number][];
}) {
  // The ring grows with the vertex count so circles never collide: each node
  // gets ≥72px of arc (diameter 42 + comfortable gap), and the canvas grows
  // with the ring. Nodes glide to their new seats when the ring re-spaces.
  const SPACING = 72;
  const radius = Math.max(110, (nodes.length * SPACING) / (2 * Math.PI));
  const pad = 64;
  const cx = radius + pad;
  const cy = radius + pad;
  const w = Math.max(520, 2 * (radius + pad));
  const h = Math.max(340, 2 * (radius + pad));
  const placed = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    return { ...n, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x, cy: p.y, w: 42, h: 42 })),
    () => 52,
  );
  const at = new Map(placed.map((p) => [p.id, p]));
  return (
    // When the ring outgrows the pane, the whole scene scales down to fit
    // instead of overflowing into a scrollbar — viewBox keeps it crisp.
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: "100%", height: "auto" }}>
      {edges.map(([a, b]) => {
        const pa = at.get(a);
        const pb = at.get(b);
        return pa && pb ? <Edge key={`e${a}-${b}`} className="ds-edge" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} /> : null;
      })}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </GlideG>
      ))}
      {placed.length === 0 && (
        <text className="ds-tag" x={30} y={60}>
          (no vertices yet)
        </text>
      )}
    </svg>
  );
}

/** B-tree / B+ tree: multi-key nodes sized by their key count. Every KEY is
    its own GlideG at GLOBAL coordinates, so a median physically glides from
    child to parent during a split (nesting keys inside a node's GlideG would
    double-animate them). B+ trees draw the derived leaf chain as arrows. */
function BTreeScene({ frame, root, plus }: { frame: Frame; root: BNode | null; plus: boolean }) {
  const chainId = useId();
  const KW = 38; // key pitch: 34px box + 4px gap

  interface PKey { id: number; value: number; x: number; y: number; sep: boolean }
  const nodes: { id: number; x: number; y: number; w: number }[] = [];
  const keys: PKey[] = [];
  const links: { id: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  const leaves: { id: number; x: number; y: number; w: number }[] = [];
  let cursor = 26;
  let maxDepth = 0;

  const place = (n: BNode, depth: number): { cx: number; y: number } => {
    maxDepth = Math.max(maxDepth, depth);
    const w = Math.max(n.keys.length, 1) * KW + 6;
    const y = 30 + depth * 88;
    let x: number;
    if (n.children.length === 0) {
      x = cursor;
      cursor += w + 22;
    } else {
      const kids = n.children.map((c) => place(c, depth + 1));
      x = (kids[0].cx + kids[kids.length - 1].cx) / 2 - w / 2;
      kids.forEach((kid, i) => {
        // connector leaves the parent at the gap before key i (clamped to the rim)
        const gx = Math.min(Math.max(x + 4 + i * KW, x + 6), x + w - 6);
        links.push({ id: n.children[i].id, x1: gx, y1: y + 38, x2: kid.cx, y2: kid.y });
      });
    }
    nodes.push({ id: n.id, x, y, w });
    n.keys.forEach((k, j) => keys.push({ id: k.id, value: k.value, x: x + 4 + j * KW, y: y + 3, sep: plus && n.children.length > 0 }));
    if (n.children.length === 0) leaves.push({ id: n.id, x, y, w });
    return { cx: x + w / 2, y };
  };
  if (root) place(root, 0);

  const w = Math.max(460, cursor + 8);
  const h = Math.max(240, 30 + (maxDepth + 1) * 88 + 10);
  const lifts = useLifts(
    keys.map((k) => ({ key: k.id, cx: k.x + 17, cy: k.y + 16, w: 34, h: 32 })),
    () => 46,
  );

  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: "100%", height: "auto" }}>
      <defs>
        <marker id={chainId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
        </marker>
      </defs>
      {links.map((l) => (
        <Edge key={`l${l.id}`} className="ds-edge" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
      {plus && leaves.slice(0, -1).map((leaf, i) => {
        const next = leaves[i + 1];
        const d = `M ${leaf.x + leaf.w + 2} ${leaf.y + 19} L ${next.x - 3} ${next.y + 19}`;
        return (
          <path
            key={`c${leaf.id}`}
            className="ds-bchain"
            d={d}
            style={{ d: `path("${d}")` } as CSSProperties}
            markerEnd={`url(#${chainId})`}
          />
        );
      })}
      {nodes.map((n) => (
        <GlideG key={n.id} x={n.x} y={n.y} className="ds-bnode-g">
          <rect className="ds-bnode" width={n.w} height={38} rx={9} />
        </GlideG>
      ))}
      {keys.map((k) => (
        <GlideG
          key={k.id}
          x={k.x}
          y={k.y}
          lift={lifts.get(k.id)}
          className={`${nodeClass(k.id, frame)}${k.sep ? " ds-sep" : ""}`}
        >
          <rect className="ds-box" width={34} height={32} rx={7} />
          <text className="ds-value" x={17} y={21}>
            {k.value}
          </text>
        </GlideG>
      ))}
      {!root && (
        <text className="ds-tag" x={30} y={60}>
          (empty tree — insert some values and watch the splits)
        </text>
      )}
    </svg>
  );
}

/** Weighted graph for the Graph Algorithms lab: labeled edges that can be
    highlighted like nodes, optional arrowheads in directed mode, and per-node
    caption labels ("d=7", "in: 2") that travel with their vertex. */
function WGraphScene({
  frame,
  nodes,
  edges,
  directed,
}: {
  frame: Frame;
  nodes: { id: number; value: number }[];
  edges: WEdge[];
  directed: boolean;
}) {
  // Arrowhead marker id must be unique per mounted scene (race views mount
  // two); fill follows the edge's stroke so hl/ok/bad tint the head too.
  const arrowId = useId();
  const SPACING = 78;
  const radius = Math.max(120, (nodes.length * SPACING) / (2 * Math.PI));
  const pad = 70;
  const cx = radius + pad;
  const cy = radius + pad;
  const w = Math.max(520, 2 * (radius + pad));
  const h = Math.max(340, 2 * (radius + pad));
  const placed = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    return { ...n, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x, cy: p.y, w: 42, h: 42 })),
    () => 52,
  );
  const at = new Map(placed.map((p) => [p.id, p]));

  const edgeClass = (id: number): string => {
    let cls = "ds-wedge";
    if (frame.hl.includes(id)) cls += " hl";
    if (frame.ok?.includes(id)) cls += " ok";
    if (frame.bad?.includes(id)) cls += " bad";
    return cls;
  };

  // Geometry per edge: endpoints pulled back to the circle rims (so arrowheads
  // land on the rim, not the center), antiparallel twins nudged apart so
  // A→B and B→A never draw on top of each other.
  const drawn = edges.flatMap((e) => {
    const pa = at.get(e.a);
    const pb = at.get(e.b);
    if (!pa || !pb) return [];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const twin = directed && edges.some((o) => o.a === e.b && o.b === e.a);
    const off = twin ? 7 : 0; // each direction computes its own side
    const trim = directed ? 25 : 21; // rim + a little room for the arrowhead
    const x1 = pa.x + ux * 21 + uy * off;
    const y1 = pa.y + uy * 21 - ux * off;
    const x2 = pb.x - ux * trim + uy * off;
    const y2 = pb.y - uy * trim - ux * off;
    // Weight label sits beside the midpoint, offset perpendicular off the line.
    const lx = (x1 + x2) / 2 + uy * 13;
    const ly = (y1 + y2) / 2 - ux * 13;
    return [{ e, x1, y1, x2, y2, lx, ly }];
  });

  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: "100%", height: "auto" }}>
      <defs>
        <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
        </marker>
      </defs>
      {drawn.map(({ e, x1, y1, x2, y2 }) => {
        const d = `M ${x1} ${y1} L ${x2} ${y2}`;
        return (
          <path
            key={`e${e.id}`}
            className={edgeClass(e.id)}
            d={d}
            style={{ d: `path("${d}")` } as CSSProperties}
            markerEnd={directed ? `url(#${arrowId})` : undefined}
          />
        );
      })}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
          {frame.labels?.[p.id] !== undefined && (
            <text className="ds-nlabel" y={38} textAnchor="middle">
              {frame.labels[p.id]}
            </text>
          )}
        </GlideG>
      ))}
      {drawn.map(({ e, lx, ly }) => {
        const txt = String(e.w);
        const lw = 12 + txt.length * 7;
        return (
          <GlideG key={-e.id} x={lx} y={ly} className={`ds-wlabel-g${edgeClass(e.id).replace("ds-wedge", "")}`}>
            <rect className="ds-wlabel-bg" x={-lw / 2} y={-9} width={lw} height={18} rx={5} />
            <text className="ds-wlabel" y={4.5} textAnchor="middle">
              {txt}
            </text>
          </GlideG>
        );
      })}
      {placed.length === 0 && (
        <text className="ds-tag" x={30} y={60}>
          (no vertices yet — bulk load edges like “1 2 5”, one per line)
        </text>
      )}
    </svg>
  );
}

function HeapScene({ frame, items }: { frame: Frame; items: { id: number; value: number }[] }) {
  const n = items.length;
  const depthMax = n ? Math.floor(Math.log2(n)) : 0;
  const treeW = Math.max(460, Math.pow(2, depthMax) * 84 + 40);
  const w = Math.max(treeW, 30 + n * 54 + 40);
  // 88px below the deepest circle row: enough for an array box arcing 52px
  // over its row to stay clear of the circles above.
  const arrY = 40 + depthMax * 66 + 88;
  const h = arrY + 76;
  const placed = items.map((node, i) => {
    const depth = Math.floor(Math.log2(i + 1));
    const row = Math.pow(2, depth);
    const j = i + 1 - row;
    return { ...node, i, x: (w * (2 * j + 1)) / (2 * row), y: 40 + depth * 66 };
  });
  // The tree circles and the array boxes are two views of the same node ids,
  // so the planner tracks the array copies under complemented keys.
  const lifts = useLifts(
    [
      ...placed.map((p) => ({ key: p.id, cx: p.x, cy: p.y, w: 42, h: 42 })),
      ...items.map((node, i) => ({ key: ~node.id, cx: 30 + i * 54 + 23, cy: arrY + 19, w: 46, h: 38 })),
    ],
    () => 52,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {placed.slice(1).map((p) => {
        const parent = placed[(p.i - 1) >> 1];
        return <Edge key={`e${p.id}`} className="ds-edge" x1={parent.x} y1={parent.y} x2={p.x} y2={p.y} />;
      })}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </GlideG>
      ))}
      <g>
        {items.map((node, i) => (
          <GlideG key={node.id} x={30 + i * 54} y={arrY} lift={lifts.get(~node.id)} className={nodeClass(node.id, frame)}>
            <rect className="ds-box" width={46} height={38} rx={8} />
            <text className="ds-value" x={23} y={24}>
              {node.value}
            </text>
          </GlideG>
        ))}
        {items.map((node, i) => (
          <text key={`i${node.id}`} className="ds-tag" x={30 + i * 54 + 23} y={arrY + 54} textAnchor="middle">
            {i}
          </text>
        ))}
      </g>
      {n > 0 && (
        <text className="ds-tag" x={30} y={arrY - 10}>
          the same heap, as the array it really lives in:
        </text>
      )}
      {n === 0 && (
        <text className="ds-tag" x={30} y={60}>
          (empty heap)
        </text>
      )}
    </svg>
  );
}

function HashScene({ frame, buckets }: { frame: Frame; buckets: { id: number; value: number }[][] }) {
  const rowH = 54;
  const h = 20 + buckets.length * rowH + 10;
  const maxChain = Math.max(0, ...buckets.map((b) => b.length));
  const w = Math.max(460, 96 + maxChain * 100 + 60);
  const placed = buckets.flatMap((chain, b) =>
    chain.map((node, i) => ({ ...node, x: 96 + i * 100, y: 20 + b * rowH })),
  );
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x + 31, cy: p.y + 19, w: 62, h: 38 })),
    BOX_LIFT,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <marker id="ds-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="ds-arrow-head" />
        </marker>
      </defs>
      {buckets.map((chain, b) => {
        const y = 20 + b * rowH;
        return (
          <g key={`b${b}`}>
            <text className="ds-tag" x={14} y={y + 24}>
              [{b}]
            </text>
            <rect className="ds-slot" x={44} y={y} width={26} height={38} rx={6} />
            {chain.length === 0 ? (
              <text className="ds-tag" x={80} y={y + 24}>
                ∅
              </text>
            ) : (
              <Edge className="ds-link" x1={70} y1={y + 19} x2={92} y2={y + 19} marker />
            )}
            {chain.slice(0, -1).map((node, i) => (
              <Edge key={`l${node.id}`} className="ds-link" x1={96 + i * 100 + 64} y1={y + 19} x2={96 + (i + 1) * 100 - 4} y2={y + 19} marker />
            ))}
          </g>
        );
      })}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <rect className="ds-box" width={62} height={38} rx={9} />
          <text className="ds-value" x={31} y={24}>
            {p.value}
          </text>
        </GlideG>
      ))}
    </svg>
  );
}

function OAHashScene({ frame, slots }: { frame: Frame; slots: (({ id: number; value: number }) | "tomb" | null)[] }) {
  const pitch = 56;
  const y = 46;
  const w = Math.max(460, 30 + slots.length * pitch + 30);
  const h = 150;
  const placed = slots.flatMap((s, i) =>
    s !== null && s !== "tomb" ? [{ id: s.id, value: s.value, x: 30 + i * pitch, y }] : [],
  );
  const lifts = useLifts(
    placed.map((p) => ({ key: p.id, cx: p.x + 23, cy: p.y + 19, w: 46, h: 38 })),
    BOX_LIFT,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <text className="ds-tag" x={30} y={26}>
        one flat array of {slots.length} slots — colliding keys probe for another slot instead of chaining:
      </text>
      {slots.map((s, i) => (
        <g key={`s${i}`}>
          <rect className="ds-slot" x={30 + i * pitch} y={y} width={46} height={38} rx={8} />
          {s === null && (
            <text className="ds-tag" x={30 + i * pitch + 23} y={y + 24} textAnchor="middle">
              ∅
            </text>
          )}
          {s === "tomb" && (
            <text className="ds-tag ds-tomb" x={30 + i * pitch + 23} y={y + 24} textAnchor="middle">
              ✝
            </text>
          )}
          <text className="ds-tag" x={30 + i * pitch + 23} y={y + 58} textAnchor="middle">
            {i}
          </text>
        </g>
      ))}
      {placed.map((p) => (
        <GlideG key={p.id} x={p.x} y={p.y} lift={lifts.get(p.id)} className={nodeClass(p.id, frame)}>
          <rect className="ds-box" width={46} height={38} rx={8} />
          <text className="ds-value" x={23} y={24}>
            {p.value}
          </text>
        </GlideG>
      ))}
      <text className="ds-tag" x={30} y={h - 14}>
        ∅ = never used (a search may stop) · ✝ = tombstone (a search must walk past)
      </text>
    </svg>
  );
}

function ArrayScene({ frame, items }: { frame: Frame; items: { id: number; value: number }[] }) {
  // Scale bars over the full min→max range so negatives get proportional
  // heights too (with 0 anchored inside the range when values straddle it).
  const values = items.map((n) => n.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const w = Math.max(460, 30 + items.length * 56 + 30);
  // Headroom is sized so the worst swap — a max-height bar arcing over
  // another max-height bar — still fits: base ≥ 2·maxBar + margin. The 34px
  // floor means every bar is tall enough to hold its number inside.
  const SCALE = 112;
  const MIN_BAR = 34;
  const maxBar = MIN_BAR + SCALE;
  const h = 2 * maxBar + 26 + 56;
  const base = h - 36;
  const barHs = new Map(items.map((node) => [node.id, MIN_BAR + ((node.value - min) / span) * SCALE]));
  const lifts = useLifts(
    items.map((node, i) => {
      const bh = barHs.get(node.id)!;
      return { key: node.id, cx: 30 + i * 56 + 22, cy: base - bh / 2, w: 44, h: bh };
    }),
    // A bar clears another when its bottom rises above the other's top.
    (_mover, other) => other.h + 12,
  );
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line className="ds-floor" x1={20} y1={base + 5} x2={w - 20} y2={base + 5} />
      {items.map((node, i) => {
        const barH = barHs.get(node.id)!;
        return (
          <GlideG key={node.id} x={30 + i * 56} y={base - barH} lift={lifts.get(node.id)} className={nodeClass(node.id, frame)}>
            <rect className="ds-bar" width={44} height={barH} rx={7} />
            <text className="ds-value" x={22} y={19}>
              {node.value}
            </text>
          </GlideG>
        );
      })}
      {items.map((node, i) => (
        <text key={`i${node.id}`} className="ds-tag" x={30 + i * 56 + 22} y={base + 22} textAnchor="middle">
          {i}
        </text>
      ))}
      {items.length === 0 && (
        <text className="ds-tag" x={26} y={40}>
          (empty array — add some values first)
        </text>
      )}
    </svg>
  );
}

export function DSView({ frame }: { frame: Frame }) {
  const data: DSData = frame.data;
  switch (data.kind) {
    case "list":
      return <ListScene frame={frame} nodes={data.nodes} />;
    case "stack":
      return <StackScene frame={frame} items={data.items} />;
    case "queue":
      return <QueueScene frame={frame} items={data.items} />;
    case "tree":
      return <TreeScene frame={frame} root={data.root} />;
    case "graph":
      return <GraphScene frame={frame} nodes={data.nodes} edges={data.edges} />;
    case "wgraph":
      return <WGraphScene frame={frame} nodes={data.nodes} edges={data.edges} directed={data.directed} />;
    case "btree":
      return <BTreeScene frame={frame} root={data.root} plus={data.plus} />;
    case "heap":
      return <HeapScene frame={frame} items={data.items} />;
    case "hash":
      return <HashScene frame={frame} buckets={data.buckets} />;
    case "oahash":
      return <OAHashScene frame={frame} slots={data.slots} />;
    case "array":
      return <ArrayScene frame={frame} items={data.items} />;
  }
}
