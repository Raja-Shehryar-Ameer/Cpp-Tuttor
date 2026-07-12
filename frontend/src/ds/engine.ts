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

/** Weighted edge for the "wgraph" kind. a/b are node IDS; the edge has an id
    of its own (same allocator as nodes) so frames can highlight edges too. */
export interface WEdge {
  id: number;
  a: number;
  b: number;
  w: number;
}

export type DSData =
  | { kind: "list"; nodes: ListNode[] }
  | { kind: "stack"; items: ListNode[] }
  | { kind: "queue"; items: ListNode[] }
  | { kind: "tree"; root: TreeNode | null }
  | { kind: "graph"; nodes: ListNode[]; edges: [number, number][] }
  | { kind: "wgraph"; nodes: ListNode[]; edges: WEdge[]; directed: boolean }
  | { kind: "heap"; items: ListNode[] }
  | { kind: "hash"; buckets: ListNode[][] }
  | { kind: "oahash"; slots: (ListNode | "tomb" | null)[]; probe: "linear" | "quadratic" }
  | { kind: "array"; items: ListNode[] };

export interface Frame {
  data: DSData;
  /** node ids drawn highlighted (the teacher's pointer) */
  hl: number[];
  /** ids flashed green (success) or red (problem) this frame */
  ok?: number[];
  bad?: number[];
  /** ids drawn in the inverted "pivot" style (quick sort's anchor value) */
  pivot?: number[];
  /** per-node captions drawn under the circle (id → "d=7", "in: 2", …) */
  labels?: Record<number, string>;
  note: string;
}

let nextId = 1;

/** Sibling engine modules (wgraph, btree) share the id space so FLIP keys
    stay globally unique across every structure. */
export const allocId = (): number => nextId++;
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

export function listUpdate(d: { nodes: ListNode[] }, from: number, to: number): Frame[] {
  const frames: Frame[] = [];
  const data: DSData = { kind: "list", nodes: clone(d.nodes) };
  for (const node of data.nodes) {
    if (node.value === from) {
      frames.push(snap(data, `Found ${from} — overwrite its data field with ${to}.`, { hl: [node.id], bad: [node.id] }));
      node.value = to;
      frames.push(snap(data, `Done: the node keeps its links, only the payload changed — updating never rewires a list.`, { hl: [node.id], ok: [node.id] }));
      return frames;
    }
    frames.push(snap(data, `Node holds ${node.value}, not ${from} — follow next.`, { hl: [node.id] }));
  }
  frames.push(snap(data, `Reached null — ${from} is not in the list, nothing to update.`, { bad: [] }));
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

export function stackPeek(d: { items: ListNode[] }): Frame[] {
  const data: DSData = { kind: "stack", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The stack is empty — nothing to peek at.`, { bad: [] })];
  const top = data.items[data.items.length - 1];
  return [snap(data, `Peek: the top holds ${top.value}. Reading it does NOT remove it.`, { hl: [top.id], ok: [top.id] })];
}

export function stackUpdateTop(d: { items: ListNode[] }, value: number): Frame[] {
  const data: DSData = { kind: "stack", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The stack is empty — there is no top to update.`, { bad: [] })];
  const top = data.items[data.items.length - 1];
  const frames = [snap(data, `A stack only exposes its TOP (${top.value}) — that is the only element you may change.`, { hl: [top.id] })];
  top.value = value;
  frames.push(snap(data, `Top overwritten with ${value}. Everything underneath stays untouched.`, { hl: [top.id], ok: [top.id] }));
  return frames;
}

export function queuePeek(d: { items: ListNode[] }): Frame[] {
  const data: DSData = { kind: "queue", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The queue is empty — nothing at the front.`, { bad: [] })];
  const front = data.items[0];
  return [snap(data, `Peek: the front holds ${front.value} — the next element to leave. Reading it does NOT remove it.`, { hl: [front.id], ok: [front.id] })];
}

export function queueUpdateFront(d: { items: ListNode[] }, value: number): Frame[] {
  const data: DSData = { kind: "queue", items: clone(d.items) };
  if (data.items.length === 0) return [snap(data, `The queue is empty — there is no front to update.`, { bad: [] })];
  const front = data.items[0];
  const frames = [snap(data, `A queue only exposes its FRONT (${front.value}) — that is the only element you may change.`, { hl: [front.id] })];
  front.value = value;
  frames.push(snap(data, `Front overwritten with ${value}. The waiting order behind it is unchanged.`, { hl: [front.id], ok: [front.id] }));
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

const treeContains = (root: TreeNode | null, v: number): boolean => {
  let n = root;
  while (n) {
    if (n.value === v) return true;
    n = v < n.value ? n.left : n.right;
  }
  return false;
};

export function treeTraverse(root: TreeNode | null, order: "in" | "pre" | "post"): Frame[] {
  const r = clone(root);
  if (!r) return [snap(tree(r), `The tree is empty — nothing to traverse.`, { bad: [] })];
  const frames: Frame[] = [];
  const out: TreeNode[] = [];
  const intro = {
    in: `INORDER (left, node, right): visits a BST in perfectly SORTED order.`,
    pre: `PREORDER (node, left, right): the order you'd use to COPY the tree, roots first.`,
    post: `POSTORDER (left, right, node): the order you'd use to safely DELETE it, children first.`,
  };
  frames.push(snap(tree(r), intro[order], {}));
  const visit = (n: TreeNode) => {
    out.push(n);
    frames.push(snap(tree(r), `Output ${n.value} — sequence so far: ${out.map((o) => o.value).join(", ")}.`, {
      hl: [n.id],
      ok: out.map((o) => o.id),
    }));
  };
  const walk = (n: TreeNode | null) => {
    if (!n) return;
    if (order === "pre") visit(n);
    walk(n.left);
    if (order === "in") visit(n);
    walk(n.right);
    if (order === "post") visit(n);
  };
  walk(r);
  frames.push(snap(tree(r), `Traversal complete: ${out.map((o) => o.value).join(" → ")}.`, { ok: out.map((o) => o.id) }));
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

export function avlRemove(root: TreeNode | null, value: number): Frame[] {
  const frames: Frame[] = [];
  let treeRoot = clone(root) as ANode | null;
  const withHeights = (n: ANode | null): number => (n ? (n.h = 1 + Math.max(withHeights(n.left), withHeights(n.right))) : 0);
  withHeights(treeRoot);
  const snapTree = (note: string, extra: Partial<Frame> = {}) =>
    frames.push({ data: { kind: "tree", root: strip(treeRoot) }, hl: [], note, ...extra });

  let found = false;
  const rebalance = (n: ANode): ANode => {
    upd(n);
    const b = bal(n);
    if (b > 1 || b < -1) {
      snapTree(`Node ${n.value} is UNBALANCED (balance ${b}) after the deletion below it.`, { hl: [n.id], bad: [n.id] });
      if (b > 1) {
        if (bal(n.left as ANode) >= 0) {
          snapTree(`Left-heavy, and the left child leans left too → one ROTATE RIGHT around ${n.value}.`, { hl: [n.id] });
          n = rotateRight(n);
        } else {
          snapTree(`Left-Right shape → rotate LEFT around ${(n.left as ANode).value}, then RIGHT around ${n.value}.`, { hl: [n.id] });
          n.left = rotateLeft(n.left as ANode);
          n = rotateRight(n);
        }
      } else if (bal(n.right as ANode) <= 0) {
        snapTree(`Right-heavy, and the right child leans right too → one ROTATE LEFT around ${n.value}.`, { hl: [n.id] });
        n = rotateLeft(n);
      } else {
        snapTree(`Right-Left shape → rotate RIGHT around ${(n.right as ANode).value}, then LEFT around ${n.value}.`, { hl: [n.id] });
        n.right = rotateRight(n.right as ANode);
        n = rotateLeft(n);
      }
    }
    return n;
  };

  const remove = (n: ANode | null, v: number): ANode | null => {
    if (!n) return null;
    if (v < n.value) {
      snapTree(`${v} < ${n.value} — go LEFT (normal BST delete first).`, { hl: [n.id] });
      n.left = remove(n.left, v);
    } else if (v > n.value) {
      snapTree(`${v} > ${n.value} — go RIGHT (normal BST delete first).`, { hl: [n.id] });
      n.right = remove(n.right, v);
    } else {
      found = true;
      if (n.left && n.right) {
        let s = n.right;
        while (s.left) s = s.left;
        snapTree(`${v} has two children — copy its SUCCESSOR ${s.value} up, then delete ${s.value} from the right subtree.`, { hl: [n.id, s.id], bad: [n.id] });
        n.value = s.value;
        n.right = remove(n.right, s.value);
      } else {
        const child = n.left ?? n.right;
        snapTree(child ? `Found ${v} — its single child takes its place.` : `Found ${v} — a leaf, snip it off.`, { hl: [n.id], bad: [n.id] });
        return child;
      }
    }
    return rebalance(n);
  };

  treeRoot = remove(treeRoot, value);
  if (!found) {
    snapTree(`${value} is not in the tree — nothing to remove.`, { bad: [] });
    return frames;
  }
  snapTree(`${value} removed and every node on the way back up re-balanced — AVL deletion may rotate at SEVERAL levels.`, { ok: [] });
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

export function rbRemove(root: TreeNode | null, value: number): Frame[] {
  const frames: Frame[] = [];
  let rbRoot = rbFromTree(clone(root), null);
  const snapTree = (note: string, extra: Partial<Frame> = {}) =>
    frames.push({ data: { kind: "tree", root: rbStrip(rbRoot) }, hl: [], note, ...extra });

  let z = rbRoot;
  while (z && z.value !== value) {
    snapTree(`BST walk: ${value} vs ${z.value} → ${value < z.value ? "left" : "right"}.`, { hl: [z.id] });
    z = value < z.value ? z.left : z.right;
  }
  if (!z) {
    snapTree(`${value} is not in the tree — nothing to remove.`, { bad: [] });
    return frames;
  }
  snapTree(`Found ${value} (a ${z.color.toUpperCase()} node). Removing a red node is free; removing a black one shortens a path's black count.`, { hl: [z.id], bad: [z.id] });

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

  const transplant = (u: RNode, v: RNode | null): void => {
    if (!u.parent) rbRoot = v;
    else if (u === u.parent.left) u.parent.left = v;
    else u.parent.right = v;
    if (v) v.parent = u.parent;
  };

  let removedColor = z.color;
  let x: RNode | null;
  let xParent: RNode | null;
  if (!z.left) {
    x = z.right;
    xParent = z.parent;
    transplant(z, z.right);
    snapTree(z.right ? `${value} has one child — it slides up into its place.` : `Unlink ${value}.`, {});
  } else if (!z.right) {
    x = z.left;
    xParent = z.parent;
    transplant(z, z.left);
    snapTree(`${value} has one child — it slides up into its place.`, {});
  } else {
    let y = z.right;
    while (y.left) y = y.left;
    snapTree(`${value} has two children — its SUCCESSOR ${y.value} will take its position AND its color.`, { hl: [y.id] });
    removedColor = y.color;
    x = y.right;
    if (y.parent === z) {
      xParent = y;
    } else {
      xParent = y.parent;
      transplant(y, y.right);
      y.right = z.right;
      y.right.parent = y;
    }
    transplant(z, y);
    y.left = z.left;
    y.left.parent = y;
    y.color = z.color;
    snapTree(`${y.value} moved up wearing ${value}'s color (${z.color}) — colors belong to POSITIONS, not keys. The node actually removed was ${removedColor}.`, { hl: [y.id] });
  }

  if (removedColor === "black") {
    const isBlack = (n: RNode | null): boolean => !n || n.color === "black";
    snapTree(`A BLACK node left the tree, so one path is short a black — a "DOUBLE BLACK" sits ${x ? `on ${x.value}` : "on the empty spot"}. Repair it.`, x ? { hl: [x.id], bad: [x.id] } : { bad: [] });
    while (x !== rbRoot && isBlack(x) && xParent) {
      const p = xParent;
      const onLeft = p.left === x;
      let w = onLeft ? p.right : p.left;
      if (!w) break;
      if (w.color === "red") {
        snapTree(`Case 1 — sibling ${w.value} is RED: swap its color with parent ${p.value} and rotate toward the double black. The new sibling is black.`, { hl: [w.id, p.id] });
        w.color = "black";
        p.color = "red";
        rotate(p, onLeft ? "left" : "right");
        w = onLeft ? p.right : p.left;
        if (!w) break;
      }
      if (isBlack(w.left) && isBlack(w.right)) {
        snapTree(`Case 2 — sibling ${w.value} and both its children are black: paint ${w.value} RED, which pushes the double black up to ${p.value}.`, { hl: [w.id], bad: [p.id] });
        w.color = "red";
        x = p;
        xParent = p.parent;
        continue;
      }
      if (onLeft ? isBlack(w.right) : isBlack(w.left)) {
        const near = (onLeft ? w.left : w.right) as RNode;
        snapTree(`Case 3 — sibling's NEAR child ${near.value} is red, far child black: rotate around ${w.value} to point the red child outward.`, { hl: [w.id, near.id] });
        near.color = "black";
        w.color = "red";
        rotate(w, onLeft ? "right" : "left");
        w = (onLeft ? p.right : p.left) as RNode;
      }
      const far = (onLeft ? w.right : w.left) as RNode;
      snapTree(`Case 4 — sibling ${w.value} has a red FAR child ${far.value}: rotate the parent and recolor — the missing black is restored, done.`, { hl: [w.id, far.id, p.id] });
      w.color = p.color;
      p.color = "black";
      far.color = "black";
      rotate(p, onLeft ? "left" : "right");
      x = rbRoot;
      xParent = null;
    }
    if (x && x.color === "red") {
      snapTree(`The double black landed on a RED node (${x.value}) — simply paint it black to restore the count.`, { hl: [x.id] });
    }
    if (x) x.color = "black";
  } else {
    snapTree(`The removed node was RED — no path lost a black, so no repair is needed.`, {});
  }
  snapTree(`${value} removed — every root-to-leaf path carries equal black again, and no red stacks on red.`, { ok: [] });
  return frames;
}

// tree update = remove + insert (works for BST, AVL, and red-black alike)
function updateVia(
  root: TreeNode | null,
  from: number,
  to: number,
  removeFn: (r: TreeNode | null, v: number) => Frame[],
  insertFn: (r: TreeNode | null, v: number) => Frame[],
  flavor: string,
): Frame[] {
  if (!treeContains(root, from)) return [snap(tree(clone(root)), `${from} is not in the tree — nothing to update.`, { bad: [] })];
  if (treeContains(root, to)) return [snap(tree(clone(root)), `${to} is already in the tree — updating would create a duplicate.`, { bad: [] })];
  const frames: Frame[] = [
    snap(tree(clone(root)), `You can't just overwrite a key in a ${flavor} — the ordering would break. UPDATE = REMOVE ${from}, then INSERT ${to}.`, {}),
  ];
  const rem = removeFn(root, from);
  frames.push(...rem);
  const mid = rem[rem.length - 1].data;
  frames.push(...insertFn(mid.kind === "tree" ? mid.root : null, to));
  return frames;
}

export const bstUpdate = (root: TreeNode | null, from: number, to: number): Frame[] => updateVia(root, from, to, bstRemove, bstInsert, "BST");
export const avlUpdate = (root: TreeNode | null, from: number, to: number): Frame[] => updateVia(root, from, to, avlRemove, avlInsert, "AVL tree");
export const rbUpdate = (root: TreeNode | null, from: number, to: number): Frame[] => updateVia(root, from, to, rbRemove, rbInsert, "red-black tree");

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

// BFS/DFS and shortest-path narration moved to wgraph.ts (the Graph
// Algorithms lab) — the plain Graph card is structure-building only.

export function graphRemoveNode(d: { nodes: ListNode[]; edges: [number, number][] }, value: number): Frame[] {
  const node = d.nodes.find((n) => n.value === value);
  if (!node) return [snap({ kind: "graph", ...clone(d) }, `Vertex ${value} does not exist.`, { bad: [] })];
  const incident = d.edges.filter(([a, b]) => a === node.id || b === node.id).length;
  const frames = [snap({ kind: "graph", ...clone(d) }, `Removing vertex ${value} — its ${incident} edge${incident === 1 ? "" : "s"} must go with it, or they would dangle.`, { hl: [node.id], bad: [node.id] })];
  const data: DSData = {
    kind: "graph",
    nodes: clone(d.nodes).filter((n) => n.id !== node.id),
    edges: clone(d.edges).filter(([a, b]) => a !== node.id && b !== node.id),
  };
  frames.push(snap(data, `Vertex ${value} and its incident edges are gone; every other connection survives.`, {}));
  return frames;
}

export function graphRemoveEdge(d: { nodes: ListNode[]; edges: [number, number][] }, a: number, b: number): Frame[] {
  const na = d.nodes.find((n) => n.value === a);
  const nb = d.nodes.find((n) => n.value === b);
  const hit = na && nb ? d.edges.find(([x, y]) => (x === na.id && y === nb.id) || (x === nb.id && y === na.id)) : undefined;
  if (!hit) return [snap({ kind: "graph", ...clone(d) }, `There is no edge ${a} — ${b} to remove.`, { bad: [] })];
  const frames = [snap({ kind: "graph", ...clone(d) }, `Removing edge ${a} — ${b}: the vertices stay, they just stop being neighbours.`, { hl: [na!.id, nb!.id], bad: [na!.id, nb!.id] })];
  const data: DSData = { kind: "graph", nodes: clone(d.nodes), edges: clone(d.edges).filter(([x, y]) => !(x === hit[0] && y === hit[1])) };
  frames.push(snap(data, `Edge gone. Any path that used it must now go another way.`, {}));
  return frames;
}

export function graphUpdateNode(d: { nodes: ListNode[]; edges: [number, number][] }, from: number, to: number): Frame[] {
  const data: DSData = { kind: "graph", nodes: clone(d.nodes), edges: clone(d.edges) };
  const node = data.nodes.find((n) => n.value === from);
  if (!node) return [snap(data, `Vertex ${from} does not exist.`, { bad: [] })];
  if (data.nodes.some((n) => n.value === to)) return [snap(data, `A vertex named ${to} already exists.`, { bad: [] })];
  const frames = [snap(data, `Renaming vertex ${from} to ${to} — labels are just data; the edges don't care.`, { hl: [node.id] })];
  node.value = to;
  frames.push(snap(data, `Done: same vertex, same neighbours, new label ${to}.`, { hl: [node.id], ok: [node.id] }));
  return frames;
}

// ---------- binary min-heap ----------

const heap = (items: ListNode[]): DSData => ({ kind: "heap", items });

export function heapInsert(d: { items: ListNode[] }, value: number): Frame[] {
  const items = clone(d.items);
  const node = fresh(value);
  items.push(node);
  if (items.length === 1) {
    return [snap(heap(items), `The heap is empty, so ${value} becomes the root — trivially the minimum.`, { hl: [node.id], ok: [node.id] })];
  }
  const frames = [
    snap(heap(items), `Place ${value} in the first FREE slot (index ${items.length - 1}) — a heap always stays a complete tree.`, { hl: [node.id] }),
  ];
  let i = items.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (items[p].value <= items[i].value) {
      frames.push(snap(heap(items), `Parent ${items[p].value} ≤ ${items[i].value}: the min-heap rule holds — stop sifting.`, { hl: [items[p].id], ok: [items[i].id] }));
      return frames;
    }
    frames.push(snap(heap(items), `Parent ${items[p].value} > ${items[i].value}: rule broken — swap them (SIFT UP).`, { hl: [items[p].id, items[i].id], bad: [items[p].id] }));
    [items[i], items[p]] = [items[p], items[i]];
    frames.push(snap(heap(items), `${value} climbs to index ${p}.`, { hl: [items[p].id] }));
    i = p;
  }
  frames.push(snap(heap(items), `${value} reached the root — it is the new minimum.`, { ok: [items[0].id] }));
  return frames;
}

export function heapExtract(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length === 0) return [snap(heap(items), `The heap is empty — nothing to extract.`, { bad: [] })];
  const root = items[0];
  const frames = [snap(heap(items), `Extract-min: the smallest value ${root.value} always sits at the root — that is the whole point of a heap.`, { hl: [root.id], ok: [root.id] })];
  const last = items.pop() as ListNode;
  if (items.length === 0) {
    frames.push(snap(heap(items), `Removed ${root.value} — the heap is empty now.`, {}));
    return frames;
  }
  items[0] = last;
  frames.push(snap(heap(items), `Fill the hole with the LAST element ${last.value} so the tree stays complete — then repair the rule downward.`, { hl: [last.id], bad: [last.id] }));
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let s = i;
    if (l < items.length && items[l].value < items[s].value) s = l;
    if (r < items.length && items[r].value < items[s].value) s = r;
    if (s === i) {
      frames.push(snap(heap(items), l < items.length
        ? `${items[i].value} is ≤ its children — the heap rule holds everywhere again.`
        : `${items[i].value} reached a leaf — SIFT DOWN complete.`, { ok: [items[i].id] }));
      return frames;
    }
    frames.push(snap(heap(items), `${items[i].value} vs its children: the smallest child ${items[s].value} wins — swap down.`, { hl: [items[i].id, items[s].id], bad: [items[i].id] }));
    [items[i], items[s]] = [items[s], items[i]];
    i = s;
  }
}

/** Repair the heap at index i in whichever direction the value violates the rule. */
function heapSift(items: ListNode[], i: number, frames: Frame[]): void {
  const p = (i - 1) >> 1;
  if (i > 0 && items[i].value < items[p].value) {
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (items[up].value <= items[i].value) break;
      frames.push(snap(heap(items), `${items[i].value} < parent ${items[up].value} — SIFT UP: swap.`, { hl: [items[up].id, items[i].id], bad: [items[up].id] }));
      [items[i], items[up]] = [items[up], items[i]];
      i = up;
    }
    frames.push(snap(heap(items), `${items[i].value} stopped where its parent is smaller — heap repaired.`, { ok: [items[i].id] }));
    return;
  }
  for (;;) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let s = i;
    if (l < items.length && items[l].value < items[s].value) s = l;
    if (r < items.length && items[r].value < items[s].value) s = r;
    if (s === i) {
      frames.push(snap(heap(items), l < items.length
        ? `${items[i].value} is ≤ its children — heap repaired.`
        : `${items[i].value} reached a leaf — heap repaired.`, { ok: [items[i].id] }));
      return;
    }
    frames.push(snap(heap(items), `${items[i].value} > smallest child ${items[s].value} — SIFT DOWN: swap.`, { hl: [items[i].id, items[s].id], bad: [items[i].id] }));
    [items[i], items[s]] = [items[s], items[i]];
    i = s;
  }
}

export function heapRemove(d: { items: ListNode[] }, value: number): Frame[] {
  const items = clone(d.items);
  const idx = items.findIndex((n) => n.value === value);
  if (idx === -1) return [snap(heap(items), `${value} is not in the heap.`, { bad: [] })];
  const target = items[idx];
  const frames = [snap(heap(items), `Remove ${value} — unlike extract-min this can be ANY node, but the repair trick is the same.`, { hl: [target.id], bad: [target.id] })];
  const last = items.pop() as ListNode;
  if (idx === items.length) {
    frames.push(snap(heap(items), `${value} occupied the LAST slot — just drop it; the tree stays complete.`, {}));
    return frames;
  }
  items[idx] = last;
  frames.push(snap(heap(items), `Fill the hole with the LAST element ${last.value} to keep the tree complete — then repair.`, { hl: [last.id] }));
  heapSift(items, idx, frames);
  return frames;
}

export function heapUpdate(d: { items: ListNode[] }, from: number, to: number): Frame[] {
  const items = clone(d.items);
  const idx = items.findIndex((n) => n.value === from);
  if (idx === -1) return [snap(heap(items), `${from} is not in the heap.`, { bad: [] })];
  const target = items[idx];
  const frames = [
    snap(heap(items), to < from
      ? `DECREASE-KEY ${from} → ${to}: the value shrinks, so it may need to float UP toward the root.`
      : `INCREASE-KEY ${from} → ${to}: the value grows, so it may need to sink DOWN below its children.`, { hl: [target.id] }),
  ];
  target.value = to;
  frames.push(snap(heap(items), `Rewrite the key in place…`, { hl: [target.id] }));
  heapSift(items, idx, frames);
  return frames;
}

// ---------- hash table (separate chaining) ----------

export const HASH_BUCKETS = 7;
const hashTable = (buckets: ListNode[][]): DSData => ({ kind: "hash", buckets });
const bucketOf = (v: number): number => ((v % HASH_BUCKETS) + HASH_BUCKETS) % HASH_BUCKETS;

export function hashInsert(d: { buckets: ListNode[][] }, value: number): Frame[] {
  const buckets = clone(d.buckets);
  const h = bucketOf(value);
  const chain = buckets[h];
  const frames = [snap(hashTable(buckets), `hash(${value}) = ${value} mod ${HASH_BUCKETS} = ${h} — jump straight to bucket ${h}, ignore all others.`, { hl: chain.map((n) => n.id) })];
  for (const n of chain) {
    if (n.value === value) {
      frames.push(snap(hashTable(buckets), `${value} is already in bucket ${h} — no duplicates.`, { hl: [n.id], bad: [n.id] }));
      return frames;
    }
  }
  const node = fresh(value);
  chain.push(node);
  frames.push(snap(hashTable(buckets), chain.length > 1
    ? `Bucket ${h} is occupied — a COLLISION. Chaining handles it: ${value} joins the bucket's little linked list.`
    : `Bucket ${h} is free — ${value} drops straight in. One arithmetic step, no searching: O(1).`, { hl: [node.id], ok: [node.id] }));
  return frames;
}

export function hashSearch(d: { buckets: ListNode[][] }, value: number): Frame[] {
  const buckets = clone(d.buckets);
  const h = bucketOf(value);
  const frames = [snap(hashTable(buckets), `hash(${value}) = ${value} mod ${HASH_BUCKETS} = ${h} — if ${value} exists, it can ONLY be in bucket ${h}.`, { hl: buckets[h].map((n) => n.id) })];
  for (const n of buckets[h]) {
    if (n.value === value) {
      frames.push(snap(hashTable(buckets), `Found ${value} in bucket ${h}'s chain.`, { hl: [n.id], ok: [n.id] }));
      return frames;
    }
    frames.push(snap(hashTable(buckets), `Chain node holds ${n.value}, not ${value} — follow the chain.`, { hl: [n.id] }));
  }
  frames.push(snap(hashTable(buckets), `Bucket ${h}'s chain is exhausted — ${value} is not in the table.`, { bad: [] }));
  return frames;
}

export function hashRemove(d: { buckets: ListNode[][] }, value: number): Frame[] {
  const buckets = clone(d.buckets);
  const h = bucketOf(value);
  const frames = [snap(hashTable(buckets), `hash(${value}) = ${value} mod ${HASH_BUCKETS} = ${h} — look for ${value} in bucket ${h}.`, { hl: buckets[h].map((n) => n.id) })];
  for (let i = 0; i < buckets[h].length; i++) {
    const n = buckets[h][i];
    if (n.value === value) {
      frames.push(snap(hashTable(buckets), `Found ${value} — unlink it from the chain…`, { hl: [n.id], bad: [n.id] }));
      buckets[h].splice(i, 1);
      frames.push(snap(hashTable(buckets), `…and it is gone. The rest of the chain stays linked.`, {}));
      return frames;
    }
    frames.push(snap(hashTable(buckets), `Chain node holds ${n.value}, not ${value} — keep walking.`, { hl: [n.id] }));
  }
  frames.push(snap(hashTable(buckets), `${value} is not in bucket ${h}, so it is not in the table.`, { bad: [] }));
  return frames;
}

export function hashUpdate(d: { buckets: ListNode[][] }, from: number, to: number): Frame[] {
  const buckets = clone(d.buckets);
  const hFrom = bucketOf(from);
  const hTo = bucketOf(to);
  const chain = buckets[hFrom];
  const i = chain.findIndex((n) => n.value === from);
  if (i === -1) return [snap(hashTable(buckets), `${from} is not in the table (its bucket ${hFrom} doesn't hold it).`, { bad: [] })];
  if (buckets[hTo].some((n) => n.value === to)) return [snap(hashTable(buckets), `${to} already exists in bucket ${hTo} — no duplicates.`, { bad: [] })];
  const node = chain[i];
  const frames = [
    snap(hashTable(buckets), `Updating a KEY changes its hash: ${from} lives in bucket ${hFrom}, but ${to} belongs in bucket ${hTo}${hTo === hFrom ? " — the same one, luckily" : ""}.`, { hl: [node.id] }),
  ];
  if (hTo === hFrom) {
    node.value = to;
    frames.push(snap(hashTable(buckets), `Same bucket, so rewriting in place is safe.`, { hl: [node.id], ok: [node.id] }));
    return frames;
  }
  chain.splice(i, 1);
  frames.push(snap(hashTable(buckets), `Unlink ${from} from bucket ${hFrom}…`, { bad: [] }));
  node.value = to;
  buckets[hTo].push(node);
  frames.push(snap(hashTable(buckets), `…and re-insert it as ${to} into bucket ${hTo}. NEVER update a hashed key in place — it becomes unfindable.`, { hl: [node.id], ok: [node.id] }));
  return frames;
}

// ---------- hash table: open addressing ----------
// The alternative collision policy: no chains — collide, then PROBE for the
// next free slot. Linear tries h, h+1, h+2, …; quadratic tries h, h+1², h+2²,
// … Removals leave a tombstone so later probe walks don't stop early.

export const OA_SLOTS = 11;
export type Probe = "linear" | "quadratic";
export type OASlot = ListNode | "tomb" | null;
const oaTable = (slots: OASlot[], probe: Probe): DSData => ({ kind: "oahash", slots, probe });
const oaHome = (v: number): number => ((v % OA_SLOTS) + OA_SLOTS) % OA_SLOTS;
const oaStep = (h: number, k: number, probe: Probe): number => (h + (probe === "linear" ? k : k * k)) % OA_SLOTS;
const probeName = (probe: Probe): string => (probe === "linear" ? "linear probing" : "quadratic probing");
const probeJump = (k: number, probe: Probe): string =>
  probe === "linear" ? `+${k}` : `+${k}² = +${k * k}`;
export const emptyOA = (probe: Probe): DSData => oaTable(Array.from({ length: OA_SLOTS }, () => null), probe);

export function oaHashInsert(d: { slots: OASlot[]; probe: Probe }, value: number): Frame[] {
  const slots = clone(d.slots);
  const probe = d.probe;
  const h = oaHome(value);
  const frames = [snap(oaTable(slots, probe), `hash(${value}) = ${value} mod ${OA_SLOTS} = ${h} — the home slot. If it's taken, ${probeName(probe)} finds the next candidate.`, {})];
  let tombAt = -1;
  for (let k = 0; k < OA_SLOTS; k++) {
    const s = oaStep(h, k, probe);
    const cur = slots[s];
    if (cur !== null && cur !== "tomb" && cur.value === value) {
      frames.push(snap(oaTable(slots, probe), `Slot ${s} already holds ${value} — no duplicates.`, { hl: [cur.id], bad: [cur.id] }));
      return frames;
    }
    if (cur === null || cur === "tomb") {
      if (cur === "tomb" && tombAt === -1) tombAt = s;
      if (cur === "tomb") {
        frames.push(snap(oaTable(slots, probe), `Slot ${s} holds a tombstone — a reusable grave. But keep probing first: ${value} might already live further along.`, {}));
        continue;
      }
      const at = tombAt !== -1 ? tombAt : s;
      const node = fresh(value);
      slots[at] = node;
      frames.push(snap(oaTable(slots, probe),
        k === 0 && at === s
          ? `Home slot ${at} is free — ${value} drops straight in: O(1), no probing needed.`
          : tombAt !== -1
            ? `${value} isn't in the table, so it recycles the first tombstone: slot ${at}.`
            : `Free slot found: after ${k} ${k === 1 ? "probe" : "probes"}, ${value} settles into slot ${at}.`,
        { hl: [node.id], ok: [node.id] }));
      return frames;
    }
    frames.push(snap(oaTable(slots, probe), `Slot ${s} is occupied by ${cur.value} — COLLISION. Probe ${probeJump(k + 1, probe)} → slot ${oaStep(h, k + 1, probe)}.`, { hl: [cur.id] }));
  }
  if (tombAt !== -1) {
    const node = fresh(value);
    slots[tombAt] = node;
    frames.push(snap(oaTable(slots, probe), `The whole probe path is walked — no duplicate found, so ${value} recycles the first tombstone: slot ${tombAt}.`, { hl: [node.id], ok: [node.id] }));
    return frames;
  }
  frames.push(snap(oaTable(slots, probe), `The probe sequence found no free slot — with open addressing a crowded table simply fills up. A real table would RESIZE here.`, { bad: [] }));
  return frames;
}

export function oaHashSearch(d: { slots: OASlot[]; probe: Probe }, value: number): Frame[] {
  const slots = clone(d.slots);
  const probe = d.probe;
  const h = oaHome(value);
  const frames = [snap(oaTable(slots, probe), `hash(${value}) = ${h} — start at the home slot and retrace the exact probe path an insert would take.`, {})];
  for (let k = 0; k < OA_SLOTS; k++) {
    const s = oaStep(h, k, probe);
    const cur = slots[s];
    if (cur === null) {
      frames.push(snap(oaTable(slots, probe), `Slot ${s} is EMPTY — the probe path ends here, so ${value} cannot be in the table.`, { bad: [] }));
      return frames;
    }
    if (cur === "tomb") {
      frames.push(snap(oaTable(slots, probe), `Slot ${s} is a tombstone — someone was deleted here. The search must keep walking past it.`, {}));
      continue;
    }
    if (cur.value === value) {
      frames.push(snap(oaTable(slots, probe), `Found ${value} in slot ${s} after ${k} ${k === 1 ? "probe" : "probes"}.`, { hl: [cur.id], ok: [cur.id] }));
      return frames;
    }
    frames.push(snap(oaTable(slots, probe), `Slot ${s} holds ${cur.value}, not ${value} — probe ${probeJump(k + 1, probe)}.`, { hl: [cur.id] }));
  }
  frames.push(snap(oaTable(slots, probe), `Probed every slot on the path — ${value} is not in the table.`, { bad: [] }));
  return frames;
}

export function oaHashRemove(d: { slots: OASlot[]; probe: Probe }, value: number): Frame[] {
  const slots = clone(d.slots);
  const probe = d.probe;
  const h = oaHome(value);
  const frames = [snap(oaTable(slots, probe), `hash(${value}) = ${h} — walk the probe path to find ${value}.`, {})];
  for (let k = 0; k < OA_SLOTS; k++) {
    const s = oaStep(h, k, probe);
    const cur = slots[s];
    if (cur === null) {
      frames.push(snap(oaTable(slots, probe), `Slot ${s} is empty — ${value} is not in the table.`, { bad: [] }));
      return frames;
    }
    if (cur === "tomb") continue;
    if (cur.value === value) {
      frames.push(snap(oaTable(slots, probe), `Found ${value} in slot ${s}. It can't just be emptied — that would cut the probe path for everything inserted after it…`, { hl: [cur.id], bad: [cur.id] }));
      slots[s] = "tomb";
      frames.push(snap(oaTable(slots, probe), `…so it becomes a TOMBSTONE: searches walk past it, inserts may recycle it.`, {}));
      return frames;
    }
    frames.push(snap(oaTable(slots, probe), `Slot ${s} holds ${cur.value} — probe onward.`, { hl: [cur.id] }));
  }
  frames.push(snap(oaTable(slots, probe), `${value} is not on the probe path — not in the table.`, { bad: [] }));
  return frames;
}

export function oaHashUpdate(d: { slots: OASlot[]; probe: Probe }, from: number, to: number): Frame[] {
  const exists = d.slots.some((s) => s !== null && s !== "tomb" && s.value === from);
  if (!exists) return [snap(oaTable(clone(d.slots), d.probe), `${from} is not in the table.`, { bad: [] })];
  if (d.slots.some((s) => s !== null && s !== "tomb" && s.value === to)) {
    return [snap(oaTable(clone(d.slots), d.probe), `${to} already exists — no duplicates.`, { bad: [] })];
  }
  const removal = oaHashRemove(d, from);
  const after = removal[removal.length - 1].data as { slots: OASlot[]; probe: Probe };
  const insertion = oaHashInsert(after, to);
  return [
    snap(oaTable(clone(d.slots), d.probe), `Updating a hashed KEY means remove-then-reinsert: ${to} hashes to its own slot, not ${from}'s.`, {}),
    ...removal,
    ...insertion,
  ];
}

// ---------- sorting ----------

const arrData = (items: ListNode[]): DSData => ({ kind: "array", items });

export function arrayPush(d: { items: ListNode[] }, value: number): Frame[] {
  const node = fresh(value);
  const items = [...clone(d.items), node];
  return [snap(arrData(items), `Added ${value}. Load a few values, then pick a sorting algorithm.`, { hl: [node.id], ok: [node.id] })];
}

export function arrayRemove(d: { items: ListNode[] }, value: number): Frame[] {
  const items = clone(d.items);
  const idx = items.findIndex((n) => n.value === value);
  if (idx === -1) return [snap(arrData(items), `${value} is not in the array.`, { bad: [] })];
  const frames = [snap(arrData(items), `Remove items[${idx}] = ${value}…`, { hl: [items[idx].id], bad: [items[idx].id] })];
  items.splice(idx, 1);
  frames.push(snap(arrData(items), `…and every later element shifts one slot left to close the gap — that shift is why array removal costs O(n).`, {}));
  return frames;
}

export function arrayUpdate(d: { items: ListNode[] }, from: number, to: number): Frame[] {
  const items = clone(d.items);
  const idx = items.findIndex((n) => n.value === from);
  if (idx === -1) return [snap(arrData(items), `${from} is not in the array.`, { bad: [] })];
  const frames = [snap(arrData(items), `Update items[${idx}]: ${from} → ${to}.`, { hl: [items[idx].id] })];
  items[idx].value = to;
  frames.push(snap(arrData(items), `Overwritten in place — with an index in hand, an array update is O(1). Watch the bar change height.`, { hl: [items[idx].id], ok: [items[idx].id] }));
  return frames;
}

/** Frame helper: sorted-so-far ids stay green in every subsequent frame. */
function sorter(items: ListNode[]) {
  const frames: Frame[] = [];
  const done: number[] = [];
  const shot = (note: string, extra: Partial<Frame> = {}) =>
    frames.push(snap(arrData(items), note, { ...extra, ok: [...done, ...(extra.ok ?? [])] }));
  return { frames, done, shot };
}

const trivial = (items: ListNode[]): Frame[] => [
  snap(arrData(items), `Fewer than two elements — nothing to sort.`, { ok: items.map((n) => n.id) }),
];

export function sortBubble(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, done, shot } = sorter(items);
  shot(`BUBBLE SORT: sweep left to right, swapping any neighbours that are out of order — big values bubble to the end.`);
  for (let end = items.length - 1; end > 0; end--) {
    let swapped = false;
    for (let j = 0; j < end; j++) {
      if (items[j].value > items[j + 1].value) {
        shot(`${items[j].value} > ${items[j + 1].value} — out of order: swap.`, { hl: [items[j].id, items[j + 1].id], bad: [items[j].id] });
        [items[j], items[j + 1]] = [items[j + 1], items[j]];
        swapped = true;
        shot(`Swapped — ${items[j + 1].value} moves one step toward the end.`, { hl: [items[j].id, items[j + 1].id] });
      } else {
        shot(`${items[j].value} ≤ ${items[j + 1].value} — already in order, move on.`, { hl: [items[j].id, items[j + 1].id] });
      }
    }
    done.push(items[end].id);
    shot(`Pass complete: ${items[end].value} is locked in its FINAL slot.`);
    if (!swapped) {
      for (let k = 0; k < end; k++) done.push(items[k].id);
      shot(`A full pass with zero swaps means everything is already sorted — stop early.`);
      return frames;
    }
  }
  done.push(items[0].id);
  shot(`The last element standing is the smallest — array sorted.`);
  return frames;
}

export function sortInsertion(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, shot } = sorter(items);
  shot(`INSERTION SORT: grow a sorted prefix on the left; take each next value and walk it back to where it belongs.`);
  for (let i = 1; i < items.length; i++) {
    const key = items[i];
    shot(`Take ${key.value} (index ${i}) — insert it into the sorted prefix on its left.`, { hl: [key.id] });
    let j = i;
    while (j > 0 && items[j - 1].value > items[j].value) {
      shot(`${items[j - 1].value} > ${key.value} — shift it right and step back.`, { hl: [items[j - 1].id, key.id], bad: [items[j - 1].id] });
      [items[j - 1], items[j]] = [items[j], items[j - 1]];
      j--;
    }
    shot(j === i
      ? `${key.value} is already ≥ its left neighbour — it stays put; the prefix grew by one.`
      : `${key.value} slots in at index ${j} — the prefix is sorted again.`, { hl: [key.id], ok: [key.id] });
  }
  frames.push(snap(arrData(items), `Every element has been inserted into place — array sorted.`, { ok: items.map((n) => n.id) }));
  return frames;
}

export function sortSelection(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, done, shot } = sorter(items);
  shot(`SELECTION SORT: scan for the smallest remaining value, swap it to the front, repeat.`);
  for (let i = 0; i < items.length - 1; i++) {
    let min = i;
    shot(`Round ${i + 1}: assume ${items[i].value} is the minimum, then scan the rest.`, { hl: [items[i].id] });
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].value < items[min].value) {
        shot(`${items[j].value} < ${items[min].value} — new minimum candidate.`, { hl: [items[j].id, items[min].id] });
        min = j;
      } else {
        shot(`${items[j].value} ≥ ${items[min].value} — keep the current minimum.`, { hl: [items[j].id] });
      }
    }
    if (min !== i) {
      shot(`The smallest remaining is ${items[min].value} — swap it into index ${i}.`, { hl: [items[min].id, items[i].id], bad: [items[i].id] });
      [items[i], items[min]] = [items[min], items[i]];
    }
    done.push(items[i].id);
    shot(`${items[i].value} is FINAL — the sorted prefix grows by one.`);
  }
  done.push(items[items.length - 1].id);
  shot(`Only one value remains and it must be the largest — array sorted.`);
  return frames;
}

export function sortQuick(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, done, shot } = sorter(items);
  shot(`QUICK SORT: pick a pivot, partition smaller values to its left and bigger to its right, then recurse on each side.`);
  const part = (lo: number, hi: number): void => {
    if (lo > hi) return;
    if (lo === hi) {
      done.push(items[lo].id);
      shot(`A single-element range (${items[lo].value}) is already sorted.`);
      return;
    }
    const pivot = items[hi];
    shot(`Partition [${lo}..${hi}]: the pivot is the last element, ${pivot.value} — drawn in ink so you never lose it.`, { pivot: [pivot.id] });
    let i = lo;
    for (let j = lo; j < hi; j++) {
      if (items[j].value < pivot.value) {
        if (i !== j) {
          [items[i], items[j]] = [items[j], items[i]];
          shot(`${items[i].value} < pivot ${pivot.value} — swapped into the "smaller" zone at index ${i}.`, { hl: [items[i].id], pivot: [pivot.id] });
        } else {
          shot(`${items[j].value} < pivot ${pivot.value} — already inside the "smaller" zone.`, { hl: [items[j].id], pivot: [pivot.id] });
        }
        i++;
      } else {
        shot(`${items[j].value} ≥ pivot ${pivot.value} — leave it on the right side.`, { hl: [items[j].id], pivot: [pivot.id] });
      }
    }
    [items[i], items[hi]] = [items[hi], items[i]];
    done.push(pivot.id);
    shot(`Swap the pivot to the boundary: ${pivot.value} is now in its FINAL position — everything left is smaller, everything right is bigger.`, { pivot: [pivot.id] });
    part(lo, i - 1);
    part(i + 1, hi);
  };
  part(0, items.length - 1);
  shot(`All ranges partitioned down to single elements — array sorted.`);
  return frames;
}

export function sortMerge(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, shot } = sorter(items);
  shot(`MERGE SORT: split the array in half, sort each half, then MERGE the two sorted halves together.`);
  const rec = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    shot(`Split [${lo}..${hi}] into [${lo}..${mid}] and [${mid + 1}..${hi}].`, { hl: items.slice(lo, hi + 1).map((n) => n.id) });
    rec(lo, mid);
    rec(mid + 1, hi);
    shot(`Both halves of [${lo}..${hi}] are sorted — merge them front to front.`, { hl: items.slice(lo, hi + 1).map((n) => n.id) });
    let i = lo;
    let m = mid;
    let j = mid + 1;
    while (i <= m && j <= hi) {
      if (items[i].value <= items[j].value) {
        shot(`${items[i].value} ≤ ${items[j].value} — the left element is already in place.`, { hl: [items[i].id, items[j].id] });
        i++;
      } else {
        const leftVal = items[i].value;
        const [moved] = items.splice(j, 1);
        items.splice(i, 0, moved);
        shot(`${moved.value} < ${leftVal} — slide it in front of the left run.`, { hl: [moved.id] });
        i++;
        m++;
        j++;
      }
    }
    shot(`[${lo}..${hi}] merged.`, { ok: items.slice(lo, hi + 1).map((n) => n.id) });
  };
  rec(0, items.length - 1);
  frames.push(snap(arrData(items), `All halves merged — array sorted. Merge sort ALWAYS costs O(n log n), even on hostile input.`, { ok: items.map((n) => n.id) }));
  return frames;
}

export function sortHeap(d: { items: ListNode[] }): Frame[] {
  const items = clone(d.items);
  if (items.length < 2) return trivial(items);
  const { frames, done, shot } = sorter(items);
  shot(`HEAP SORT: treat the array as a tree and arrange it into a MAX-heap, then repeatedly swap the biggest element to the end.`);
  const n0 = items.length;
  const sift = (start: number, n: number): void => {
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let big = i;
      if (l < n && items[l].value > items[big].value) big = l;
      if (r < n && items[r].value > items[big].value) big = r;
      if (big === i) return;
      shot(`Sift down at index ${i}: child ${items[big].value} beats parent ${items[i].value} — swap.`, { hl: [items[i].id, items[big].id] });
      [items[i], items[big]] = [items[big], items[i]];
      i = big;
    }
  };
  for (let i = (n0 >> 1) - 1; i >= 0; i--) sift(i, n0);
  shot(`Build-heap done: every parent ≥ its children, so the MAXIMUM ${items[0].value} sits at index 0.`, { hl: [items[0].id] });
  for (let end = n0 - 1; end > 0; end--) {
    shot(`Swap the max ${items[0].value} into its FINAL slot, index ${end}.`, { hl: [items[0].id, items[end].id], bad: [items[0].id] });
    [items[0], items[end]] = [items[end], items[0]];
    done.push(items[end].id);
    shot(`${items[end].value} is final. Repair the heap on the remaining ${end} element${end === 1 ? "" : "s"}.`);
    sift(0, end);
  }
  done.push(items[0].id);
  shot(`Heap exhausted — array sorted in place, O(n log n) worst case with no extra memory.`);
  return frames;
}

// ---------- searching ----------

export function searchLinear(d: { items: ListNode[] }, value: number): Frame[] {
  const items = clone(d.items);
  if (items.length === 0) return [snap(arrData(items), `The array is empty.`, { bad: [] })];
  const frames = [snap(arrData(items), `LINEAR SEARCH for ${value}: check every element left to right — works on ANY array, sorted or not.`, {})];
  for (let i = 0; i < items.length; i++) {
    if (items[i].value === value) {
      frames.push(snap(arrData(items), `items[${i}] = ${value} — found after ${i + 1} check${i === 0 ? "" : "s"}.`, { hl: [items[i].id], ok: [items[i].id] }));
      return frames;
    }
    frames.push(snap(arrData(items), `items[${i}] = ${items[i].value} ≠ ${value} — keep going.`, { hl: [items[i].id] }));
  }
  frames.push(snap(arrData(items), `Scanned all ${items.length} elements — ${value} is not here. That's the O(n) worst case.`, { bad: [] }));
  return frames;
}

export function searchBinary(d: { items: ListNode[] }, value: number): Frame[] {
  const items = clone(d.items);
  if (items.length === 0) return [snap(arrData(items), `The array is empty.`, { bad: [] })];
  if (!items.every((n, i) => i === 0 || items[i - 1].value <= n.value)) {
    return [snap(arrData(items), `BINARY SEARCH needs a SORTED array — run one of the sorts first!`, { bad: [] })];
  }
  const frames = [snap(arrData(items), `BINARY SEARCH for ${value}: the array is sorted, so each comparison throws away HALF the remaining range.`, {})];
  let lo = 0;
  let hi = items.length - 1;
  let steps = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    steps++;
    const range = items.slice(lo, hi + 1).map((n) => n.id);
    if (items[mid].value === value) {
      frames.push(snap(arrData(items), `mid = ${mid}: items[${mid}] = ${value} — FOUND in ${steps} step${steps === 1 ? "" : "s"} (a linear scan could have needed ${items.length}).`, { hl: range, ok: [items[mid].id] }));
      return frames;
    }
    if (items[mid].value < value) {
      frames.push(snap(arrData(items), `Range [${lo}..${hi}], middle items[${mid}] = ${items[mid].value} < ${value} — discard the LEFT half.`, { hl: range, bad: [items[mid].id] }));
      lo = mid + 1;
    } else {
      frames.push(snap(arrData(items), `Range [${lo}..${hi}], middle items[${mid}] = ${items[mid].value} > ${value} — discard the RIGHT half.`, { hl: range, bad: [items[mid].id] }));
      hi = mid - 1;
    }
  }
  frames.push(snap(arrData(items), `The range shrank to nothing — ${value} is not here, decided in only ${steps} step${steps === 1 ? "" : "s"}: O(log n).`, { bad: [] }));
  return frames;
}
