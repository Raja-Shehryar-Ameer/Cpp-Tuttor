import {
  ArrowLeftRight,
  ArrowUpDown,
  ChevronFirst,
  CircleDot,
  Cpu,
  Download,
  Eye,
  GitBranch,
  GraduationCap,
  HardDrive,
  Hash,
  Info,
  LayoutGrid,
  Layers,
  ListPlus,
  Link2,
  ListOrdered,
  ListTree,
  Lock,
  MemoryStick,
  Network,
  Rows3,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Route,
  Search,
  SearchCheck,
  Shuffle,
  StepBack,
  StepForward,
  Target,
  Trash2,
  Triangle,
  Workflow,
  Zap,
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
  graphRemoveEdge,
  graphRemoveNode,
  graphUpdateNode,
  emptyOA,
  HASH_BUCKETS,
  hashInsert,
  hashRemove,
  hashSearch,
  hashUpdate,
  oaHashInsert,
  oaHashRemove,
  oaHashSearch,
  oaHashUpdate,
  OA_SLOTS,
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
  type Probe,
  type TreeNode,
} from "../../ds/engine";
import { BT_ORDERS, btInsert, btRemove, btSearch, emptyBTree } from "../../ds/btree";
import {
  MAX_WG_EDGES,
  MAX_WG_VERTICES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WGRAPH_ALGOS,
  wgraphAddEdge,
  wgraphAddNode,
  wgraphDijkstra,
  wgraphKruskal,
  wgraphPathBfs,
  wgraphPrim,
  wgraphRemoveEdge,
  wgraphRemoveNode,
  wgraphSetDirected,
  wgraphTopo,
  wgraphTraverse,
  type WAlgo,
  type WGraph,
} from "../../ds/wgraph";
import { readLabParam, writeLabParam } from "../../ds/permalink";
import { exportSvgsPng } from "../../utils/exportPng";
import { notify } from "../../store/toastStore";
import { DeadlockLab } from "./DeadlockLab";
import { DiskLab } from "./DiskLab";
import { DSView } from "./DSView";
import { PagingLab } from "./PagingLab";
import { PredictChips, QuizPanel, usePredictScore } from "./predict";
import { SortRace } from "./SortRace";
import { SchedLab } from "./SchedLab";
import { SpeedSelect } from "./SpeedSelect";
import { ThreadsLab } from "./ThreadsLab";

type Structure =
  | "list"
  | "stack"
  | "queue"
  | "bst"
  | "avl"
  | "rb"
  | "heap"
  | "hash"
  | "btree"
  | "graph"
  | "wgraph"
  | "array"
  | "search";

/** Everything selectable on the topic grid: data structures plus the labs
    that own their whole toolbar/stage/caption (OS labs + the sorting race). */
type LabTopic = "sched" | "threads" | "paging" | "deadlock" | "disk" | "sortrace";
type Topic = Structure | LabTopic;

const isLabTopic = (t: Topic): t is LabTopic =>
  t === "sched" || t === "threads" || t === "paging" || t === "deadlock" || t === "disk" || t === "sortrace";

type Category = "Data structures" | "Algorithms" | "Operating systems";

const CATEGORY: Record<Topic, Category> = {
  list: "Data structures", stack: "Data structures", queue: "Data structures",
  bst: "Data structures", avl: "Data structures", rb: "Data structures",
  heap: "Data structures", hash: "Data structures", btree: "Data structures",
  graph: "Data structures",
  array: "Algorithms", search: "Algorithms", wgraph: "Algorithms", sortrace: "Algorithms",
  sched: "Operating systems", threads: "Operating systems", paging: "Operating systems",
  deadlock: "Operating systems", disk: "Operating systems",
};

const MAX_BATCH = 24; // more values than this per op makes the lesson unwatchable
const MAX_BULK = 32; // bulk editor cap — beyond this the canvas stops being readable
const MAX_BULK_VERTICES = 20;
// Values are clamped so numbers always fit their boxes and circles.
const V_MIN = -999;
const V_MAX = 9999;

interface StructureMeta {
  key: Structure;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  intro: string;
  complexity: string[];
  bulkPlaceholder: string;
  bulkHint: string;
}

const STRUCTURES: StructureMeta[] = [
  {
    key: "list", label: "Linked List", icon: Link2,
    intro: "Nodes chained by next pointers. Type a value and insert it — watch the links rewire.",
    complexity: ["Access O(n)", "Insert front O(1)", "Search O(n)"],
    bulkPlaceholder: "5, 3, 8, 1", bulkHint: "values separated by commas, spaces, or new lines — linked left to right",
  },
  {
    key: "stack", label: "Stack", icon: Layers,
    intro: "LIFO: the last thing pushed is the first thing popped. Try pushing a few values.",
    complexity: ["Push O(1)", "Pop O(1)", "Peek O(1)"],
    bulkPlaceholder: "5, 3, 8, 1", bulkHint: "values pushed in order — the last one ends up on top",
  },
  {
    key: "queue", label: "Queue", icon: ListOrdered,
    intro: "FIFO: elements leave in the order they arrived. Enqueue some values.",
    complexity: ["Enqueue O(1)", "Dequeue O(1)", "Peek O(1)"],
    bulkPlaceholder: "5, 3, 8, 1", bulkHint: "values enqueued in order — the first one is the front",
  },
  {
    key: "bst", label: "BST", icon: GitBranch,
    intro: "Binary search tree: smaller keys live left, bigger keys right. Every walk is a lesson in halving.",
    complexity: ["Search O(h)", "Insert O(h)", "h = height, O(log n) when balanced"],
    bulkPlaceholder: "8, 3, 10, 1, 6, 14", bulkHint: "insertion order shapes the tree — try sorted input to see it degenerate",
  },
  {
    key: "avl", label: "AVL Tree", icon: ListTree,
    intro: "A BST that refuses to lean: after every insert it re-balances itself with rotations.",
    complexity: ["Search O(log n)", "Insert O(log n)", "Remove O(log n)"],
    bulkPlaceholder: "1, 2, 3, 4, 5, 6", bulkHint: "even sorted input stays balanced — rotations happen while loading",
  },
  {
    key: "rb", label: "Red-Black", icon: CircleDot,
    intro: "A BST balanced by coloring rules — red nodes may never stack, and every path carries equal black.",
    complexity: ["Search O(log n)", "Insert O(log n)", "Remove O(log n)"],
    bulkPlaceholder: "10, 20, 30, 15, 5, 25", bulkHint: "values inserted in order, recoloring and rotating as needed",
  },
  {
    key: "heap", label: "Min-Heap", icon: Triangle,
    intro: "A complete tree living inside a plain array: every parent ≤ its children, so the minimum is always at the root.",
    complexity: ["Insert O(log n)", "Extract-min O(log n)", "Peek-min O(1)"],
    bulkPlaceholder: "50, 20, 40, 10, 30", bulkHint: "values sift into place while loading — the minimum surfaces at the root",
  },
  {
    key: "hash", label: "Hash Table", icon: Hash,
    intro: `hash(key) = key mod ${HASH_BUCKETS} jumps straight to a bucket — collisions chain into little linked lists.`,
    complexity: ["Insert O(1) avg", "Search O(1) avg", "Worst case O(n)"],
    bulkPlaceholder: "7, 14, 21, 3, 10", bulkHint: `keys land in bucket (key mod ${HASH_BUCKETS}) — same-bucket keys chain up`,
  },
  {
    key: "btree", label: "B-Trees", icon: Rows3,
    intro: "The disk-friendly search tree: wide nodes holding several keys each, splitting upward as they fill. Switch to B+ mode to see values pushed to a linked leaf level — the shape inside every database index.",
    complexity: ["Search O(log n)", "Insert O(log n)", "Delete O(log n) — borrow/merge"],
    bulkPlaceholder: "10, 20, 5, 6, 12, 30, 7, 17", bulkHint: "values inserted in order — watch nodes overflow and split upward",
  },
  {
    key: "graph", label: "Graph", icon: Network,
    intro: "The structure itself: vertices and an adjacency list. Build and reshape it here — to RUN algorithms on a graph, open Graph Algorithms.",
    complexity: ["Add vertex O(1)", "Remove vertex O(V+E)", "Adjacency list O(V+E)"],
    bulkPlaceholder: "1 2\n2 3\n3 1\n4", bulkHint: "one edge per line as “A B” — a lone number adds an isolated vertex",
  },
  {
    key: "wgraph", label: "Graph Algorithms", icon: Route,
    intro: "Weighted edges, directed or not — run Dijkstra, Prim, Kruskal, topological sort, BFS, and DFS, and watch every decision narrated.",
    complexity: ["Dijkstra O((V+E) log V)", "MST: Prim / Kruskal", "Topo sort O(V+E)"],
    bulkPlaceholder: "1 2 5\n2 3 2\n3 1 4\n3 4 7", bulkHint: "one edge per line as “A B w” (weight optional, defaults 1) — a lone number adds a vertex",
  },
  {
    key: "array", label: "Sorting", icon: ArrowUpDown,
    intro: "Load some values, then pick an algorithm and watch every comparison and swap, one step at a time.",
    complexity: ["Bubble/Insertion O(n²)", "Merge/Heap O(n log n)", "Quick O(n log n) avg"],
    bulkPlaceholder: "29, 5, 17, 3, 42, 11", bulkHint: "values in the order they'll sit before sorting",
  },
  {
    key: "search", label: "Searching", icon: SearchCheck,
    intro: "Two ways to find a value: linear checks every slot; binary halves a SORTED range each step. Load values, then search.",
    complexity: ["Linear O(n)", "Binary O(log n) — needs sorted input"],
    bulkPlaceholder: "29, 5, 17, 3, 42, 11", bulkHint: "load values, sort, then race linear against binary",
  },
];

// Lab topics live outside StructureMeta — they bring their own toolbars and
// canvases, so they only need card/tab metadata here.
interface LabTopicMeta {
  key: LabTopic;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  intro: string;
  complexity: string[];
}

const OS_TOPICS: LabTopicMeta[] = [
  {
    key: "sortrace", label: "Sorting Race", icon: Zap,
    intro: "Two sorting algorithms, one array, side by side — live comparison and swap counters make the O(n²) vs O(n log n) gap something you can watch.",
    complexity: ["2 algorithms in lockstep", "live op counters", "same input, fair fight"],
  },
  {
    key: "sched", label: "CPU Scheduling", icon: Cpu,
    intro: "FCFS, SJF, SRTF, LJF, LRTF, HRRN, Priority (both flavors), and Round Robin — animated Gantt charts, ready queues, and every metric an exam can ask for.",
    complexity: ["9 algorithms", "TAT / WT / RT + averages", "compare-all table"],
  },
  {
    key: "threads", label: "Threads: ULT vs KLT", icon: Workflow,
    intro: "User-level vs kernel-level threads: the three mapping models, and what really happens to sibling threads when one blocks in a syscall.",
    complexity: ["Many-to-One", "One-to-One", "Many-to-Many"],
  },
  {
    key: "paging", label: "Page Replacement", icon: MemoryStick,
    intro: "FIFO, LRU, Optimal, Clock, and LFU fighting over a handful of frames — the textbook grid, hit/fault ratios, and the preset where MORE memory means MORE faults.",
    complexity: ["5 algorithms", "hit / fault ratio", "Belady's anomaly"],
  },
  {
    key: "deadlock", label: "Deadlock & Banker's", icon: Lock,
    intro: "Banker's algorithm and deadlock detection over multi-instance resources — watch Work grow, the safe sequence build, and the resource-allocation graph light up its cycle when the answer is 'deadlocked'.",
    complexity: ["Banker's safety check", "detection mode", "RAG cycle highlight"],
  },
  {
    key: "disk", label: "Disk Scheduling", icon: HardDrive,
    intro: "FCFS, SSTF, SCAN, C-SCAN, LOOK, and C-LOOK racing over the same request queue — the head-movement zigzag every OS exam draws, with total and average seek.",
    complexity: ["6 algorithms", "total / avg seek", "direction & wraparound"],
  },
];

const ALL_TOPICS: { key: Topic; label: string; icon: ComponentType<{ size?: number | string }>; intro: string; complexity: string[] }[] = [
  ...STRUCTURES.map((s) => ({ key: s.key as Topic, label: s.label, icon: s.icon, intro: s.intro, complexity: s.complexity })),
  ...OS_TOPICS.map((s) => ({ key: s.key as Topic, label: s.label, icon: s.icon, intro: s.intro, complexity: s.complexity })),
];

const CATEGORIES: Category[] = ["Data structures", "Algorithms", "Operating systems"];

const empty = (s: Structure): DSData => {
  if (s === "list") return { kind: "list", nodes: [] };
  if (s === "stack") return { kind: "stack", items: [] };
  if (s === "queue") return { kind: "queue", items: [] };
  if (s === "graph") return { kind: "graph", nodes: [], edges: [] };
  if (s === "wgraph") return { kind: "wgraph", nodes: [], edges: [], directed: false };
  if (s === "btree") return emptyBTree(3, false);
  if (s === "heap") return { kind: "heap", items: [] };
  if (s === "hash") return { kind: "hash", buckets: Array.from({ length: HASH_BUCKETS }, () => []) };
  if (s === "array" || s === "search") return { kind: "array", items: [] };
  return { kind: "tree", root: null };
};

const rootOf = (d: DSData): TreeNode | null => (d.kind === "tree" ? d.root : null);

function parseValues(raw: string): { values: number[]; outOfRange: number[] } {
  const all = raw
    .split(/[\s,;]+/)
    .filter((token) => token.length > 0)
    .map((token) => Number(token))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
  return {
    values: all.filter((n) => n >= V_MIN && n <= V_MAX),
    outOfRange: all.filter((n) => n < V_MIN || n > V_MAX),
  };
}

// First-visit tracking for the per-structure info panel.
const SEEN_KEY = "cpptutor-ds-seen";
function loadSeen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

// Slow enough that every glide (600ms) finishes and the note can be read
// before the next step fires.
const SPEEDS = [
  { label: "0.5×", ms: 3200 },
  { label: "1×", ms: 1800 },
  { label: "2×", ms: 900 },
];

type HashMode = "chain" | Probe;

export function DSPage() {
  // A `?lab=` permalink decodes to an initial scenario (read once).
  const initialLink = useRef(readLabParam()).current;
  // null = the VisuAlgo-style topic grid; a key = that lab is open.
  const [topic, setTopic] = useState<Topic | null>(initialLink ? initialLink.lab : null);
  // Data-structure code paths only run when the open topic IS a structure;
  // the "list" fallback keeps types tight and is never rendered otherwise.
  const structure: Structure = topic !== null && !isLabTopic(topic) ? topic : "list";
  const dataRef = useRef<Record<Structure, DSData>>({
    list: empty("list"),
    stack: empty("stack"),
    queue: empty("queue"),
    bst: empty("bst"),
    avl: empty("avl"),
    rb: empty("rb"),
    heap: empty("heap"),
    hash: empty("hash"),
    btree: empty("btree"),
    graph: empty("graph"),
    wgraph: empty("wgraph"),
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
  const [edgeW, setEdgeW] = useState("");
  const [wgAlgo, setWgAlgo] = useState<WAlgo>("dijkstra");
  const [wgFrom, setWgFrom] = useState("");
  const [wgTo, setWgTo] = useState("");
  // Predict mode (Graph Algorithms only): pause before each decision frame.
  const [predictOn, setPredictOn] = useState(false);
  const [quizAt, setQuizAt] = useState<number | null>(null);
  const quizDone = useRef(new Set<number>());
  const predict = usePredictScore();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [hashMode, setHashMode] = useState<HashMode>("chain");
  const [btOrder, setBtOrder] = useState(3);
  const [btPlus, setBtPlus] = useState(false);

  /** Variant/degree changes reset the tree — old shapes aren't valid under new rules. */
  const switchBTree = (order: number, plus: boolean) => {
    setBtOrder(order);
    setBtPlus(plus);
    dataRef.current.btree = emptyBTree(order, plus);
    setFrames([{
      data: dataRef.current.btree, hl: [],
      note: plus
        ? `B+ tree, max degree ${order}: every VALUE lives in a leaf, internal nodes hold routing copies, and the leaves chain left-to-right. Fresh tree.`
        : `B-tree, max degree ${order}: up to ${order - 1} keys per node, values stored everywhere, splits push the median up. Fresh tree.`,
    }]);
    setIdx(0);
    setPlaying(false);
  };

  const emptyHash = (mode: HashMode): DSData => (mode === "chain" ? empty("hash") : emptyOA(mode));

  const switchHashMode = (mode: HashMode) => {
    setHashMode(mode);
    dataRef.current.hash = emptyHash(mode);
    setFrames([{
      data: dataRef.current.hash, hl: [],
      note: mode === "chain"
        ? `Chaining: hash(key) = key mod ${HASH_BUCKETS} — colliding keys link up inside their bucket.`
        : `${mode === "linear" ? "Linear" : "Quadratic"} probing: ${OA_SLOTS} flat slots — a colliding key walks ${mode === "linear" ? "+1, +2, +3…" : "+1², +2², +3²…"} until it finds a free one. Fresh table.`,
    }]);
    setIdx(0);
    setPlaying(false);
  };

  const meta = STRUCTURES.find((s) => s.key === structure)!;
  const data = dataRef.current[structure];
  const frame: Frame = frames[idx] ?? { data, hl: [], note: meta.intro };

  const idxRef = useRef(idx);
  idxRef.current = idx;

  /** Predict gate: true when advancing INTO frame `target` must pause and ask. */
  const gated = (target: number): boolean =>
    predictOn && structure === "wgraph" && frames[target]?.quiz !== undefined && !quizDone.current.has(target);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const next = idxRef.current + 1;
      if (next >= frames.length) {
        setPlaying(false);
        return;
      }
      if (gated(next)) {
        setPlaying(false);
        setQuizAt(next);
        return;
      }
      setIdx(next);
    }, SPEEDS[speed].ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frames, speed, predictOn]);

  /** Scrubbing or restarting abandons a pending question without penalty. */
  const dismissQuiz = () => {
    if (quizAt !== null) {
      quizDone.current.add(quizAt);
      setQuizAt(null);
    }
  };

  /** One-frame teacher message without touching the stored structure. */
  const say = (note: string) => {
    setFrames([{ data: dataRef.current[structure], hl: [], bad: [], note }]);
    setIdx(0);
    setPlaying(false);
    quizDone.current = new Set();
    setQuizAt(null);
  };

  const run = (makeFrames: (d: DSData) => Frame[]) => {
    const produced = makeFrames(dataRef.current[structure]);
    if (produced.length === 0) return;
    dataRef.current[structure] = produced[produced.length - 1].data;
    setFrames(produced);
    setIdx(0);
    setPlaying(produced.length > 1);
    quizDone.current = new Set();
    setQuizAt(null);
  };

  /** Run one op per typed value, chaining lessons ("5, 3, 8" inserts all three). */
  const runEach = (op: (d: DSData, v: number) => Frame[]) => {
    const { values, outOfRange } = parseValues(value);
    if (outOfRange.length > 0) {
      say(`Keep values between ${V_MIN} and ${V_MAX} so they fit their boxes — ${outOfRange.join(", ")} ${outOfRange.length === 1 ? "is" : "are"} out of range.`);
      return;
    }
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
    const { values } = parseValues(value);
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
    // Same clamp every other input path enforces — huge labels break the SVG.
    const oob = [a, ...(needB ? [b] : [])].filter((v) => v < V_MIN || v > V_MAX);
    if (oob.length > 0) {
      say(`Keep vertex values between ${V_MIN} and ${V_MAX} so they fit their circles — ${oob.join(", ")} ${oob.length === 1 ? "is" : "are"} out of range.`);
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

  /** Build a small random weighted graph in one hop: spanning tree + extras. */
  const wgRandom = () => {
    const directed = (dataRef.current.wgraph as WGraph).directed;
    let d: WGraph = { kind: "wgraph", nodes: [], edges: [], directed };
    const apply = (frames: Frame[]) => {
      if (frames.length > 0) d = frames[frames.length - 1].data as WGraph;
    };
    const n = 5 + Math.floor(Math.random() * 3); // 5..7 vertices
    for (let v = 1; v <= n; v += 1) apply(wgraphAddNode(d, v));
    for (let v = 2; v <= n; v += 1) apply(wgraphAddEdge(d, 1 + Math.floor(Math.random() * (v - 1)), v, 1 + Math.floor(Math.random() * 20)));
    for (let k = 0; k < n - 2; k += 1) {
      const a = 1 + Math.floor(Math.random() * n);
      const b = 1 + Math.floor(Math.random() * n);
      if (a !== b) apply(wgraphAddEdge(d, a, b, 1 + Math.floor(Math.random() * 20)));
    }
    dataRef.current.wgraph = d;
    setFrames([{ data: d, hl: [], note: `Random ${directed ? "directed " : ""}graph: ${d.nodes.length} vertices, ${d.edges.length} weighted edges. Pick an algorithm below and press Run.` }]);
    setIdx(0);
    setPlaying(false);
  };

  const randomFill = () => {
    if (structure === "wgraph") {
      wgRandom();
      return;
    }
    const pool = new Set<number>();
    while (pool.size < 6) pool.add(1 + Math.floor(Math.random() * 99));
    setValue([...pool].join(", "));
  };

  /** Run the selected weighted-graph algorithm, validating its inputs first. */
  /** Serialize the current weighted graph + selected algorithm as a permalink. */
  const wgLink = (algo: WAlgo, from: number | null, to: number | null): void => {
    const g = dataRef.current.wgraph as WGraph;
    const valById = new Map(g.nodes.map((n) => [n.id, n.value]));
    writeLabParam({
      lab: "wgraph",
      directed: g.directed,
      verts: g.nodes.map((n) => n.value),
      edges: g.edges.map((e) => [valById.get(e.a)!, valById.get(e.b)!, e.w] as [number, number, number]),
      algo,
      ...(from !== null ? { from } : {}),
      ...(to !== null ? { to } : {}),
    });
  };

  const runWgAlgo = () => {
    const meta = WGRAPH_ALGOS.find((a) => a.key === wgAlgo)!;
    const from = vertexOf(wgFrom);
    const to = vertexOf(wgTo);
    if (meta.needsFrom && from === null) {
      say(`${meta.short} needs a start vertex — pick one in the “from” box.`);
      return;
    }
    if (meta.needsTo === "yes" && to === null) {
      say(`${meta.short} needs a target too — pick one in the “to” box.`);
      return;
    }
    run((d) => {
      const g = d as WGraph;
      switch (wgAlgo) {
        case "bfs": case "dfs": return wgraphTraverse(g, from!, wgAlgo);
        case "path": return wgraphPathBfs(g, from!, to!);
        case "dijkstra": return wgraphDijkstra(g, from!, to ?? undefined);
        case "prim": return wgraphPrim(g, from!);
        case "kruskal": return wgraphKruskal(g);
        case "topo": return wgraphTopo(g);
      }
    });
    wgLink(wgAlgo, meta.needsFrom ? from : null, meta.needsTo !== "no" ? to : null);
  };

  // Auto-run a weighted-graph permalink once on mount: rebuild the graph from
  // (value-keyed) edges, then fire the saved algorithm.
  const autoRanWg = useRef(false);
  useEffect(() => {
    if (autoRanWg.current || initialLink?.lab !== "wgraph") return;
    autoRanWg.current = true;
    let g: WGraph = { kind: "wgraph", nodes: [], edges: [], directed: initialLink.directed };
    const apply = (frames: Frame[]) => { if (frames.length) g = frames[frames.length - 1].data as WGraph; };
    for (const v of initialLink.verts) apply(wgraphAddNode(g, v));
    for (const [a, b, w] of initialLink.edges) apply(wgraphAddEdge(g, a, b, w));
    dataRef.current.wgraph = g;
    if (initialLink.algo) {
      setWgAlgo(initialLink.algo);
      if (initialLink.from !== undefined) setWgFrom(String(initialLink.from));
      if (initialLink.to !== undefined) setWgTo(String(initialLink.to));
      const from = initialLink.from ?? null;
      const to = initialLink.to ?? null;
      const produced = ((): Frame[] => {
        switch (initialLink.algo) {
          case "bfs": case "dfs": return wgraphTraverse(g, from!, initialLink.algo);
          case "path": return wgraphPathBfs(g, from!, to!);
          case "dijkstra": return wgraphDijkstra(g, from!, to ?? undefined);
          case "prim": return wgraphPrim(g, from!);
          case "kruskal": return wgraphKruskal(g);
          case "topo": return wgraphTopo(g);
        }
      })();
      dataRef.current.wgraph = produced[produced.length - 1].data;
      setFrames(produced);
      setPlaying(produced.length > 1);
    } else {
      setFrames([{ data: g, hl: [], note: `Loaded ${g.nodes.length} vertices and ${g.edges.length} weighted edges from a shared link. Pick an algorithm and press Run.` }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Copy a link to the current weighted-graph scenario. */
  const copyWgLink = async () => {
    const meta = WGRAPH_ALGOS.find((a) => a.key === wgAlgo)!;
    wgLink(wgAlgo, meta.needsFrom ? vertexOf(wgFrom) : null, meta.needsTo !== "no" ? vertexOf(wgTo) : null);
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify.success("Shareable link copied — it rebuilds this graph and runs the algorithm.");
    } catch {
      notify.info("Link is in the address bar — copy it from there.");
    }
  };

  /** Export the current DS scene (whatever structure is showing) as a PNG. */
  const exportScenePng = () => {
    const svg = document.querySelector<SVGSVGElement>(".ds-canvas .ds-svg");
    if (svg) exportSvgsPng([svg], `${structure}.png`);
  };

  const reset = () => {
    if (structure === "wgraph") {
      // The directed/undirected setting is a mode, not data — it survives reset.
      const directed = (dataRef.current.wgraph as WGraph).directed;
      dataRef.current.wgraph = { kind: "wgraph", nodes: [], edges: [], directed };
    } else if (structure === "btree") {
      dataRef.current.btree = emptyBTree(btOrder, btPlus);
    } else {
      dataRef.current[structure] = structure === "hash" ? emptyHash(hashMode) : empty(structure);
    }
    setFrames([]);
    setIdx(0);
    setPlaying(false);
    if (structure === "wgraph") writeLabParam(null);
  };

  const dismissInfo = () => {
    const seen = loadSeen();
    seen[structure] = true;
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    setInfoOpen(false);
  };

  /** CS-Academy-style bulk editor: replace the whole structure from text in
      one hop, chaining the real engine ops silently so tree rotations, heap
      sifting, and hash chaining all land exactly where the ops would put them. */
  const bulkLoad = () => {
    if (structure === "graph") {
      const lines = bulkText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        say("The editor is empty — one edge per line as “A B”, or a lone number for an isolated vertex.");
        return;
      }
      let d = empty("graph");
      const seen = new Set<number>();
      let edgeCount = 0;
      let bad = 0;
      // Each landed vertex/edge contributes its own highlighted frame so the
      // playback shows the graph being built piece by piece.
      const lesson: Frame[] = [];
      const land = (produced: Frame[]) => {
        if (produced.length === 0) return;
        const last = produced[produced.length - 1];
        d = last.data;
        lesson.push(last);
      };
      const addVertex = (v: number): boolean => {
        if (seen.has(v)) return true;
        if (seen.size >= MAX_BULK_VERTICES) return false;
        land(graphAddNode(d as never, v));
        seen.add(v);
        return true;
      };
      for (const line of lines) {
        const { values } = parseValues(line);
        if (values.length === 0) {
          bad += 1;
        } else if (values.length === 1) {
          if (!addVertex(values[0])) {
            say(`That's more than ${MAX_BULK_VERTICES} vertices — keep the graph small enough to read.`);
            return;
          }
        } else {
          const [a, b] = values;
          if (!addVertex(a) || !addVertex(b)) {
            say(`That's more than ${MAX_BULK_VERTICES} vertices — keep the graph small enough to read.`);
            return;
          }
          if (a !== b) {
            const before = (d as { edges: [number, number][] }).edges.length;
            land(graphAddEdge(d as never, a, b));
            if ((d as { edges: [number, number][] }).edges.length > before) edgeCount += 1;
          }
        }
      }
      dataRef.current.graph = d;
      lesson.push({
        data: d, hl: [],
        note: `Loaded ${seen.size} ${seen.size === 1 ? "vertex" : "vertices"} and ${edgeCount} ${edgeCount === 1 ? "edge" : "edges"}${bad ? ` (skipped ${bad} unreadable ${bad === 1 ? "line" : "lines"})` : ""}. To traverse it, head to the Graph Algorithms card.`,
      });
      setFrames(lesson);
      setIdx(0);
      setPlaying(lesson.length > 1);
    } else if (structure === "wgraph") {
      const lines = bulkText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        say("The editor is empty — one edge per line as “A B w” (weight optional), or a lone number for a vertex.");
        return;
      }
      const directed = (dataRef.current.wgraph as WGraph).directed;
      let d: WGraph = { kind: "wgraph", nodes: [], edges: [], directed };
      let bad = 0;
      const lesson: Frame[] = [];
      const land = (produced: Frame[]) => {
        if (produced.length === 0) return;
        const last = produced[produced.length - 1];
        d = last.data as WGraph;
        lesson.push(last);
      };
      for (const line of lines) {
        const { values } = parseValues(line);
        if (values.length === 0) {
          bad += 1;
        } else if (values.length === 1) {
          if (d.nodes.length >= MAX_WG_VERTICES && !d.nodes.some((n) => n.value === values[0])) {
            say(`That's more than ${MAX_WG_VERTICES} vertices — keep the graph small enough to trace by hand.`);
            return;
          }
          land(wgraphAddNode(d, values[0]));
        } else {
          const [a, b, w] = values;
          if (a === b) { bad += 1; continue; }
          const newVerts = [a, b].filter((v) => !d.nodes.some((n) => n.value === v)).length;
          if (d.nodes.length + newVerts > MAX_WG_VERTICES) {
            say(`That's more than ${MAX_WG_VERTICES} vertices — keep the graph small enough to trace by hand.`);
            return;
          }
          if (d.edges.length >= MAX_WG_EDGES) {
            say(`That's more than ${MAX_WG_EDGES} edges — the drawing would turn into spaghetti.`);
            return;
          }
          land(wgraphAddEdge(d, a, b, w ?? 1));
        }
      }
      dataRef.current.wgraph = d;
      lesson.push({
        data: d, hl: [],
        note: `Loaded ${d.nodes.length} ${d.nodes.length === 1 ? "vertex" : "vertices"} and ${d.edges.length} weighted ${d.edges.length === 1 ? "edge" : "edges"}${bad ? ` (skipped ${bad} unreadable ${bad === 1 ? "line" : "lines"})` : ""}. Pick an algorithm below and press Run.`,
      });
      setFrames(lesson);
      setIdx(0);
      setPlaying(lesson.length > 1);
    } else {
      const { values, outOfRange } = parseValues(bulkText);
      if (outOfRange.length > 0) {
        say(`Keep values between ${V_MIN} and ${V_MAX} so they fit their boxes — ${outOfRange.join(", ")} ${outOfRange.length === 1 ? "is" : "are"} out of range.`);
        return;
      }
      if (values.length === 0) {
        say("The editor is empty — type values separated by commas, spaces, or new lines.");
        return;
      }
      if (values.length > MAX_BULK) {
        say(`That's ${values.length} values — the bulk editor takes up to ${MAX_BULK} so the drawing stays readable.`);
        return;
      }
      // Linked list special-case: "insert front" would reverse the typed
      // order, so bulk always appends at the back.
      const op = structure === "list"
        ? (d: DSData, v: number) => listInsertBack(d as never, v)
        : insertOps[structure][0][1];
      let d = structure === "hash" ? emptyHash(hashMode)
        : structure === "btree" ? emptyBTree(btOrder, btPlus)
        : empty(structure);
      // One highlighted frame per value: the playback shows each value
      // finding its place (rotations, sifting, probing already applied).
      const lesson: Frame[] = [];
      values.forEach((v, k) => {
        const produced = op(d, v);
        if (produced.length === 0) return;
        const last = produced[produced.length - 1];
        d = last.data;
        lesson.push({ ...last, note: `${k + 1} of ${values.length}: ${last.note}` });
      });
      dataRef.current[structure] = d;
      lesson.push({ data: d, hl: [], note: `All ${values.length} values are in. Now run an operation to see the steps.` });
      setFrames(lesson);
      setIdx(0);
      setPlaying(lesson.length > 1);
    }
    setBulkOpen(false);
    setBulkText("");
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
    hash: [["Insert", (d, v) => (hashMode === "chain" ? hashInsert(d as never, v) : oaHashInsert(d as never, v))]],
    btree: [["Insert", (d, v) => btInsert(d as never, v)]],
    graph: [["Add vertex", (d, v) => graphAddNode(d as never, v)]],
    wgraph: [["Add vertex", (d, v) => wgraphAddNode(d as never, v)]],
    array: [["Add", (d, v) => arrayPush(d as never, v)]],
    search: [["Add", (d, v) => arrayPush(d as never, v)]],
  };

  const switchTo = (t: Topic) => {
    // Leaving a shared scenario clears its URL (one open lab = at most one link).
    writeLabParam(null);
    setTopic(t);
    setFrames([]);
    setIdx(0);
    setPlaying(false);
    setBulkOpen(false);
    setBulkText("");
    setInfoOpen(!isLabTopic(t) && !loadSeen()[t]);
  };

  // ---------- topic grid (home) ----------
  if (topic === null) {
    return (
      <div className="ds-home">
        <div className="ds-home-inner">
          <header className="ds-home-head">
            <h2>Pick a topic</h2>
            <p>Every card is a hands-on lab: build the thing, run its operations, and scrub through each step like a debugger.</p>
          </header>
          {CATEGORIES.map((cat) => (
            <section key={cat} className="ds-home-section">
              <h3 className="ds-cat">{cat}</h3>
              <div className="ds-grid">
                {ALL_TOPICS.filter((t) => CATEGORY[t.key] === cat).map((t) => (
                  <button key={t.key} className="ds-card" onClick={() => switchTo(t.key)}>
                    <span className="ds-card-icon"><t.icon size={18} aria-hidden="true" /></span>
                    <span className="ds-card-body">
                      <span className="ds-card-title">{t.label}</span>
                      <span className="ds-card-intro">{t.intro}</span>
                      <span className="ds-complexity">
                        {t.complexity.map((c) => (
                          <span key={c} className="ds-chip">{c}</span>
                        ))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const tabs = (
    <nav className="ds-tabs">
      <button className="ds-tab home-tab" onClick={() => setTopic(null)} title="back to all topics">
        <LayoutGrid size={13} aria-hidden="true" />
        Topics
      </button>
      {ALL_TOPICS.map((t) => (
        <button key={t.key} className={`ds-tab${t.key === topic ? " active" : ""}`} onClick={() => switchTo(t.key)}>
          <t.icon size={13} aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  );

  // ---------- lab topics: they own their toolbar, stage, and caption ----------
  if (isLabTopic(topic)) {
    return (
      <div className="ds-page">
        {tabs}
        {topic === "sched" ? (
          <SchedLab initial={initialLink?.lab === "sched" ? initialLink : undefined} />
        ) : topic === "threads" ? (
          <ThreadsLab />
        ) : topic === "paging" ? (
          <PagingLab initial={initialLink?.lab === "paging" ? initialLink : undefined} />
        ) : topic === "deadlock" ? (
          <DeadlockLab initial={initialLink?.lab === "deadlock" ? initialLink : undefined} />
        ) : topic === "disk" ? (
          <DiskLab initial={initialLink?.lab === "disk" ? initialLink : undefined} />
        ) : (
          <SortRace initial={initialLink?.lab === "sortrace" ? initialLink : undefined} />
        )}
      </div>
    );
  }

  return (
    <div className="ds-page">
      {tabs}

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
            <button onClick={() => runEach((d, v) => (hashMode === "chain" ? hashRemove(d as never, v) : oaHashRemove(d as never, v)))}>
              <Trash2 size={13} /> Remove
            </button>
            <button
              onClick={() => runPair((d, a, b) => (hashMode === "chain" ? hashUpdate(d as never, a, b) : oaHashUpdate(d as never, a, b)))}
              title="type: old, new"
            >
              <Pencil size={13} /> Update
            </button>
            <button onClick={() => runEach((d, v) => (hashMode === "chain" ? hashSearch(d as never, v) : oaHashSearch(d as never, v)))}>
              <Search size={13} /> Search
            </button>
            <label className="ds-mode" title="how the table resolves two keys hashing to the same slot">
              collisions:
              <select value={hashMode} onChange={(e) => switchHashMode(e.target.value as HashMode)}>
                <option value="chain">Chaining</option>
                <option value="linear">Linear probing</option>
                <option value="quadratic">Quadratic probing</option>
              </select>
            </label>
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
        {structure === "btree" && (
          <>
            <button onClick={() => runEach((d, v) => btRemove(d as never, v))}>
              <Trash2 size={13} /> Delete
            </button>
            <button onClick={() => runEach((d, v) => btSearch(d as never, v))}>
              <Search size={13} /> Search
            </button>
            <label className="ds-mode" title="B stores values everywhere; B+ keeps them all in linked leaves">
              variant:
              <select value={btPlus ? "bplus" : "b"} onChange={(e) => switchBTree(btOrder, e.target.value === "bplus")}>
                <option value="b">B-tree</option>
                <option value="bplus">B+ tree</option>
              </select>
            </label>
            <label className="ds-mode" title="max children per node; max keys = degree − 1">
              degree:
              <select value={btOrder} onChange={(e) => switchBTree(Number(e.target.value), btPlus)}>
                {BT_ORDERS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {structure === "wgraph" && (
          <>
            <button onClick={() => runEach((d, v) => wgraphRemoveNode(d as never, v))}>
              <Trash2 size={13} /> Remove vertex
            </button>
            <label className="ds-mode" title="directed edges point A→B; MST needs undirected, topo sort needs directed">
              edges:
              <select
                value={(dataRef.current.wgraph as WGraph).directed ? "directed" : "undirected"}
                onChange={(e) => run((d) => wgraphSetDirected(d as WGraph, e.target.value === "directed"))}
              >
                <option value="undirected">undirected</option>
                <option value="directed">directed</option>
              </select>
            </label>
            <span className="ds-edge-inputs">
              <input className="ds-input small" value={edgeA} placeholder="A" onChange={(e) => setEdgeA(e.target.value)} />
              <ArrowLeftRight size={12} aria-hidden="true" />
              <input className="ds-input small" value={edgeB} placeholder="B" onChange={(e) => setEdgeB(e.target.value)} />
              <input
                className="ds-input small"
                value={edgeW}
                placeholder="w"
                title={`edge weight ${WEIGHT_MIN}–${WEIGHT_MAX} (blank = 1)`}
                onChange={(e) => setEdgeW(e.target.value)}
              />
              <button onClick={() => runEdge(true, (d, a, b) => wgraphAddEdge(d as never, a, b, vertexOf(edgeW) ?? 1))}>Add edge</button>
              <button onClick={() => runEdge(true, (d, a, b) => wgraphRemoveEdge(d as never, a, b))}>Remove edge</button>
            </span>
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
            </span>
          </>
        )}
        <button onClick={randomFill} title="fill the input with random values">
          <Shuffle size={13} /> Random
        </button>
        <button
          className={bulkOpen ? "toggled" : ""}
          onClick={() => setBulkOpen((o) => !o)}
          title="build the whole structure from text in one hop"
        >
          <ListPlus size={13} /> Bulk load
        </button>
        {frames.length > 0 && (
          <button onClick={exportScenePng} title="download the current diagram as a PNG">
            <Download size={13} /> PNG
          </button>
        )}
        <button onClick={reset} title="clear this structure">
          <RotateCcw size={13} aria-hidden="true" /> Reset
        </button>
        <button
          className="icon-btn"
          onClick={() => setInfoOpen(true)}
          title={`about ${meta.label}`}
          aria-label={`about ${meta.label}`}
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </div>

      {structure === "wgraph" && (() => {
        // Second bar: the algorithms, kept apart from the build ops so neither
        // crowds the other (same split as Sorting vs the structures).
        const wgMeta = WGRAPH_ALGOS.find((a) => a.key === wgAlgo)!;
        const verts = [...(dataRef.current.wgraph as WGraph).nodes].sort((a, b) => a.value - b.value);
        const vertSelect = (val: string, set: (s: string) => void, ph: string) => (
          <select className="wg-vert" value={verts.some((n) => String(n.value) === val) ? val : ""} onChange={(e) => set(e.target.value)}>
            <option value="">{ph}</option>
            {verts.map((n) => (
              <option key={n.id} value={n.value}>{n.value}</option>
            ))}
          </select>
        );
        return (
          <div className="ds-opbar wg-run">
            <label className="ds-mode">
              algorithm:
              <select value={wgAlgo} onChange={(e) => setWgAlgo(e.target.value as WAlgo)}>
                {WGRAPH_ALGOS.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
            </label>
            {wgMeta.needsFrom && (
              <label className="ds-mode">from: {vertSelect(wgFrom, setWgFrom, "pick…")}</label>
            )}
            {wgMeta.needsTo !== "no" && (
              <label className="ds-mode">
                to: {vertSelect(wgTo, setWgTo, wgMeta.needsTo === "optional" ? "(all)" : "pick…")}
              </label>
            )}
            <button className="primary" onClick={runWgAlgo}>
              <Play size={13} /> Run
            </button>
            <button
              className={predictOn ? "toggled" : ""}
              title="pause before every decision and ask you to predict it"
              onClick={() => {
                setPredictOn((p) => !p);
                predict.reset();
                dismissQuiz();
              }}
            >
              <Target size={13} /> Predict
            </button>
            <PredictChips state={predict.state} />
            <button onClick={copyWgLink} title="copy a link that rebuilds this graph and runs the algorithm">
              <Link2 size={13} /> Copy link
            </button>
            <span className="sched-hint">{wgMeta.blurb}</span>
          </div>
        );
      })()}

      {bulkOpen && (
        <div className="ds-bulk">
          <textarea
            className="ds-bulk-text"
            value={bulkText}
            placeholder={meta.bulkPlaceholder}
            onChange={(e) => setBulkText(e.target.value)}
            autoFocus
            rows={structure === "graph" ? 5 : 3}
          />
          <div className="ds-bulk-side">
            <p className="ds-bulk-hint">{meta.bulkHint}</p>
            <div className="ds-bulk-actions">
              <button className="primary" onClick={bulkLoad}>
                <ListPlus size={13} /> Load
              </button>
              <button onClick={() => { setBulkOpen(false); setBulkText(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="ds-canvas">
        {infoOpen && (
          <div className="ds-info-card" role="note">
            <span className="ds-info-icon">
              <meta.icon size={17} aria-hidden="true" />
            </span>
            <div className="ds-info-body">
              <h3>{meta.label}</h3>
              <p>{meta.intro}</p>
              <div className="ds-complexity">
                {meta.complexity.map((c) => (
                  <span key={c} className="ds-chip">{c}</span>
                ))}
              </div>
            </div>
            <button className="primary" onClick={dismissInfo}>Got it</button>
          </div>
        )}
        <DSView frame={frame} />
      </div>

      {quizAt !== null && frames[quizAt]?.quiz && (
        <QuizPanel
          quiz={frames[quizAt].quiz!}
          onAnswer={predict.answer}
          onContinue={() => {
            quizDone.current.add(quizAt);
            setIdx(quizAt);
            setQuizAt(null);
            setPlaying(true);
          }}
        />
      )}

      <div className="ds-caption">
        <span className="ds-teacher">
          <GraduationCap size={16} aria-hidden="true" />
        </span>
        <p key={frame.note} className="ds-note">
          {frame.note}
        </p>
        {frames.length > 1 && (
          <div className="transport ds-transport">
            <button onClick={() => { dismissQuiz(); setIdx(0); }} disabled={idx === 0} title="restart lesson" aria-label="Restart lesson">
              <ChevronFirst size={16} aria-hidden="true" />
            </button>
            <button onClick={() => { dismissQuiz(); setIdx((i) => Math.max(0, i - 1)); }} disabled={idx === 0} title="previous step" aria-label="Previous step">
              <StepBack size={16} aria-hidden="true" />
            </button>
            <button className="play-btn" onClick={() => setPlaying(!playing)} title="play / pause" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            </button>
            <button
              onClick={() => {
                const next = Math.min(frames.length - 1, idx + 1);
                if (gated(next)) {
                  setPlaying(false);
                  setQuizAt(next);
                  return;
                }
                setIdx(next);
              }}
              disabled={idx >= frames.length - 1}
              title="next step"
              aria-label="Next step"
            >
              <StepForward size={16} aria-hidden="true" />
            </button>
            <input
              className="ds-scrub"
              type="range"
              min={0}
              max={frames.length - 1}
              value={idx}
              title="scrub through the lesson"
              aria-label="scrub through the lesson"
              onChange={(e) => {
                setPlaying(false);
                dismissQuiz();
                setIdx(Number(e.target.value));
              }}
            />
            <SpeedSelect speed={speed} onChange={setSpeed} speeds={SPEEDS} />
            <span className="step-counter">
              {idx + 1} / {frames.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
