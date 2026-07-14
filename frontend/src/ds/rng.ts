// Seeded PRNG + quiz-randomization helpers shared by every predict-mode
// generator. Generators stay pure: they take an Rng parameter, so the fuzz
// suite can pass a fixed seed and reproduce any failure, while the labs pass
// a fresh unseeded Rng per run so questions differ every session.

import type { Quiz } from "./engine.ts";

export interface Rng {
  /** the seed this stream started from — printed by fuzz failures */
  seed: number;
  /** uniform in [0, 1) */
  next(): number;
  /** uniform integer in 0..n-1 */
  int(n: number): number;
  pick<T>(xs: T[]): T;
  /** Fisher–Yates on a copy — never mutates the input */
  shuffle<T>(xs: T[]): T[];
}

/** mulberry32 — tiny, fast, and plenty for shuffling quiz choices. */
export function makeRng(seed?: number): Rng {
  const s0 = (seed ?? (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
  let a = s0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    seed: s0,
    next,
    int,
    pick: <T>(xs: T[]): T => xs[int(xs.length)],
    shuffle: <T>(xs: T[]): T[] => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** Shuffle a quiz's choices and remap the answer index to follow. */
export function shuffleQuiz(quiz: Quiz, rng: Rng): Quiz {
  const order = rng.shuffle(quiz.choices.map((_, i) => i));
  return {
    ...quiz,
    choices: order.map((i) => quiz.choices[i]),
    answer: order.indexOf(quiz.answer),
  };
}

/** Build a 4-way numeric choice set around an integer answer: three unique
    distractors drawn from answer±1..3 (clamped ≥ 0), shuffled together with
    the answer. Returns null when fewer than 2 unique choices survive — the
    caller must skip the question rather than emit a degenerate quiz. */
export function numericChoices(answer: number, rng: Rng): { choices: string[]; answer: number } | null {
  const pool = new Set<number>();
  for (const d of [-3, -2, -1, 1, 2, 3]) {
    const v = answer + d;
    if (v >= 0 && v !== answer) pool.add(v);
  }
  const distractors = rng.shuffle([...pool]).slice(0, 3);
  if (distractors.length < 1) return null;
  const choices = rng.shuffle([answer, ...distractors]).map(String);
  return { choices, answer: choices.indexOf(String(answer)) };
}

/** Pick one candidate, preferring a kind different from the previous pick so
    the same question type only repeats back-to-back when it's the only kind
    available at this gate. */
export function pickVaried<T extends { kind: string }>(candidates: T[], lastKind: string | null, rng: Rng): T {
  const fresh = candidates.filter((c) => c.kind !== lastKind);
  return rng.pick(fresh.length > 0 ? fresh : candidates);
}
