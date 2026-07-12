// B-tree / B+ tree engine: insert, search, and FULL delete (borrow + merge)
// for both variants, at max degree (order) 3, 4, or 5. Every operation
// returns narrated Frames; snapshots are only taken in structurally
// consistent states (never mid-split), so the FLIP animation always has a
// complete tree to draw.
//
// Conventions (stated in the UI too):
//  - order m = max children; a node holds at most m−1 keys.
//  - Non-root minimums: internal ⌈m/2⌉−1 keys; B+ leaves ⌈(m−1)/2⌉ keys.
//  - B-tree: keys live everywhere; delete swaps an internal key with its
//    in-order predecessor, then deletes from the leaf.
//  - B+ tree: values live ONLY in leaves; internal keys are separator COPIES
//    (fresh ids) — child i holds keys < sep[i], child i+1 holds keys ≥ sep[i].
//  - Duplicates are rejected.

// Extension kept explicit so `node --experimental-strip-types` can run the
// fuzz suites against this module directly.
import { allocId, type BNode, type DSData, type Frame, type ListNode } from "./engine.ts";

export type BTree = Extract<DSData, { kind: "btree" }>;

export const BT_ORDERS = [3, 4, 5];
export const MAX_BTREE_KEYS = 24;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const isLeaf = (n: BNode): boolean => n.children.length === 0;
const keyList = (n: BNode): string => `[${n.keys.map((k) => k.value).join(" ")}]`;

export const emptyBTree = (order: number, plus: boolean): BTree => ({ kind: "btree", root: null, order, plus });

/** Live values: every key in a B-tree; leaf keys only in a B+ tree. */
function countValues(root: BNode | null, plus: boolean): number {
  if (!root) return 0;
  const own = !plus || isLeaf(root) ? root.keys.length : 0;
  return own + root.children.reduce((s, c) => s + countValues(c, plus), 0);
}

const minInternal = (order: number): number => Math.ceil(order / 2) - 1;
const minLeaf = (order: number, plus: boolean): number => (plus ? Math.ceil((order - 1) / 2) : minInternal(order));

// ---------- insert ----------

export function btInsert(d0: BTree, v: number): Frame[] {
  const d = clone(d0);
  const frames: Frame[] = [];
  const emit = (note: string, extra: Partial<Frame> = {}) => frames.push({ data: clone(d), hl: [], note, ...extra });
  const M = d.order - 1;

  if (countValues(d.root, d.plus) >= MAX_BTREE_KEYS) {
    emit(`The tree holds ${MAX_BTREE_KEYS} values — enough to read; delete something first.`, { bad: [] });
    return frames;
  }
  if (!d.root) {
    const k: ListNode = { id: allocId(), value: v };
    d.root = { id: allocId(), keys: [k], children: [] };
    emit(`The tree was empty — ${v} becomes the root${d.plus ? " (which is also a leaf, where B+ keeps all values)" : ""}.`, { ok: [k.id] });
    return frames;
  }

  interface Split { up: ListNode; right: BNode; copied: boolean }
  let duplicate = false;

  /** Split an overfull node; caller wires the pieces before the next emit. */
  const split = (n: BNode): Split => {
    if (d.plus && isLeaf(n)) {
      const mid = Math.ceil(n.keys.length / 2);
      const right: BNode = { id: allocId(), keys: n.keys.slice(mid), children: [] };
      n.keys = n.keys.slice(0, mid);
      // B+ separators are copies — the value stays in its leaf.
      return { up: { id: allocId(), value: right.keys[0].value }, right, copied: true };
    }
    const mid = Math.floor(n.keys.length / 2);
    const up = n.keys[mid];
    const right: BNode = { id: allocId(), keys: n.keys.slice(mid + 1), children: n.children.slice(mid + 1) };
    n.keys = n.keys.slice(0, mid);
    if (n.children.length > 0) n.children = n.children.slice(0, mid + 1);
    return { up, right, copied: false };
  };

  const splitNote = (s: Split, into: string): string =>
    s.copied
      ? `Leaf overflows (${M + 1} > ${M} keys) — split it; a COPY of ${s.up.value} rises ${into} as the separator (the value itself stays in its leaf).`
      : `Node overflows (${M + 1} > ${M} keys) — split around the median ${s.up.value}, which moves up ${into}.`;

  const ins = (n: BNode): Split | null => {
    if (isLeaf(n)) {
      const dup = n.keys.find((k) => k.value === v);
      if (dup) {
        duplicate = true;
        emit(`${v} is already here — duplicates aren't allowed.`, { bad: [dup.id] });
        return null;
      }
      const k: ListNode = { id: allocId(), value: v };
      const i = n.keys.filter((x) => x.value < v).length;
      n.keys.splice(i, 0, k);
      emit(`${v} slots into the leaf in sorted position${n.keys.length > M ? " — but now it holds too many keys" : ""}.`, { ok: [k.id], hl: n.keys.map((x) => x.id) });
      return n.keys.length > M ? split(n) : null;
    }
    const dup = !d.plus && n.keys.find((k) => k.value === v);
    if (dup) {
      duplicate = true;
      emit(`${v} is already here — duplicates aren't allowed.`, { bad: [dup.id] });
      return null;
    }
    const i = n.keys.filter((k) => (d.plus ? v >= k.value : v > k.value)).length;
    const why = i === 0
      ? `${v} < ${n.keys[0].value}`
      : i === n.keys.length
        ? `${v} ${d.plus ? "≥" : ">"} ${n.keys[i - 1].value}`
        : `${n.keys[i - 1].value} ${d.plus ? "≤" : "<"} ${v} < ${n.keys[i].value}`;
    emit(`At ${keyList(n)}: ${why} → take child ${i + 1} of ${n.children.length}.`, { hl: n.keys.map((k) => k.id) });
    const s = ins(n.children[i]);
    if (!s) return null;
    n.keys.splice(i, 0, s.up);
    n.children.splice(i + 1, 0, s.right);
    emit(splitNote(s, `into ${keyList(n)}`), { ok: [s.up.id], hl: n.keys.map((k) => k.id) });
    return n.keys.length > M ? split(n) : null;
  };

  const s = ins(d.root);
  if (s) {
    d.root = { id: allocId(), keys: [s.up], children: [d.root, s.right] };
    emit(`${splitNote(s, "")} No parent existed, so ${s.up.value} becomes a NEW ROOT — the tree grows one level (B-trees only ever grow at the top).`, { ok: [s.up.id] });
  }
  if (!duplicate && frames.length > 0) {
    frames.push({ data: clone(d), hl: [], ok: [], note: `${v} is in. Every leaf still sits at the same depth — that's the B-tree promise.` });
  }
  return frames;
}

// ---------- search ----------

export function btSearch(d0: BTree, v: number): Frame[] {
  const d = clone(d0);
  const frames: Frame[] = [];
  const emit = (note: string, extra: Partial<Frame> = {}) => frames.push({ data: clone(d), hl: [], note, ...extra });
  if (!d.root) {
    emit("The tree is empty — nothing to search.", { bad: [] });
    return frames;
  }
  let n = d.root;
  for (;;) {
    if (!d.plus) {
      const hit = n.keys.find((k) => k.value === v);
      if (hit) {
        emit(`Found ${v} in ${keyList(n)}${isLeaf(n) ? " (a leaf)" : " — an internal node; B-trees store values everywhere"}.`, { ok: [hit.id] });
        return frames;
      }
    } else {
      const sep = !isLeaf(n) && n.keys.find((k) => k.value === v);
      if (sep) {
        emit(`${v} matches a separator in ${keyList(n)} — but B+ stores values ONLY in leaves, so keep descending right.`, { hl: [sep.id] });
      }
    }
    if (isLeaf(n)) {
      const hit = d.plus ? n.keys.find((k) => k.value === v) : undefined;
      if (hit) emit(`Found ${v} in its leaf — in a real B+ tree this is where the record pointer lives.`, { ok: [hit.id] });
      else emit(`Reached the leaf ${keyList(n)} without finding ${v} — it is not in the tree.`, { bad: n.keys.map((k) => k.id) });
      return frames;
    }
    const i = n.keys.filter((k) => (d.plus ? v >= k.value : v > k.value)).length;
    emit(`At ${keyList(n)}: descend to child ${i + 1} of ${n.children.length}.`, { hl: n.keys.map((k) => k.id) });
    n = n.children[i];
  }
}

// ---------- delete ----------

export function btRemove(d0: BTree, v: number): Frame[] {
  const d = clone(d0);
  const frames: Frame[] = [];
  const emit = (note: string, extra: Partial<Frame> = {}) => frames.push({ data: clone(d), hl: [], note, ...extra });
  if (!d.root) {
    emit("The tree is empty — nothing to delete.", { bad: [] });
    return frames;
  }
  const minOf = (n: BNode): number => (isLeaf(n) ? minLeaf(d.order, d.plus) : minInternal(d.order));

  /** Repair parent.children[i] which fell below its minimum. */
  const fill = (parent: BNode, i: number): void => {
    const child = parent.children[i];
    const left = i > 0 ? parent.children[i - 1] : null;
    const right = i < parent.children.length - 1 ? parent.children[i + 1] : null;

    if (left && left.keys.length > minOf(left)) {
      if (d.plus && isLeaf(child)) {
        const k = left.keys.pop()!;
        child.keys.unshift(k);
        parent.keys[i - 1] = { id: allocId(), value: k.value };
        emit(`${keyList(child)} is too empty — borrow from the LEFT sibling: ${k.value} slides over, and the separator updates to ${k.value}.`, { ok: [k.id] });
      } else {
        const sep = parent.keys[i - 1];
        const k = left.keys.pop()!;
        child.keys.unshift(sep);
        parent.keys[i - 1] = k;
        if (!isLeaf(left)) child.children.unshift(left.children.pop()!);
        emit(`${keyList(child)} is too empty — borrow through the parent: separator ${sep.value} drops down, ${k.value} rises from the left sibling to replace it.`, { ok: [sep.id, k.id] });
      }
      return;
    }
    if (right && right.keys.length > minOf(right)) {
      if (d.plus && isLeaf(child)) {
        const k = right.keys.shift()!;
        child.keys.push(k);
        parent.keys[i] = { id: allocId(), value: right.keys[0].value };
        emit(`${keyList(child)} is too empty — borrow from the RIGHT sibling: ${k.value} slides over, and the separator updates to ${right.keys[0].value}.`, { ok: [k.id] });
      } else {
        const sep = parent.keys[i];
        const k = right.keys.shift()!;
        child.keys.push(sep);
        parent.keys[i] = k;
        if (!isLeaf(right)) child.children.push(right.children.shift()!);
        emit(`${keyList(child)} is too empty — borrow through the parent: separator ${sep.value} drops down, ${k.value} rises from the right sibling to replace it.`, { ok: [sep.id, k.id] });
      }
      return;
    }
    // Neither sibling can spare a key — merge.
    const at = left ? i - 1 : i;
    const l = parent.children[at];
    const r = parent.children[at + 1];
    const sep = parent.keys[at];
    parent.keys.splice(at, 1);
    parent.children.splice(at + 1, 1);
    if (d.plus && isLeaf(l)) {
      l.keys.push(...r.keys);
      emit(`Neither sibling can spare a key — MERGE the two leaves; separator ${sep.value} is simply discarded (it was only a copy).`, { hl: l.keys.map((k) => k.id) });
    } else {
      l.keys.push(sep, ...r.keys);
      l.children.push(...r.children);
      emit(`Neither sibling can spare a key — MERGE: separator ${sep.value} comes down from the parent to glue the two nodes into one.`, { ok: [sep.id], hl: l.keys.map((k) => k.id) });
    }
  };

  /** Remove and return the rightmost key of this subtree (B-tree predecessor). */
  const takeMax = (n: BNode): ListNode => {
    if (isLeaf(n)) return n.keys.pop()!;
    const i = n.children.length - 1;
    const k = takeMax(n.children[i]);
    if (n.children[i].keys.length < minOf(n.children[i])) fill(n, i);
    return k;
  };

  const del = (n: BNode): boolean => {
    if (isLeaf(n)) {
      const idx = n.keys.findIndex((k) => k.value === v);
      if (idx < 0) {
        emit(`Reached the leaf ${keyList(n)} without finding ${v} — nothing to delete.`, { bad: n.keys.map((k) => k.id) });
        return false;
      }
      emit(`Found ${v} in its leaf — take it out.`, { bad: [n.keys[idx].id] });
      n.keys.splice(idx, 1);
      emit(`${v} is gone${n.keys.length < minOf(n) && n !== d.root ? " — but the leaf fell below its minimum, so it must borrow or merge" : ""}.`, { hl: n.keys.map((k) => k.id) });
      return true;
    }
    if (!d.plus) {
      const idx = n.keys.findIndex((k) => k.value === v);
      if (idx >= 0) {
        emit(`${v} lives in the INTERNAL node ${keyList(n)} — swap in its in-order predecessor from the left subtree, then fix up down there.`, { hl: [n.keys[idx].id] });
        const pred = takeMax(n.children[idx]);
        n.keys[idx] = pred;
        emit(`Predecessor ${pred.value} moves up to replace ${v}.`, { ok: [pred.id] });
        if (n.children[idx].keys.length < minOf(n.children[idx])) fill(n, idx);
        return true;
      }
    }
    const i = n.keys.filter((k) => (d.plus ? v >= k.value : v > k.value)).length;
    emit(`At ${keyList(n)}: descend to child ${i + 1} of ${n.children.length} looking for ${v}.`, { hl: n.keys.map((k) => k.id) });
    const found = del(n.children[i]);
    if (found && n.children[i].keys.length < minOf(n.children[i])) fill(n, i);
    return found;
  };

  const found = del(d.root);
  if (found && d.root) {
    if (d.root.keys.length === 0) {
      const oldRoot = d.root;
      d.root = isLeaf(oldRoot) ? null : oldRoot.children[0];
      emit(d.root === null
        ? `That was the last value — the tree is empty again.`
        : `The root ran out of keys — its only child becomes the new root; the tree SHRINKS one level (the mirror of how it grew).`);
    } else {
      emit(`${v} deleted. Every leaf still sits at the same depth.`, {});
    }
  }
  return frames;
}
