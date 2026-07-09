import type { CSSProperties, ReactNode } from "react";
import type { DSData, Frame, TreeNode } from "../../ds/engine";

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

// One SVG scene per structure family. Every node <g> is keyed by its stable
// id and positioned with a CSS-transitioned transform, so when a frame moves
// a node (rotation, shift, unlink) it glides instead of teleporting.

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
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <marker id="ds-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="ds-arrow-head" />
        </marker>
      </defs>
      {extras}
      {placed.map((p) => (
        <g key={p.id} className={nodeClass(p.id, frame)} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
          <rect className="ds-box" width={62} height={38} rx={9} />
          <text className="ds-value" x={31} y={24}>
            {p.value}
          </text>
        </g>
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
  const h = Math.max(220, items.length * 46 + 70);
  const placed = items.map((n, i) => ({ ...n, x: 90, y: h - 58 - i * 46 }));
  const top = placed[placed.length - 1];
  return (
    <Boxes
      frame={frame}
      placed={placed}
      w={330}
      h={h}
      extras={
        <>
          <line className="ds-floor" x1={70} y1={h - 12} x2={172} y2={h - 12} />
          {top && (
            <text className="ds-tag" x={168} y={top.y + 24}>
              ← top
            </text>
          )}
          {!top && (
            <text className="ds-tag" x={82} y={h - 30}>
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
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {edges.map(([a, b]) => (
        <Edge key={`e${b.id}`} className="ds-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      ))}
      {placed.map((p) => (
        <g key={p.id} className={`${nodeClass(p.id, frame)}${p.color ? ` rb-${p.color}` : ""}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </g>
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
  const w = 520;
  const h = 340;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 46;
  const placed = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    return { ...n, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const at = new Map(placed.map((p) => [p.id, p]));
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {edges.map(([a, b]) => {
        const pa = at.get(a);
        const pb = at.get(b);
        return pa && pb ? <Edge key={`e${a}-${b}`} className="ds-edge" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} /> : null;
      })}
      {placed.map((p) => (
        <g key={p.id} className={nodeClass(p.id, frame)} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </g>
      ))}
      {placed.length === 0 && (
        <text className="ds-tag" x={30} y={60}>
          (no vertices yet)
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
  const arrY = 40 + depthMax * 66 + 64;
  const h = arrY + 76;
  const placed = items.map((node, i) => {
    const depth = Math.floor(Math.log2(i + 1));
    const row = Math.pow(2, depth);
    const j = i + 1 - row;
    return { ...node, i, x: (w * (2 * j + 1)) / (2 * row), y: 40 + depth * 66 };
  });
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {placed.slice(1).map((p) => {
        const parent = placed[(p.i - 1) >> 1];
        return <Edge key={`e${p.id}`} className="ds-edge" x1={parent.x} y1={parent.y} x2={p.x} y2={p.y} />;
      })}
      {placed.map((p) => (
        <g key={p.id} className={nodeClass(p.id, frame)} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
          <circle className="ds-circle" r={21} />
          <text className="ds-value" y={5.5}>
            {p.value}
          </text>
        </g>
      ))}
      <g>
        {items.map((node, i) => (
          <g key={node.id} className={nodeClass(node.id, frame)} style={{ transform: `translate(${30 + i * 54}px, ${arrY}px)` }}>
            <rect className="ds-box" width={46} height={38} rx={8} />
            <text className="ds-value" x={23} y={24}>
              {node.value}
            </text>
          </g>
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
      {buckets.flatMap((chain, b) =>
        chain.map((node, i) => (
          <g
            key={node.id}
            className={nodeClass(node.id, frame)}
            style={{ transform: `translate(${96 + i * 100}px, ${20 + b * rowH}px)` }}
          >
            <rect className="ds-box" width={62} height={38} rx={9} />
            <text className="ds-value" x={31} y={24}>
              {node.value}
            </text>
          </g>
        )),
      )}
    </svg>
  );
}

function ArrayScene({ frame, items }: { frame: Frame; items: { id: number; value: number }[] }) {
  const max = Math.max(1, ...items.map((n) => n.value));
  const w = Math.max(460, 30 + items.length * 56 + 30);
  const h = 252;
  const base = h - 36;
  return (
    <svg className="ds-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line className="ds-floor" x1={20} y1={base + 5} x2={w - 20} y2={base + 5} />
      {items.map((node, i) => {
        // Clamp so zero/negative values still draw a visible, valid bar.
        const barH = Math.max(12, 26 + (node.value / max) * 150);
        return (
          <g key={node.id} className={nodeClass(node.id, frame)} style={{ transform: `translate(${30 + i * 56}px, ${base - barH}px)` }}>
            <rect className="ds-bar" width={44} height={barH} rx={7} />
            <text className="ds-value" x={22} y={19}>
              {node.value}
            </text>
          </g>
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
    case "heap":
      return <HeapScene frame={frame} items={data.items} />;
    case "hash":
      return <HashScene frame={frame} buckets={data.buckets} />;
    case "array":
      return <ArrayScene frame={frame} items={data.items} />;
  }
}
