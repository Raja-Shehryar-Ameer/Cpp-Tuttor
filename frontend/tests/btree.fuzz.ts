// Fuzz suite for the B-tree / B+ tree engine.
// Run: node --experimental-strip-types frontend/tests/btree.fuzz.ts
//
// Model: a sorted set of numbers. After every operation the final frame's
// tree must satisfy ALL structural invariants and contain exactly the model.

import type { BNode, Frame } from "../src/ds/engine.ts";
import { btInsert, btRemove, btSearch, emptyBTree, type BTree } from "../src/ds/btree.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const rand = (n: number): number => Math.floor(Math.random() * n);
const isLeaf = (n: BNode): boolean => n.children.length === 0;

function leafValues(n: BNode | null): number[] {
  if (!n) return [];
  if (isLeaf(n)) return n.keys.map((k) => k.value);
  return n.children.flatMap(leafValues);
}

function inorder(n: BNode | null): number[] {
  if (!n) return [];
  if (isLeaf(n)) return n.keys.map((k) => k.value);
  const out: number[] = [];
  n.keys.forEach((k, i) => {
    out.push(...inorder(n.children[i]), k.value);
  });
  out.push(...inorder(n.children[n.children.length - 1]));
  return out;
}

function checkTree(tag: string, d: BTree, model: Set<number>): void {
  const { root, order, plus } = d;
  const minInternal = Math.ceil(order / 2) - 1;
  const minLeafKeys = plus ? Math.ceil((order - 1) / 2) : minInternal;
  const M = order - 1;

  const sorted = [...model].sort((a, b) => a - b);
  const live = plus ? leafValues(root) : inorder(root);
  if (JSON.stringify(live) !== JSON.stringify(sorted)) {
    fail(`${tag}: live values != model`, live, sorted);
    return;
  }

  if (!root) return;
  // uniform leaf depth + key/children counts + local sortedness + routing.
  // (For B-trees, live==sorted-model above already proves global ordering;
  // for B+ we additionally verify every separator routes correctly.)
  const depths = new Set<number>();
  const walk = (n: BNode, depth: number): void => {
    if (n.keys.length > M) fail(`${tag}: node over max keys`, n.keys.length, M);
    if (n !== root) {
      const need = isLeaf(n) ? minLeafKeys : minInternal;
      if (n.keys.length < need) fail(`${tag}: node under min keys`, n.keys.map((k) => k.value), need, { order, plus });
    } else if (n.keys.length < 1) {
      fail(`${tag}: root has zero keys but exists`);
    }
    if (!isLeaf(n) && n.children.length !== n.keys.length + 1) {
      fail(`${tag}: children != keys+1`, n.keys.length, n.children.length);
    }
    for (let k = 1; k < n.keys.length; k += 1) {
      if (n.keys[k - 1].value >= n.keys[k].value) fail(`${tag}: keys not strictly sorted`, n.keys.map((x) => x.value));
    }
    if (plus && !isLeaf(n)) {
      n.keys.forEach((sep, i) => {
        const leftMax = Math.max(...leafValues(n.children[i]));
        const rightMin = Math.min(...leafValues(n.children[i + 1]));
        if (!(leftMax < sep.value && rightMin >= sep.value)) {
          fail(`${tag}: separator misroutes`, sep.value, { leftMax, rightMin });
        }
      });
    }
    if (isLeaf(n)) {
      depths.add(depth);
      return;
    }
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  if (depths.size !== 1) fail(`${tag}: leaves at different depths`, [...depths]);
}

function checkFrames(tag: string, frames: Frame[]): void {
  for (const f of frames) {
    if (f.data.kind !== "btree") { fail(`${tag}: wrong frame kind`); return; }
    const ids: number[] = [];
    const collect = (n: BNode | null): void => {
      if (!n) return;
      ids.push(n.id, ...n.keys.map((k) => k.id));
      n.children.forEach(collect);
    };
    collect(f.data.root);
    if (new Set(ids).size !== ids.length) { fail(`${tag}: duplicate ids in one frame`, f.note); return; }
    const idSet = new Set(ids);
    for (const bag of [f.hl, f.ok ?? [], f.bad ?? []]) {
      for (const id of bag) if (!idSet.has(id)) { fail(`${tag}: frame highlights unknown id`, id, f.note); return; }
    }
  }
}

const last = (frames: Frame[], d: BTree): BTree =>
  (frames.length > 0 ? (frames[frames.length - 1].data as BTree) : d);

const TRIALS = 250;
const OPS = 200;

for (const order of [3, 4, 5]) {
  for (const plus of [false, true]) {
    for (let t = 0; t < TRIALS / 5; t += 1) {
      let d = emptyBTree(order, plus);
      const model = new Set<number>();
      const tag = `order ${order} ${plus ? "B+" : "B"}`;
      for (let op = 0; op < OPS; op += 1) {
        const roll = Math.random();
        const pool = 1 + rand(40); // small domain → plenty of dup hits and deep deletes
        if (roll < 0.55 && model.size < 24) {
          const frames = btInsert(d, pool);
          checkFrames(`${tag} insert`, frames);
          d = last(frames, d);
          if (!model.has(pool) && model.size < 24) model.add(pool);
          checkTree(`${tag} after insert ${pool}`, d, model);
        } else if (roll < 0.9) {
          // delete: half the time an existing value, half a missing one
          const existing = [...model];
          const v = Math.random() < 0.5 && existing.length > 0 ? existing[rand(existing.length)] : pool + 100;
          const frames = btRemove(d, v);
          checkFrames(`${tag} remove`, frames);
          d = last(frames, d);
          model.delete(v);
          checkTree(`${tag} after remove ${v}`, d, model);
        } else {
          const v = Math.random() < 0.5 && model.size > 0 ? [...model][rand(model.size)] : pool + 100;
          const frames = btSearch(d, v);
          checkFrames(`${tag} search`, frames);
          const lastNote = frames[frames.length - 1].note;
          const verdict = lastNote.startsWith("Found");
          if (verdict !== model.has(v)) fail(`${tag}: search verdict wrong`, v, verdict, [...model]);
        }
      }
      // drain the tree completely — exercises root collapse + deep merges
      for (const v of [...model]) {
        const frames = btRemove(d, v);
        checkFrames(`${tag} drain`, frames);
        d = last(frames, d);
        model.delete(v);
        checkTree(`${tag} drain ${v}`, d, model);
      }
      if (d.root !== null) fail(`${tag}: tree not empty after draining`);
    }
  }
}

// deterministic: sorted 1..15 insert at order 3 must stay uniform-depth and sorted
{
  for (const plus of [false, true]) {
    let d = emptyBTree(3, plus);
    const model = new Set<number>();
    for (let v = 1; v <= 15; v += 1) {
      d = last(btInsert(d, v), d);
      model.add(v);
      checkTree(`sorted-insert ${plus ? "B+" : "B"}`, d, model);
    }
  }
}

console.log(fails === 0 ? `ALL PASS (${TRIALS / 5} trials x 6 configs x ${OPS} ops + full drains)` : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
