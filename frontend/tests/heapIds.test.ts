// Tests for the stable H1/H2/… heap reference ids.
// Run: node --experimental-strip-types frontend/tests/heapIds.test.ts
//
// Two layers:
//  1. hand-derived scenarios — first-appearance numbering, cross-step
//     stability, freed objects keeping their badge, allocator address reuse
//     minting a fresh id;
//  2. a seeded fuzzer over random alloc/free/reuse sequences with structural
//     invariants (ids unique per step, numbering monotone by first
//     appearance, an id never changes while its object is continuously live).

import { computeHeapIds } from "../src/utils/heapIds.ts";
import type { Step } from "../src/types/trace.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const eq = (got: unknown, want: unknown, label: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(label, { got, want });
};
const ok = (cond: boolean, label: string, ...ctx: unknown[]) => {
  if (!cond) fail(label, ...ctx);
};

/** Build a Step holding only what computeHeapIds reads: the heap list. */
const step = (...heap: { address: string; freed?: boolean }[]): Step => ({
  line: 1,
  event: "step",
  functionName: "main",
  stdout: "",
  stack: [],
  heap: heap.map((h) => ({
    address: h.address,
    label: "obj",
    kind: "struct" as const,
    elements: [],
    freed: h.freed ?? false,
  })),
});

const idsOf = (maps: ReadonlyMap<string, string>[], i: number): Record<string, string> =>
  Object.fromEntries([...maps[i].entries()].sort());

// --- empty cases -----------------------------------------------------------

eq(computeHeapIds([]).length, 0, "empty trace: no maps");
eq(idsOf(computeHeapIds([step()]), 0), {}, "empty heap: empty map");

// --- first-appearance ordering --------------------------------------------

{
  const maps = computeHeapIds([step({ address: "0xa" }), step({ address: "0xa" }, { address: "0xb" })]);
  eq(idsOf(maps, 0), { "0xa": "H1" }, "first object is H1");
  eq(idsOf(maps, 1), { "0xa": "H1", "0xb": "H2" }, "second allocation is H2");
}

// Numbering follows FIRST appearance, not the per-step array order of later steps.
{
  const maps = computeHeapIds([
    step({ address: "0xa" }),
    step({ address: "0xb" }, { address: "0xa" }),
  ]);
  eq(idsOf(maps, 1), { "0xa": "H1", "0xb": "H2" }, "reordered step keeps first-seen numbering");
}

// --- stability across steps ------------------------------------------------

{
  const steps = Array.from({ length: 6 }, () => step({ address: "0xa" }, { address: "0xb" }));
  const maps = computeHeapIds(steps);
  for (let i = 0; i < steps.length; i += 1) {
    eq(idsOf(maps, i), { "0xa": "H1", "0xb": "H2" }, `ids stable at step ${i}`);
  }
}

// --- freed objects keep their id (dangling-pointer display) ----------------

{
  const maps = computeHeapIds([
    step({ address: "0xa" }),
    step({ address: "0xa", freed: true }),
  ]);
  eq(idsOf(maps, 1), { "0xa": "H1" }, "freed object keeps its badge");
}

// --- allocator address reuse mints a fresh id ------------------------------

{
  const maps = computeHeapIds([
    step({ address: "0xa" }, { address: "0xb" }),
    step({ address: "0xa", freed: true }, { address: "0xb" }),
    step({ address: "0xb" }), // 0xa gone (unreferenced)
    step({ address: "0xb" }, { address: "0xa" }), // same address, NEW allocation
  ]);
  eq(idsOf(maps, 1), { "0xa": "H1", "0xb": "H2" }, "freed keeps id pre-reuse");
  eq(idsOf(maps, 2), { "0xb": "H2" }, "absent address absent from map");
  eq(idsOf(maps, 3), { "0xa": "H3", "0xb": "H2" }, "reused address gets fresh id");
}

// An address freed and reused within consecutive steps (never absent).
{
  const maps = computeHeapIds([
    step({ address: "0xa", freed: true }),
    step({ address: "0xa" }),
  ]);
  eq(idsOf(maps, 0), { "0xa": "H1" }, "starts freed: still badged");
  eq(idsOf(maps, 1), { "0xa": "H2" }, "un-freed reappearance is a new object");
}

// --- fuzzer ----------------------------------------------------------------

const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? Date.now() % 2147483647);
console.log(`fuzz seed: ${FUZZ_SEED} (reproduce with FUZZ_SEED=${FUZZ_SEED})`);
const makeRand = (seed: number) => {
  let s = seed || 1;
  return () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646;
};

for (let run = 0; run < 200; run += 1) {
  const rand = makeRand(FUZZ_SEED + run);
  const addresses = ["0x1", "0x2", "0x3", "0x4"];
  // live: address currently allocated; freedShown: freed but still displayed
  const live = new Set<string>();
  const freedShown = new Set<string>();
  const steps: Step[] = [];
  const stepCount = 2 + Math.floor(rand() * 10);
  for (let i = 0; i < stepCount; i += 1) {
    const addr = addresses[Math.floor(rand() * addresses.length)];
    const action = rand();
    if (action < 0.45) {
      live.add(addr);
      freedShown.delete(addr);
    } else if (action < 0.75 && live.has(addr)) {
      live.delete(addr);
      if (rand() < 0.6) freedShown.add(addr); // dangling pointer keeps it visible
    } else if (freedShown.has(addr) && rand() < 0.5) {
      freedShown.delete(addr); // last reference dropped
    }
    steps.push(
      step(
        ...[...live].map((a) => ({ address: a })),
        ...[...freedShown].map((a) => ({ address: a, freed: true })),
      ),
    );
  }

  const maps = computeHeapIds(steps);
  eq(maps.length, steps.length, `run ${run}: one map per step`);
  const firstSeenOrder: string[] = [];
  const lastId = new Map<string, string>(); // address → id while continuously present
  for (let i = 0; i < steps.length; i += 1) {
    const map = maps[i];
    const seen = new Set<string>();
    for (const objAddr of steps[i].heap.map((h) => h.address)) {
      const id = map.get(objAddr);
      if (!id) {
        fail(`run ${run} step ${i}: object ${objAddr} has no id`);
        continue;
      }
      ok(!seen.has(id), `run ${run} step ${i}: id ${id} unique within step`);
      seen.add(id);
      if (!firstSeenOrder.includes(id)) firstSeenOrder.push(id);
      const prev = lastId.get(objAddr);
      const wasPresent = i > 0 && maps[i - 1].has(objAddr);
      if (wasPresent && prev !== undefined) {
        // continuously present: id may only change across a freed→fresh boundary
        const prevFreed = steps[i - 1].heap.find((h) => h.address === objAddr)?.freed;
        const nowFreed = steps[i].heap.find((h) => h.address === objAddr)?.freed;
        if (!(prevFreed && !nowFreed)) {
          eq(id, prev, `run ${run} step ${i}: id stable for live ${objAddr}`);
        }
      }
      lastId.set(objAddr, id);
    }
    for (const addr of [...lastId.keys()]) if (!map.has(addr)) lastId.delete(addr);
  }
  // numbering is monotone in first appearance: H1, H2, H3, …
  firstSeenOrder.forEach((id, index) => {
    eq(id, `H${index + 1}`, `run ${run}: monotone numbering`);
  });
  // idempotence
  const again = computeHeapIds(steps);
  eq(
    maps.map((m) => [...m.entries()].sort()),
    again.map((m) => [...m.entries()].sort()),
    `run ${run}: idempotent`,
  );
}

if (fails === 0) {
  console.log("ALL PASS (heapIds scenarios + 200 fuzzed traces)");
  process.exit(0);
}
console.error(`${fails} failure(s)`);
process.exit(1);
