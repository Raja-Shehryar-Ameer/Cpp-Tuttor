// Page replacement engine: one pure simulation shared by every algorithm so
// the frames×references grid, live annotations, and fault counters always
// agree. Pure logic — the lab component owns all rendering.
//
// Conventions (stated in the UI too):
//  - References are numbered #0, #1, #2… like array indices.
//  - Free frames fill lowest-index first (Clock parks pages wherever its hand is).
//  - LFU breaks frequency ties by evicting the page loaded earliest (FIFO).
//  - Optimal breaks "never needed again" ties by the lowest frame index.

export type PageAlgo = "fifo" | "lru" | "opt" | "clock" | "lfu";

export interface PageAlgoMeta {
  key: PageAlgo;
  label: string;
  short: string;
  blurb: string;
}

export const PAGE_ALGOS: PageAlgoMeta[] = [
  { key: "fifo", label: "FIFO (First In First Out)", short: "FIFO",
    blurb: "Evicts whichever page has been in memory longest — a plain queue. Simple, but blind: it throws out hot pages, and more frames can even mean MORE faults (Belady's anomaly)." },
  { key: "lru", label: "LRU (Least Recently Used)", short: "LRU",
    blurb: "Evicts the page untouched for the longest time, betting the recent past predicts the near future. The standard answer — and a stack algorithm, so more frames never hurt." },
  { key: "opt", label: "Optimal (Belady's OPT)", short: "OPT",
    blurb: "Evicts the page whose NEXT use is farthest away — it reads the future, so no real OS can run it. It exists as the lower bound every other algorithm is graded against." },
  { key: "clock", label: "Clock (Second Chance)", short: "Clock",
    blurb: "FIFO with mercy: a hand sweeps the frames, and a page with its use bit set gets the bit cleared and one more lap instead of dying. LRU-ish behavior at FIFO cost." },
  { key: "lfu", label: "LFU (Least Frequently Used)", short: "LFU",
    blurb: "Evicts the page with the fewest total references. Great at pinning a hot page — terrible when an old page's stale count keeps it alive forever." },
];

export interface PageStep {
  i: number; // index into refs
  page: number;
  hit: boolean;
  /** frame slot touched this step — where the hit landed or the page loaded */
  slot: number;
  /** page evicted this step, if any */
  victim: number | null;
  /** frame contents AFTER this reference (null = still free) */
  frames: (number | null)[];
  /** per-slot annotation for the live panel, in the algorithm's vocabulary */
  info: string[];
  /** clock only: hand position AFTER this step */
  hand?: number;
  faultsSoFar: number;
  hitsSoFar: number;
  note: string;
}

export interface PageRun {
  algo: PageAlgo;
  frameCount: number;
  refs: number[];
  steps: PageStep[];
  faults: number;
  hits: number;
  hitRatio: number; // 0..1
}

export const MAX_REFS = 30;
export const MAX_FRAMES = 8;
export const MAX_PAGE = 99;

interface Slot {
  page: number | null;
  loadedAt: number; // ref index when loaded — FIFO order
  lastUsed: number; // ref index of last touch — LRU order
  freq: number; // total references — LFU order
  use: 0 | 1; // clock's second-chance bit
}

export function pageReplace(algo: PageAlgo, refs: number[], frameCount: number): PageRun {
  const slots: Slot[] = Array.from({ length: frameCount }, () => ({
    page: null, loadedAt: -1, lastUsed: -1, freq: 0, use: 0,
  }));
  let hand = 0;
  let faults = 0;
  let hits = 0;
  const steps: PageStep[] = [];

  const nextUse = (page: number, after: number): number | null => {
    for (let k = after + 1; k < refs.length; k += 1) if (refs[k] === page) return k;
    return null;
  };

  /** Why this slot's page lost its frame — one clause, in the algorithm's own vocabulary. */
  const victimReason = (s: Slot, i: number): string => {
    switch (algo) {
      case "fifo": return `in memory longest (loaded at #${s.loadedAt})`;
      case "lru": return `least recently used (last touched at #${s.lastUsed})`;
      case "lfu": return `least frequently used (${s.freq}× total)`;
      case "opt": {
        const nu = nextUse(s.page!, i);
        return nu === null ? "never needed again" : `not needed until #${nu} — the farthest away`;
      }
      case "clock": return "use bit already 0 when the hand reached it";
    }
  };

  refs.forEach((page, i) => {
    let hit = false;
    let slot: number;
    let victim: number | null = null;
    let note: string;

    const found = slots.findIndex((s) => s.page === page);
    if (found >= 0) {
      hit = true;
      hits += 1;
      slot = found;
      const s = slots[found];
      s.lastUsed = i;
      s.freq += 1;
      s.use = 1;
      const extra =
        algo === "lru" ? " — its recency refreshes" :
        algo === "lfu" ? ` — its count rises to ${s.freq}×` :
        algo === "clock" ? " — its use bit is set back to 1" :
        algo === "fifo" ? " — FIFO doesn't care; queue position unchanged" :
        "";
      note = `#${i}: page ${page} is already in frame ${found} — HIT${extra}.`;
    } else {
      faults += 1;
      if (algo === "clock") {
        // Sweep from the hand: set bits get one more lap, a clear bit dies.
        const sweep: string[] = [];
        for (;;) {
          const s = slots[hand];
          if (s.page === null || s.use === 0) break;
          s.use = 0;
          sweep.push(`page ${s.page} gets a second chance (use bit → 0)`);
          hand = (hand + 1) % frameCount;
        }
        slot = hand;
        victim = slots[slot].page;
        hand = (slot + 1) % frameCount;
        const swept = sweep.length > 0 ? `hand sweeps: ${sweep.join("; ")}; then ` : "";
        note = victim === null
          ? `#${i}: page ${page} faults — ${swept}the hand parks it in free frame ${slot}.`
          : `#${i}: page ${page} faults — ${swept}page ${victim} in frame ${slot} has use bit 0 → evicted.`;
      } else {
        const empty = slots.findIndex((s) => s.page === null);
        if (empty >= 0) {
          slot = empty;
          note = `#${i}: page ${page} faults — frame ${empty} is still free, so it just loads.`;
        } else {
          let v = 0;
          for (let k = 1; k < frameCount; k += 1) {
            const a = slots[k];
            const b = slots[v];
            let better: boolean;
            switch (algo) {
              case "fifo": better = a.loadedAt < b.loadedAt; break;
              case "lru": better = a.lastUsed < b.lastUsed; break;
              case "lfu": better = a.freq !== b.freq ? a.freq < b.freq : a.loadedAt < b.loadedAt; break;
              default: { // opt — strictly-farther wins, so "never again" ties keep the lowest slot
                const na = nextUse(a.page!, i) ?? Infinity;
                const nb = nextUse(b.page!, i) ?? Infinity;
                better = na > nb;
              }
            }
            if (better) v = k;
          }
          slot = v;
          victim = slots[v].page;
          note = `#${i}: page ${page} faults — evict page ${victim} from frame ${v}: ${victimReason(slots[v], i)}.`;
        }
      }
      const s = slots[slot];
      s.page = page;
      s.loadedAt = i;
      s.lastUsed = i;
      s.freq = 1;
      s.use = 1;
    }

    const info = slots.map((s) => {
      if (s.page === null) return "free";
      switch (algo) {
        case "fifo": return `in since #${s.loadedAt}`;
        case "lru": return `used #${s.lastUsed}`;
        case "lfu": return `${s.freq}×`;
        case "clock": return `use=${s.use}`;
        case "opt": {
          const nu = nextUse(s.page, i);
          return nu === null ? "never again" : `next #${nu}`;
        }
      }
    });

    steps.push({
      i, page, hit, slot, victim,
      frames: slots.map((s) => s.page),
      info,
      ...(algo === "clock" ? { hand } : {}),
      faultsSoFar: faults,
      hitsSoFar: hits,
      note,
    });
  });

  return {
    algo, frameCount, refs, steps, faults, hits,
    hitRatio: refs.length > 0 ? hits / refs.length : 0,
  };
}

/** Classroom presets — each one exists to provoke a specific exam question. */
export const PAGE_PRESETS: { name: string; hint: string; refs: number[]; frames: number }[] = [
  {
    name: "Belady's anomaly",
    hint: "Run FIFO at 3 frames (9 faults), then at 4 frames — faults RISE to 10. The frames sweep in Compare shows the whole curve.",
    refs: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5],
    frames: 3,
  },
  {
    name: "Textbook classic",
    hint: "The Silberschatz reference string at 3 frames — OPT scores 9 faults, LRU 12, FIFO 15. Verify with Compare all.",
    refs: [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1],
    frames: 3,
  },
  {
    name: "Loop one page too big",
    hint: "A 4-page loop over 3 frames: LRU and FIFO fault on EVERY reference — only OPT keeps its head.",
    refs: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4],
    frames: 3,
  },
  {
    name: "Hot page",
    hint: "Page 7 is touched constantly — watch FIFO evict it anyway, then run LFU and see its count pin it in place.",
    refs: [7, 1, 7, 2, 7, 3, 7, 4, 7, 5, 7, 6],
    frames: 3,
  },
  {
    name: "Locality burst",
    hint: "A tight working set that shifts once — LRU rides the locality; compare its faults against FIFO's.",
    refs: [1, 2, 3, 1, 2, 1, 3, 2, 4, 5, 4, 5, 6, 4, 5],
    frames: 3,
  },
];
