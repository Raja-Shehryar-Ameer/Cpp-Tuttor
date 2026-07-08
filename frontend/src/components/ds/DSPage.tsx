import {
  ArrowLeftRight,
  ChevronFirst,
  GraduationCap,
  Pause,
  Play,
  Plus,
  Search,
  Shuffle,
  StepBack,
  StepForward,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  avlInsert,
  bstInsert,
  bstRemove,
  bstSearch,
  graphAddEdge,
  graphAddNode,
  graphTraverse,
  listInsertBack,
  listInsertFront,
  listRemove,
  listSearch,
  queueDequeue,
  queueEnqueue,
  rbInsert,
  stackPop,
  stackPush,
  type DSData,
  type Frame,
  type TreeNode,
} from "../../ds/engine";
import { DSView } from "./DSView";

type Structure = "list" | "stack" | "queue" | "bst" | "avl" | "rb" | "graph";

const STRUCTURES: { key: Structure; label: string; intro: string }[] = [
  { key: "list", label: "Linked List", intro: "Nodes chained by next pointers. Type a value and insert it — watch the links rewire." },
  { key: "stack", label: "Stack", intro: "LIFO: the last thing pushed is the first thing popped. Try pushing a few values." },
  { key: "queue", label: "Queue", intro: "FIFO: elements leave in the order they arrived. Enqueue some values." },
  { key: "bst", label: "BST", intro: "Binary search tree: smaller keys live left, bigger keys right. Every walk is a lesson in halving." },
  { key: "avl", label: "AVL Tree", intro: "A BST that refuses to lean: after every insert it re-balances itself with rotations." },
  { key: "rb", label: "Red-Black", intro: "A BST balanced by coloring rules — red nodes may never stack, and every path carries equal black." },
  { key: "graph", label: "Graph", intro: "Vertices and edges. Build one, then run BFS or DFS and watch the frontier spread." },
];

const empty = (s: Structure): DSData => {
  if (s === "list") return { kind: "list", nodes: [] };
  if (s === "stack") return { kind: "stack", items: [] };
  if (s === "queue") return { kind: "queue", items: [] };
  if (s === "graph") return { kind: "graph", nodes: [], edges: [] };
  return { kind: "tree", root: null };
};

const rootOf = (d: DSData): TreeNode | null => (d.kind === "tree" ? d.root : null);

function parseValues(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((token) => Number(token))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

export function DSPage() {
  const [structure, setStructure] = useState<Structure>("list");
  const dataRef = useRef<Record<Structure, DSData>>({
    list: empty("list"),
    stack: empty("stack"),
    queue: empty("queue"),
    bst: empty("bst"),
    avl: empty("avl"),
    rb: empty("rb"),
    graph: empty("graph"),
  });
  const [frames, setFrames] = useState<Frame[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [value, setValue] = useState("");
  const [edgeA, setEdgeA] = useState("");
  const [edgeB, setEdgeB] = useState("");

  const meta = STRUCTURES.find((s) => s.key === structure)!;
  const data = dataRef.current[structure];
  const frame: Frame = frames[idx] ?? { data, hl: [], note: meta.intro };

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= frames.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1200);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);

  const run = (makeFrames: (d: DSData) => Frame[]) => {
    const produced = makeFrames(dataRef.current[structure]);
    if (produced.length === 0) return;
    dataRef.current[structure] = produced[produced.length - 1].data;
    setFrames(produced);
    setIdx(0);
    setPlaying(produced.length > 1);
  };

  /** Run one op per typed value, chaining lessons ("5, 3, 8" inserts all three). */
  const runEach = (op: (d: DSData, v: number) => Frame[]) => {
    const values = parseValues(value);
    if (values.length === 0) return;
    run((initial) => {
      let d = initial;
      const all: Frame[] = [];
      for (const v of values) {
        const produced = op(d, v);
        all.push(...produced);
        if (produced.length) d = produced[produced.length - 1].data;
      }
      return all;
    });
    setValue("");
  };

  const randomFill = () => {
    const pool = new Set<number>();
    while (pool.size < 6) pool.add(1 + Math.floor(Math.random() * 99));
    setValue([...pool].join(", "));
  };

  const reset = () => {
    dataRef.current[structure] = empty(structure);
    setFrames([]);
    setIdx(0);
    setPlaying(false);
  };

  const insertOps: Record<Structure, [string, (d: DSData, v: number) => Frame[]][]> = {
    list: [
      ["Insert front", (d, v) => listInsertFront(d as never, v)],
      ["Insert back", (d, v) => listInsertBack(d as never, v)],
    ],
    stack: [["Push", (d, v) => stackPush(d as never, v)]],
    queue: [["Enqueue", (d, v) => queueEnqueue(d as never, v)]],
    bst: [["Insert", (d, v) => bstInsert(rootOf(d), v)]],
    avl: [["Insert", (d, v) => avlInsert(rootOf(d), v)]],
    rb: [["Insert", (d, v) => rbInsert(rootOf(d), v)]],
    graph: [["Add vertex", (d, v) => graphAddNode(d as never, v)]],
  };

  const switchTo = (s: Structure) => {
    setStructure(s);
    setFrames([]);
    setIdx(0);
    setPlaying(false);
  };

  return (
    <div className="ds-page">
      <nav className="ds-tabs">
        {STRUCTURES.map((s) => (
          <button key={s.key} className={`ds-tab${s.key === structure ? " active" : ""}`} onClick={() => switchTo(s.key)}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="ds-opbar">
        <input
          className="ds-input"
          value={value}
          placeholder="value(s), e.g. 42 or 5, 3, 8"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runEach(insertOps[structure][0][1]);
          }}
        />
        {insertOps[structure].map(([label, op]) => (
          <button key={label} className="primary" onClick={() => runEach(op)}>
            <Plus size={13} /> {label}
          </button>
        ))}
        {structure === "list" && (
          <>
            <button onClick={() => runEach((d, v) => listRemove(d as never, v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runEach((d, v) => listSearch(d as never, v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {structure === "stack" && (
          <button onClick={() => run((d) => stackPop(d as never))}>
            <Trash2 size={13} /> Pop
          </button>
        )}
        {structure === "queue" && (
          <button onClick={() => run((d) => queueDequeue(d as never))}>
            <Trash2 size={13} /> Dequeue
          </button>
        )}
        {structure === "bst" && (
          <>
            <button onClick={() => runEach((d, v) => bstRemove(rootOf(d), v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runEach((d, v) => bstSearch(rootOf(d), v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {(structure === "avl" || structure === "rb") && (
          <button onClick={() => runEach((d, v) => bstSearch(rootOf(d), v))}>
            <Search size={13} /> Search
          </button>
        )}
        {structure === "graph" && (
          <span className="ds-edge-inputs">
            <input className="ds-input small" value={edgeA} placeholder="A" onChange={(e) => setEdgeA(e.target.value)} />
            <ArrowLeftRight size={12} aria-hidden="true" />
            <input className="ds-input small" value={edgeB} placeholder="B" onChange={(e) => setEdgeB(e.target.value)} />
            <button onClick={() => run((d) => graphAddEdge(d as never, Number(edgeA), Number(edgeB)))}>Add edge</button>
            <button onClick={() => run((d) => graphTraverse(d as never, Number(edgeA), "bfs"))}>BFS from A</button>
            <button onClick={() => run((d) => graphTraverse(d as never, Number(edgeA), "dfs"))}>DFS from A</button>
          </span>
        )}
        <button onClick={randomFill} title="fill the input with random values">
          <Shuffle size={13} /> Random
        </button>
        <button onClick={reset} title="clear this structure">
          <X size={13} /> Reset
        </button>
      </div>

      <div className="ds-canvas">
        <DSView frame={frame} />
      </div>

      <div className="ds-caption">
        <span className="ds-teacher">
          <GraduationCap size={16} aria-hidden="true" />
        </span>
        <p key={`${idx}-${frame.note}`} className="ds-note">
          {frame.note}
        </p>
        {frames.length > 1 && (
          <div className="transport ds-transport">
            <button onClick={() => setIdx(0)} disabled={idx === 0} title="restart lesson">
              <ChevronFirst size={15} />
            </button>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} title="previous step">
              <StepBack size={15} />
            </button>
            <button className="play-btn" onClick={() => setPlaying(!playing)} title="play / pause">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))} disabled={idx >= frames.length - 1} title="next step">
              <StepForward size={15} />
            </button>
            <span className="step-counter">
              {idx + 1} / {frames.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
