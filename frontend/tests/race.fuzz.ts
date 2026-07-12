// Fuzz suite for sorting op counters (race mode).
// Run: node --experimental-strip-types frontend/tests/race.fuzz.ts
//
// Invariants per sort × random arrays:
//  - stats are monotone nondecreasing across frames;
//  - the FINAL stats equal an independently instrumented reference of the
//    same algorithm with the same counting conventions;
//  - the final array is sorted and its ids are a permutation of the input's.

import {
  arrayPush,
  sortBubble,
  sortHeap,
  sortInsertion,
  sortMerge,
  sortQuick,
  sortSelection,
  type Frame,
  type ListNode,
} from "../src/ds/engine.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const rand = (n: number): number => Math.floor(Math.random() * n);

type Stats = { comparisons: number; swaps: number };

// ---- independent references (same counting conventions as the engine) ----

function refBubble(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  for (let end = a.length - 1; end > 0; end--) {
    let swapped = false;
    for (let j = 0; j < end; j++) {
      s.comparisons++;
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
        s.swaps++;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return s;
}

function refInsertion(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  for (let i = 1; i < a.length; i++) {
    let j = i;
    while (j > 0) {
      s.comparisons++;
      if (!(a[j - 1] > a[j])) break;
      [a[j - 1], a[j]] = [a[j], a[j - 1]];
      s.swaps++;
      j--;
    }
  }
  return s;
}

function refSelection(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  for (let i = 0; i < a.length - 1; i++) {
    let min = i;
    for (let j = i + 1; j < a.length; j++) {
      s.comparisons++;
      if (a[j] < a[min]) min = j;
    }
    if (min !== i) {
      [a[i], a[min]] = [a[min], a[i]];
      s.swaps++;
    }
  }
  return s;
}

function refQuick(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  const part = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const pivot = a[hi];
    let i = lo;
    for (let j = lo; j < hi; j++) {
      s.comparisons++;
      if (a[j] < pivot) {
        if (i !== j) {
          [a[i], a[j]] = [a[j], a[i]];
          s.swaps++;
        }
        i++;
      }
    }
    if (i !== hi) s.swaps++;
    [a[i], a[hi]] = [a[hi], a[i]];
    part(lo, i - 1);
    part(i + 1, hi);
  };
  part(0, a.length - 1);
  return s;
}

function refMerge(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  const rec = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    rec(lo, mid);
    rec(mid + 1, hi);
    let i = lo;
    let m = mid;
    let j = mid + 1;
    while (i <= m && j <= hi) {
      s.comparisons++;
      if (a[i] <= a[j]) i++;
      else {
        const [moved] = a.splice(j, 1);
        a.splice(i, 0, moved);
        s.swaps++;
        i++;
        m++;
        j++;
      }
    }
  };
  rec(0, a.length - 1);
  return s;
}

function refHeap(a: number[]): Stats {
  const s = { comparisons: 0, swaps: 0 };
  const n0 = a.length;
  const sift = (start: number, n: number): void => {
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let big = i;
      if (l < n) {
        s.comparisons++;
        if (a[l] > a[big]) big = l;
      }
      if (r < n) {
        s.comparisons++;
        if (a[r] > a[big]) big = r;
      }
      if (big === i) return;
      [a[i], a[big]] = [a[big], a[i]];
      s.swaps++;
      i = big;
    }
  };
  for (let i = (n0 >> 1) - 1; i >= 0; i--) sift(i, n0);
  for (let end = n0 - 1; end > 0; end--) {
    [a[0], a[end]] = [a[end], a[0]];
    s.swaps++;
    sift(0, end);
  }
  return s;
}

const SORTS: [string, (d: { items: ListNode[] }) => Frame[], (a: number[]) => Stats][] = [
  ["bubble", sortBubble, refBubble],
  ["insertion", sortInsertion, refInsertion],
  ["selection", sortSelection, refSelection],
  ["quick", sortQuick, refQuick],
  ["merge", sortMerge, refMerge],
  ["heap", sortHeap, refHeap],
];

for (let t = 0; t < 400; t += 1) {
  const n = 2 + rand(15);
  const values = Array.from({ length: n }, () => rand(60));
  // build via the real op so ids come from the engine allocator
  let d: { items: ListNode[] } = { items: [] };
  for (const v of values) {
    const frames = arrayPush(d, v);
    d = frames[frames.length - 1].data as { items: ListNode[] };
  }
  const inputIds = d.items.map((x) => x.id).sort((a, b) => a - b);

  for (const [name, sort, ref] of SORTS) {
    const frames = sort(d);
    // monotone stats
    let prev = { comparisons: 0, swaps: 0 };
    for (const f of frames) {
      if (!f.stats) { fails += 1; console.error("FAIL:", name, "frame missing stats", f.note); break; }
      if (f.stats.comparisons < prev.comparisons || f.stats.swaps < prev.swaps) {
        fail(`${name}: stats went backwards`, prev, f.stats);
        break;
      }
      prev = f.stats;
    }
    const final = frames[frames.length - 1];
    const want = ref([...values]);
    if (final.stats!.comparisons !== want.comparisons || final.stats!.swaps !== want.swaps) {
      fail(`${name}: final stats != reference`, final.stats, want, values);
    }
    const out = (final.data as { items: ListNode[] }).items;
    for (let k = 1; k < out.length; k += 1) {
      if (out[k - 1].value > out[k].value) { fail(`${name}: output not sorted`, out.map((x) => x.value)); break; }
    }
    const outIds = out.map((x) => x.id).sort((a, b) => a - b);
    if (JSON.stringify(outIds) !== JSON.stringify(inputIds)) fail(`${name}: ids not a permutation`);
  }
}

console.log(fails === 0 ? "ALL PASS (400 arrays x 6 sorts)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
