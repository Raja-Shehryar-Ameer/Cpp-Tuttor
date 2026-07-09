import {
  ArrowLeftRight,
  ArrowUpDown,
  ChevronFirst,
  CircleDot,
  Eye,
  Gauge,
  GitBranch,
  GraduationCap,
  Hash,
  Layers,
  Link2,
  ListOrdered,
  ListTree,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  Route,
  Search,
  SearchCheck,
  Shuffle,
  StepBack,
  StepForward,
  Trash2,
  Triangle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  arrayPush,
  arrayRemove,
  arrayUpdate,
  avlInsert,
  avlRemove,
  avlUpdate,
  bstInsert,
  bstRemove,
  bstSearch,
  bstUpdate,
  graphAddEdge,
  graphAddNode,
  graphPath,
  graphRemoveEdge,
  graphRemoveNode,
  graphTraverse,
  graphUpdateNode,
  HASH_BUCKETS,
  hashInsert,
  hashRemove,
  hashSearch,
  hashUpdate,
  heapExtract,
  heapInsert,
  heapRemove,
  heapUpdate,
  listInsertBack,
  listInsertFront,
  listRemove,
  listSearch,
  listUpdate,
  queueDequeue,
  queueEnqueue,
  queuePeek,
  queueUpdateFront,
  rbInsert,
  rbRemove,
  rbUpdate,
  searchBinary,
  searchLinear,
  sortBubble,
  sortHeap,
  sortInsertion,
  sortMerge,
  sortQuick,
  sortSelection,
  stackPeek,
  stackPop,
  stackPush,
  stackUpdateTop,
  treeTraverse,
  type DSData,
  type Frame,
  type ListNode,
  type TreeNode,
} from "../../ds/engine";
import { DSView } from "./DSView";

type Structure =
  | "list"
  | "stack"
  | "queue"
  | "bst"
  | "avl"
  | "rb"
  | "heap"
  | "hash"
  | "graph"
  | "array"
  | "search";

const MAX_BATCH = 24; // more values than this per op makes the lesson unwatchable

const STRUCTURES: { key: Structure; label: string; icon: ComponentType<{ size?: number | string }>; intro: string }[] = [
  { key: "list", label: "Linked List", icon: Link2, intro: "Nodes chained by next pointers. Type a value and insert it — watch the links rewire." },
  { key: "stack", label: "Stack", icon: Layers, intro: "LIFO: the last thing pushed is the first thing popped. Try pushing a few values." },
  { key: "queue", label: "Queue", icon: ListOrdered, intro: "FIFO: elements leave in the order they arrived. Enqueue some values." },
  { key: "bst", label: "BST", icon: GitBranch, intro: "Binary search tree: smaller keys live left, bigger keys right. Every walk is a lesson in halving." },
  { key: "avl", label: "AVL Tree", icon: ListTree, intro: "A BST that refuses to lean: after every insert it re-balances itself with rotations." },
  { key: "rb", label: "Red-Black", icon: CircleDot, intro: "A BST balanced by coloring rules — red nodes may never stack, and every path carries equal black." },
  { key: "heap", label: "Min-Heap", icon: Triangle, intro: "A complete tree living inside a plain array: every parent ≤ its children, so the minimum is always at the root." },
  { key: "hash", label: "Hash Table", icon: Hash, intro: `hash(key) = key mod ${HASH_BUCKETS} jumps straight to a bucket — collisions chain into little linked lists.` },
  { key: "graph", label: "Graph", icon: Network, intro: "Vertices and edges. Build one, then run BFS or DFS and watch the frontier spread." },
  { key: "array", label: "Sorting", icon: ArrowUpDown, intro: "Load some values, then pick an algorithm and watch every comparison and swap, one step at a time." },
  { key: "search", label: "Searching", icon: SearchCheck, intro: "Two ways to find a value: linear checks every slot; binary halves a SORTED range each step. Load values, then search." },
];

const empty = (s: Structure): DSData => {
  if (s === "list") return { kind: "list", nodes: [] };
  if (s === "stack") return { kind: "stack", items: [] };
  if (s === "queue") return { kind: "queue", items: [] };
  if (s === "graph") return { kind: "graph", nodes: [], edges: [] };
  if (s === "heap") return { kind: "heap", items: [] };
  if (s === "hash") return { kind: "hash", buckets: Array.from({ length: HASH_BUCKETS }, () => []) };
  if (s === "array" || s === "search") return { kind: "array", items: [] };
  return { kind: "tree", root: null };
};

const rootOf = (d: DSData): TreeNode | null => (d.kind === "tree" ? d.root : null);

function parseValues(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .filter((token) => token.length > 0)
    .map((token) => Number(token))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

const SPEEDS = [
  { label: "0.5×", ms: 2200 },
  { label: "1×", ms: 1200 },
  { label: "2×", ms: 600 },
];

export function DSPage() {
  const [structure, setStructure] = useState<Structure>("list");
  const dataRef = useRef<Record<Structure, DSData>>({
    list: empty("list"),
    stack: empty("stack"),
    queue: empty("queue"),
    bst: empty("bst"),
    avl: empty("avl"),
    rb: empty("rb"),
    heap: empty("heap"),
    hash: empty("hash"),
    graph: empty("graph"),
    array: empty("array"),
    search: empty("search"),
  });
  const [frames, setFrames] = useState<Frame[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // index into SPEEDS
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
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
  }, [playing, frames.length, speed]);

  /** One-frame teacher message without touching the stored structure. */
  const say = (note: string) => {
    setFrames([{ data: dataRef.current[structure], hl: [], bad: [], note }]);
    setIdx(0);
    setPlaying(false);
  };

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
    if (values.length === 0) {
      say(
        value.trim()
          ? `I couldn't read any numbers in “${value.trim()}” — type digits like 5, 3, 8 (commas or spaces between them).`
          : "Type a value in the box first — one number, or several separated by commas.",
      );
      return;
    }
    if (values.length > MAX_BATCH) {
      say(`That's ${values.length} values — keep it to ${MAX_BATCH} or fewer so each step stays readable.`);
      return;
    }
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

  /** Ops that need an (old, new) pair, typed as "old, new" in the value box. */
  const runPair = (op: (d: DSData, a: number, b: number) => Frame[]) => {
    const values = parseValues(value);
    if (values.length < 2) {
      say("Update needs two numbers in the box — old value, new value — e.g. 10, 25.");
      return;
    }
    run((d) => op(d, values[0], values[1]));
    setValue("");
  };

  /** Graph ops read the little A/B boxes; blank or non-numeric input gets a hint, not NaN. */
  const vertexOf = (raw: string): number | null => {
    const n = Number(raw.trim());
    return raw.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const runEdge = (needB: boolean, op: (d: DSData, a: number, b: number) => Frame[]) => {
    const a = vertexOf(edgeA);
    const b = needB ? vertexOf(edgeB) : 0;
    if (a === null || b === null) {
      say(needB ? "Fill both vertex boxes — A and B — with numbers first." : "Fill the A box with a vertex number first.");
      return;
    }
    run((d) => op(d, a, b));
  };

  /** Searching tab helper: sort in one hop so binary search becomes legal. */
  const sortInstantly = () => {
    run((d) => {
      const items = [...(d as { items: ListNode[] }).items].sort((a, b) => a.value - b.value);
      if (items.length === 0) return [{ data: { kind: "array", items }, hl: [], note: "Nothing to sort yet — add some values first." } as Frame];
      return [
        {
          data: { kind: "array", items },
          hl: items.map((n) => n.id),
          note: "Sorted ascending in one hop — binary search is now allowed. (To watch HOW sorting works, visit the Sorting tab.)",
        } as Frame,
      ];
    });
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
    heap: [["Insert", (d, v) => heapInsert(d as never, v)]],
    hash: [["Insert", (d, v) => hashInsert(d as never, v)]],
    graph: [["Add vertex", (d, v) => graphAddNode(d as never, v)]],
    array: [["Add", (d, v) => arrayPush(d as never, v)]],
    search: [["Add", (d, v) => arrayPush(d as never, v)]],
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
            <s.icon size={13} aria-hidden="true" />
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
            <button onClick={() => runPair((d, a, b) => listUpdate(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => listSearch(d as never, v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {structure === "stack" && (
          <>
            <button onClick={() => run((d) => stackPop(d as never))}>
              <Trash2 size={13} /> Pop
            </button>
            <button onClick={() => runEach((d, v) => stackUpdateTop(d as never, v))} title="overwrite the top with the typed value">
              <Pencil size={13} /> Update top
            </button>
            <button onClick={() => run((d) => stackPeek(d as never))}>
              <Eye size={13} /> Peek
            </button>
          </>
        )}
        {structure === "queue" && (
          <>
            <button onClick={() => run((d) => queueDequeue(d as never))}>
              <Trash2 size={13} /> Dequeue
            </button>
            <button onClick={() => runEach((d, v) => queueUpdateFront(d as never, v))} title="overwrite the front with the typed value">
              <Pencil size={13} /> Update front
            </button>
            <button onClick={() => run((d) => queuePeek(d as never))}>
              <Eye size={13} /> Peek
            </button>
          </>
        )}
        {structure === "bst" && (
          <>
            <button onClick={() => runEach((d, v) => bstRemove(rootOf(d), v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => bstUpdate(rootOf(d), a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => bstSearch(rootOf(d), v))}>
              <Search size={13} /> Search
            </button>
            <button onClick={() => run((d) => treeTraverse(rootOf(d), "in"))}>Inorder</button>
            <button onClick={() => run((d) => treeTraverse(rootOf(d), "pre"))}>Preorder</button>
            <button onClick={() => run((d) => treeTraverse(rootOf(d), "post"))}>Postorder</button>
          </>
        )}
        {structure === "avl" && (
          <>
            <button onClick={() => runEach((d, v) => avlRemove(rootOf(d), v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => avlUpdate(rootOf(d), a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => bstSearch(rootOf(d), v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {structure === "rb" && (
          <>
            <button onClick={() => runEach((d, v) => rbRemove(rootOf(d), v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => rbUpdate(rootOf(d), a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => bstSearch(rootOf(d), v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {structure === "heap" && (
          <>
            <button onClick={() => run((d) => heapExtract(d as never))}>
              <Trash2 size={13} /> Extract min
            </button>
            <button onClick={() => runEach((d, v) => heapRemove(d as never, v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => heapUpdate(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Update key
            </button>
          </>
        )}
        {structure === "hash" && (
          <>
            <button onClick={() => runEach((d, v) => hashRemove(d as never, v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => hashUpdate(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => hashSearch(d as never, v))}>
              <Search size={13} /> Search
            </button>
          </>
        )}
        {structure === "array" && (
          <>
            <button onClick={() => runEach((d, v) => arrayRemove(d as never, v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => arrayUpdate(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => run((d) => sortBubble(d as never))}>
              <ArrowUpDown size={13} /> Bubble
            </button>
            <button onClick={() => run((d) => sortInsertion(d as never))}>
              <ArrowUpDown size={13} /> Insertion
            </button>
            <button onClick={() => run((d) => sortSelection(d as never))}>
              <ArrowUpDown size={13} /> Selection
            </button>
            <button onClick={() => run((d) => sortMerge(d as never))}>
              <ArrowUpDown size={13} /> Merge
            </button>
            <button onClick={() => run((d) => sortQuick(d as never))}>
              <ArrowUpDown size={13} /> Quick
            </button>
            <button onClick={() => run((d) => sortHeap(d as never))}>
              <ArrowUpDown size={13} /> Heap
            </button>
          </>
        )}
        {structure === "search" && (
          <>
            <button onClick={() => runEach((d, v) => arrayRemove(d as never, v))}>
              <Trash2 size={13} /> Remove
            </button>
            <button onClick={() => runPair((d, a, b) => arrayUpdate(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Update
            </button>
            <button onClick={sortInstantly} title="sort ascending in one step so binary search is allowed">
              <ArrowUpDown size={13} /> Sort array
            </button>
            <button onClick={() => runEach((d, v) => searchLinear(d as never, v))}>
              <Search size={13} /> Linear search
            </button>
            <button onClick={() => runEach((d, v) => searchBinary(d as never, v))}>
              <SearchCheck size={13} /> Binary search
            </button>
          </>
        )}
        {structure === "graph" && (
          <>
            <button onClick={() => runEach((d, v) => graphRemoveNode(d as never, v))}>
              <Trash2 size={13} /> Remove vertex
            </button>
            <button onClick={() => runPair((d, a, b) => graphUpdateNode(d as never, a, b))} title="type: old, new">
              <Pencil size={13} /> Rename
            </button>
            <span className="ds-edge-inputs">
              <input className="ds-input small" value={edgeA} placeholder="A" onChange={(e) => setEdgeA(e.target.value)} />
              <ArrowLeftRight size={12} aria-hidden="true" />
              <input className="ds-input small" value={edgeB} placeholder="B" onChange={(e) => setEdgeB(e.target.value)} />
              <button onClick={() => runEdge(true, (d, a, b) => graphAddEdge(d as never, a, b))}>Add edge</button>
              <button onClick={() => runEdge(true, (d, a, b) => graphRemoveEdge(d as never, a, b))}>Remove edge</button>
              <button onClick={() => runEdge(false, (d, a) => graphTraverse(d as never, a, "bfs"))}>BFS from A</button>
              <button onClick={() => runEdge(false, (d, a) => graphTraverse(d as never, a, "dfs"))}>DFS from A</button>
              <button onClick={() => runEdge(true, (d, a, b) => graphPath(d as never, a, b))}>
                <Route size={13} /> Path A→B
              </button>
            </span>
          </>
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
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              title="scrub through the lesson"
              onChange={(e) => {
                setPlaying(false);
                setIdx(Number(e.target.value));
              }}
            />
            <button
              className="speed-btn"
              onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)}
              title="playback speed"
            >
              <Gauge size={13} /> {SPEEDS[speed].label}
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
