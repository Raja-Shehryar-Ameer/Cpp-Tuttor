// Step engine for the interactive data-structure playground. Every operation
// returns a list of Frames — snapshots plus a teacher-style note — that the
// player animates through. Generators never mutate the input structure.

export interface TreeNode {
  id: number;
  value: number;
  color?: "red" | "black";
  left: TreeNode | null;
  right: TreeNode | null;
}

export interface ListNode {
  id: number;
  value: number;
}

export type DSData =
  | { kind: "list"; nodes: ListNode[] }
  | { kind: "stack"; items: ListNode[] }
  | { kind: "queue"; items: ListNode[] }
  | { kind: "tree"; root: TreeNode | null }
  | { kind: "graph"; nodes: ListNode[]; edges: [number, number][] };

export interface Frame {
  data: DSData;
  /** node ids drawn highlighted (the teacher's pointer) */
  hl: number[];
  /** ids flashed green (success) or red (problem) this frame */
  ok?: number[];
  bad?: number[];
  note: string;
}

let nextId = 1;
const fresh = (value: number): ListNode => ({ id: nextId++, value });

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function snap(data: DSData, note: string, extra: Partial<Frame> = {}): Frame {
  return { data: clone(data), hl: [], note, ...extra };
}

// ---------- linked list ----------

export function listInsertFront(d: { nodes: ListNode[] }, value: number): Frame[] {
  const node = fresh(value);
  const frames = [snap({ kind: "list", nodes: d.nodes }, `Create a new node holding ${value}.`)];
  const nodes = [node, ...clone(d.nodes)];
  frames.push(
    snap(
      { kind: "list", nodes },
      `Point the new node's next at the old head, then move head to it — ${value} is now first.`,
      { hl: [node.id], ok: [node.id] },
    ),
  );
  return frames;
}

export function listInsertBack(d: { nodes: ListNode[] }, value: number): Frame[] {
  const frames: Frame[] = [];
  const data: DSData = { kind: "list", nodes: clone(d.nodes) };
  if (data.nodes.length === 0) {
    const node = fresh(value);
    data.nodes.push(node);
    return [snap(data, `The list is empty, so the new node ${value} becomes the head.`, { hl: [node.id], ok: [node.id] })];
  }
  for (let i = 0; i < data.nodes.length; i++) {
    const last = i === data.nodes.length - 1;
    frames.push(
      snap(data, last
        ? `Node ${data.nodes[i].value} has next = null — this is the tail.`
        : `Walk past node ${data.nodes[i].value}: it already has a next.`, { hl: [data.nodes[i].id] }),
    );
  }
  const node = fresh(value);
  data.nodes.push(node);
  frames.push(snap(data, `Link the tail's next to the new node — ${value} joins the end.`, { hl: [node.id], ok: [node.id] }));
  return frames;
}

export function listRemove(d: { nodes: ListNode[] }, value: number): Frame[] {
  const frames: Frame[] = [];
  const data: DSData = { kind: "list", nodes: clone(d.nodes) };
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    if (node.value === value) {
      frames.push(snap(data, `Found ${value}. Route the previous node's next around it…`, { hl: [node.id], bad: [node.id] }));
      data.nodes.splice(i, 1);
      frames.push(snap(data, `…and the node is unlinked. Nothing points at it any more, so it is gone.`, { ok: [] }));
      return frames;
    }
    frames.push(snap(data, `Is this node ${value}? No, it holds ${node.value} — follow next.`, { hl: [node.id] }));
  }
  frames.push(snap(data, `Reached null without seeing ${value}: it is not in the list.`, { bad: [] }));
  return frames;
}

export function listSearch(d: { nodes: ListNode[] }, value: number): Frame[] {
  const frames: Frame[] = [];
  const data: DSData = { kind: "list", nodes: clone(d.nodes) };
  for (const node of data.nodes) {
    if (node.value === value) {
      frames.push(snap(data, `Node holds ${value} — found it!`, { hl: [node.id], ok: [node.id] }));
      return frames;
    }
    frames.push(snap(data, `Node holds ${node.value}, not ${value} — follow next.`, { hl: [node.id] }));
  }
  frames.push(snap(data, `Hit null: ${value} is not in the list.`, { bad: [] }));
  return frames;
}

// ---------- stack / queue ----------

export function stackPush(d: { items: ListNode[] }, value: number): Frame[] {
  const node = fresh(value);
  const items = [...clone(d.items), node];
  return [
    snap({ kind: "stack", items }, `Push ${value}: it goes on TOP — a stack only grows and shrinks at one end (LIFO).`, {
      hl: [node.id],
      ok: [node.id],
    }),
  ];
}

export function stackPop(d: { items: ListNode[] }): Frame[] {
  const data: DSData = { kind: "stack", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The stack is empty — popping now would underflow.`, { bad: [] })];
  const top = data.items[data.items.length - 1];
  const frames = [snap(data, `The top holds ${top.value} — that is the only element a stack may remove.`, { hl: [top.id], bad: [top.id] })];
  data.items.pop();
  frames.push(snap(data, `Popped ${top.value}. The element below it becomes the new top.`, {}));
  return frames;
}

export function queueEnqueue(d: { items: ListNode[] }, value: number): Frame[] {
  const node = fresh(value);
  const items = [...clone(d.items), node];
  return [
    snap({ kind: "queue", items }, `Enqueue ${value}: new elements always join at the REAR (FIFO — first in, first out).`, {
      hl: [node.id],
      ok: [node.id],
    }),
  ];
}

export function queueDequeue(d: { items: ListNode[] }): Frame[] {
  const data: DSData = { kind: "queue", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The queue is empty — nothing to dequeue.`, { bad: [] })];
  const front = data.items[0];
  const frames = [snap(data, `The FRONT holds ${front.value} — it waited longest, so it leaves first.`, { hl: [front.id], bad: [front.id] })];
  data.items.shift();
  frames.push(snap(data, `Dequeued ${front.value}. Everyone else moves one place closer to the front.`, {}));
  return frames;
}

// ---------- binary search tree ----------

const tree = (root: TreeNode | null): DSData => ({ kind: "tree", root });

export function bstInsert(root: TreeNode | null, value: number): Frame[] {
  const r = clone(root);
  const frames: Frame[] = [];
  const node: TreeNode = { id: nextId++, value, left: null, right: null };
  if (!r) {
    frames.push(snap(tree(node), `The tree is empty, so ${value} becomes the root.`, { hl: [node.id], ok: [node.id] }));
    return frames;
  }
  let cur = r;
  for (;;) {
    if (value === cur.value) {
      frames.push(snap(tree(r), `${value} is already here — a BST keeps one copy of each key.`, { hl: [cur.id], bad: [cur.id] }));
      return frames;
    }
    const side = value < cur.value ? "left" : "right";
    frames.push(
      snap(tree(r), `Compare ${value} with ${cur.value}: ${value} is ${side === "left" ? "smaller, go LEFT" : "bigger, go RIGHT"}.`, {
        hl: [cur.id],
      }),
    );
    const child = cur[side];
    if (!child) {
      cur[side] = node;
      frames.push(snap(tree(r), `That ${side} spot is empty — ${value} settles in there as a leaf.`, { hl: [node.id], ok: [node.id] }));
      return frames;
    }
    cur = child;
  }
}

export function bstSearch(root: TreeNode | null, value: number): Frame[] {
  const r = clone(root);
  const frames: Frame[] = [];
  let cur = r;
  while (cur) {
    if (value === cur.value) {
      frames.push(snap(tree(r), `${value} found — every comparison halved the search space.`, { hl: [cur.id], ok: [cur.id] }));
      return frames;
    }
    const side = value < cur.value ? "left" : "right";
    frames.push(snap(tree(r), `${value} vs ${cur.value}: go ${side.toUpperCase()}.`, { hl: [cur.id] }));
    cur = cur[side];
  }
  frames.push(snap(tree(r), `Fell off the tree — ${value} is not stored here.`, { bad: [] }));
  return frames;
}

export function bstRemove(root: TreeNode | null, value: number): Frame[] {
  const r = clone(root);
  const frames: Frame[] = [];
  let parent: TreeNode | null = null;
  let cur = r;
  let side: "left" | "right" = "left";
  while (cur && cur.value !== value) {
    frames.push(snap(tree(r), `${value} vs ${cur.value}: go ${value < cur.value ? "LEFT" : "RIGHT"}.`, { hl: [cur.id] }));
    parent = cur;
    side = value < cur.value ? "left" : "right";
    cur = cur[side];
  }
  if (!cur) {
    frames.push(snap(tree(r), `${value} is not in the tree — nothing to remove.`, { bad: [] }));
    return frames;
  }
  frames.push(snap(tree(r), `Found ${value}. Now: how many children does it have?`, { hl: [cur.id], bad: [cur.id] }));

  const replaceIn = (repl: TreeNode | null): TreeNode | null => {
    if (!parent) return repl;
    parent[side] = repl;
    return r;
  };

  let newRoot = r;
  if (cur.left && cur.right) {
    // two children: replace with in-order successor
    let sParent = cur;
    let s = cur.right;
    while (s.left) {
      frames.push(snap(tree(r), `Two children — find the SUCCESSOR: smallest value in the right subtree. Walk left…`, { hl: [s.id] }));
      sParent = s;
      s = s.left;
    }
    frames.push(snap(tree(r), `Successor is ${s.value}: copy it over ${value}, then remove the successor's old node.`, { hl: [s.id], ok: [s.id] }));
    cur.value = s.value;
    if (sParent === cur) sParent.right = s.right;
    else sParent.left = s.right;
  } else {
    const child = cur.left ?? cur.right;
    newRoot = replaceIn(child);
    frames.push(
      snap(tree(newRoot), child
        ? `One child — the child simply takes its parent's place.`
        : `A leaf — it can be snipped off with nothing to reconnect.`, {}),
    );
    return frames;
  }
  frames.push(snap(tree(newRoot), `Done — the BST ordering (left < node < right) still holds everywhere.`, {}));
  return frames;
}

// ---------- AVL tree ----------

interface ANode extends TreeNode {
  left: ANode | null;
  right: ANode | null;
  h: number;
}

const hOf = (n: ANode | null): number => (n ? n.h : 0);
const upd = (n: ANode): void => {
  n.h = 1 + Math.max(hOf(n.left), hOf(n.right));
};
const bal = (n: ANode): number => hOf(n.left) - hOf(n.right);

function strip(n: ANode | null): TreeNode | null {
  return n ? { id: n.id, value: n.value, left: strip(n.left), right: strip(n.right) } : null;
}

function rotateRight(y: ANode): ANode {
  const x = y.left as ANode;
  y.left = x.right;
  x.right = y;
  upd(y);
  upd(x);
  return x;
}

function rotateLeft(x: ANode): ANode {
  const y = x.right as ANode;
  x.right = y.left;
  y.left = x;
  upd(x);
  upd(y);
  return y;
}

export function avlInsert(root: TreeNode | null, value: number): Frame[] {
  const frames: Frame[] = [];
  let treeRoot = clone(root) as ANode | null;
  const withHeights = (n: ANode | null): number => (n ? (n.h = 1 + Math.max(withHeights(n.left), withHeights(n.right))) : 0);
  withHeights(treeRoot);
  const snapTree = (note: string, extra: Partial<Frame> = {}) =>
    frames.push({ data: { kind: "tree", root: strip(treeRoot) }, hl: [], note, ...extra });

  let duplicate = false;
  const insert = (n: ANode | null): ANode => {
    if (!n) {
      const leaf: ANode = { id: nextId++, value, left: null, right: null, h: 1 };
      return leaf;
    }
    if (value === n.value) {
      duplicate = true;
      return n;
    }
    frames.push({
      data: { kind: "tree", root: strip(treeRoot) },
      hl: [n.id],
      note: `Compare ${value} with ${n.value}: go ${value < n.value ? "LEFT" : "RIGHT"} (normal BST insert first).`,
    });
    if (value < n.value) n.left = insert(n.left);
    else n.right = insert(n.right);
    if (duplicate) return n;
    upd(n);
    const b = bal(n);
    if (b > 1 || b < -1) {
      snapTree(
        `Node ${n.value} is UNBALANCED (balance ${b}): the AVL rule |height(left) − height(right)| ≤ 1 is broken.`,
        { hl: [n.id], bad: [n.id] },
      );
      if (b > 1 && value < (n.left as ANode).value) {
        snapTree(`Left-Left case → one ROTATE RIGHT around ${n.value}.`, { hl: [n.id] });
        n = rotateRight(n);
      } else if (b < -1 && value > (n.right as ANode).value) {
        snapTree(`Right-Right case → one ROTATE LEFT around ${n.value}.`, { hl: [n.id] });
        n = rotateLeft(n);
      } else if (b > 1) {
        snapTree(`Left-Right case → rotate LEFT around ${(n.left as ANode).value}, then RIGHT around ${n.value}.`, { hl: [n.id] });
        n.left = rotateLeft(n.left as ANode);
        n = rotateRight(n);
      } else {
        snapTree(`Right-Left case → rotate RIGHT around ${(n.right as ANode).value}, then LEFT around ${n.value}.`, { hl: [n.id] });
        n.right = rotateRight(n.right as ANode);
        n = rotateLeft(n);
      }
    }
    return n;
  };

  treeRoot = insert(treeRoot);
  if (duplicate) {
    snapTree(`${value} is already in the tree — nothing changes.`, { bad: [] });
    return frames;
  }
  snapTree(`${value} inserted and every node balanced again — height stays O(log n).`, { ok: [] });
  return frames;
}

// ---------- red-black tree ----------

interface RNode {
  id: number;
  value: number;
  color: "red" | "black";
  left: RNode | null;
  right: RNode | null;
  parent: RNode | null;
}

function rbStrip(n: RNode | null): TreeNode | null {
  return n ? { id: n.id, value: n.value, color: n.color, left: rbStrip(n.left), right: rbStrip(n.right) } : null;
}

function rbFromTree(n: TreeNode | null, parent: RNode | null): RNode | null {
  if (!n) return null;
  const r: RNode = { id: n.id, value: n.value, color: n.color ?? "black", left: null, right: null, parent };
  r.left = rbFromTree(n.left, r);
  r.right = rbFromTree(n.right, r);
  return r;
}

export function rbInsert(root: TreeNode | null, value: number): Frame[] {
  const frames: Frame[] = [];
  let rbRoot = rbFromTree(clone(root), null);
  const snapTree = (note: string, extra: Partial<Frame> = {}) =>
    frames.push({ data: { kind: "tree", root: rbStrip(rbRoot) }, hl: [], note, ...extra });

  // plain BST insert, new node RED
  const node: RNode = { id: nextId++, value, color: "red", left: null, right: null, parent: null };
  if (!rbRoot) {
    node.color = "black";
    rbRoot = node;
    snapTree(`Empty tree: ${value} becomes the root, and the root is always painted BLACK.`, { hl: [node.id], ok: [node.id] });
    return frames;
  }
  let cur: RNode | null = rbRoot;
  let parent: RNode = rbRoot;
  while (cur) {
    if (value === cur.value) {
      snapTree(`${value} already exists — no duplicates.`, { hl: [cur.id], bad: [cur.id] });
      return frames;
    }
    frames.push({
      data: { kind: "tree", root: rbStrip(rbRoot) },
      hl: [cur.id],
      note: `BST walk: ${value} vs ${cur.value} → ${value < cur.value ? "left" : "right"}.`,
    });
    parent = cur;
    cur = value < cur.value ? cur.left : cur.right;
  }
  node.parent = parent;
  if (value < parent.value) parent.left = node;
  else parent.right = node;
  snapTree(`Attach ${value} as a RED leaf — inserting red can only break the "no red parent-child pair" rule, never the black-height rule.`, {
    hl: [node.id],
  });

  const rotate = (x: RNode, dir: "left" | "right"): void => {
    const other = dir === "left" ? "right" : "left";
    const y = x[other] as RNode;
    x[other] = y[dir];
    if (y[dir]) (y[dir] as RNode).parent = x;
    y.parent = x.parent;
    if (!x.parent) rbRoot = y;
    else if (x.parent.left === x) x.parent.left = y;
    else x.parent.right = y;
    y[dir] = x;
    x.parent = y;
  };

  let z = node;
  while (z.parent && z.parent.color === "red") {
    const p = z.parent;
    const g = p.parent as RNode;
    const uncle = g.left === p ? g.right : g.left;
    if (uncle && uncle.color === "red") {
      snapTree(`Red parent ${p.value} AND red uncle ${uncle.value}: RECOLOR — parent & uncle black, grandparent ${g.value} red — and continue from the grandparent.`, {
        hl: [p.id, uncle.id, g.id],
      });
      p.color = "black";
      uncle.color = "black";
      g.color = "red";
      z = g;
      continue;
    }
    const pSide = g.left === p ? "left" : "right";
    if ((pSide === "left" && p.right === z) || (pSide === "right" && p.left === z)) {
      snapTree(`Zig-zag shape (${value} is the inner grandchild): first rotate ${pSide} around parent ${p.value} to straighten it.`, { hl: [p.id, z.id] });
      rotate(p, pSide);
      z = p;
    }
    const zp = z.parent as RNode;
    const zg = zp.parent as RNode;
    snapTree(`Straight line: rotate ${pSide === "left" ? "right" : "left"} around grandparent ${zg.value} and swap its color with ${zp.value}.`, {
      hl: [zp.id, zg.id],
    });
    zp.color = "black";
    zg.color = "red";
    rotate(zg, pSide === "left" ? "right" : "left");
  }
  if (rbRoot && rbRoot.color !== "black") {
    rbRoot.color = "black";
    snapTree(`Finally, repaint the root BLACK (it always is).`, {});
  }
  snapTree(`${value} inserted — both red-black rules hold, so the tree stays balanced within 2× optimal height.`, { ok: [] });
  return frames;
}

// ---------- graph ----------

export function graphAddNode(d: { nodes: ListNode[]; edges: [number, number][] }, value: number): Frame[] {
  if (d.nodes.some((n) => n.value === value)) {
    return [snap({ kind: "graph", ...clone(d) }, `Vertex ${value} already exists.`, { bad: [] })];
  }
  const node = fresh(value);
  const data: DSData = { kind: "graph", nodes: [...clone(d.nodes), node], edges: clone(d.edges) };
  return [snap(data, `Added vertex ${value}. Connect it with edges to give it neighbours.`, { hl: [node.id], ok: [node.id] })];
}

export function graphAddEdge(
  d: { nodes: ListNode[]; edges: [number, number][] },
  a: number,
  b: number,
): Frame[] {
  const na = d.nodes.find((n) => n.value === a);
  const nb = d.nodes.find((n) => n.value === b);
  if (!na || !nb || na === nb) {
    return [snap({ kind: "graph", ...clone(d) }, `Need two different existing vertices — add them first.`, { bad: [] })];
  }
  if (d.edges.some(([x, y]) => (x === na.id && y === nb.id) || (x === nb.id && y === na.id))) {
    return [snap({ kind: "graph", ...clone(d) }, `${a} and ${b} are already connected.`, { bad: [] })];
  }
  const data: DSData = { kind: "graph", nodes: clone(d.nodes), edges: [...clone(d.edges), [na.id, nb.id]] };
  return [snap(data, `Edge ${a} — ${b} added (undirected: each is now the other's neighbour).`, { hl: [na.id, nb.id], ok: [na.id, nb.id] })];
}

export function graphTraverse(
  d: { nodes: ListNode[]; edges: [number, number][] },
  start: number,
  mode: "bfs" | "dfs",
): Frame[] {
  const data: DSData = { kind: "graph", nodes: clone(d.nodes), edges: clone(d.edges) };
  const startNode = data.nodes.find((n) => n.value === start);
  if (!startNode) return [snap(data, `Vertex ${start} does not exist — add it first.`, { bad: [] })];

  const adj = new Map<number, number[]>();
  for (const [a, b] of data.edges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const label = (id: number) => data.nodes.find((n) => n.id === id)?.value;

  const frames: Frame[] = [];
  const visited: number[] = [];
  const work: number[] = [startNode.id];
  const seen = new Set([startNode.id]);
  frames.push(snap(data, mode === "bfs"
    ? `BFS from ${start}: explore level by level using a QUEUE.`
    : `DFS from ${start}: dive as deep as possible first, using a STACK.`, { hl: [startNode.id] }));
  while (work.length) {
    const id = mode === "bfs" ? (work.shift() as number) : (work.pop() as number);
    visited.push(id);
    const neighbours = (adj.get(id) ?? []).filter((n) => !seen.has(n));
    neighbours.forEach((n) => seen.add(n));
    work.push(...neighbours);
    frames.push(
      snap(data, neighbours.length
        ? `Visit ${label(id)} and ${mode === "bfs" ? "enqueue" : "push"} its unseen neighbours: ${neighbours.map(label).join(", ")}.`
        : `Visit ${label(id)} — no new neighbours from here.`, { hl: [...visited], ok: [id] }),
    );
  }
  frames.push(
    snap(data, `Traversal complete. Order: ${visited.map(label).join(" → ")}${
      visited.length < data.nodes.length ? " (unreached vertices are in a different component)" : ""
    }.`, { ok: [...visited] }),
  );
  return frames;
}
