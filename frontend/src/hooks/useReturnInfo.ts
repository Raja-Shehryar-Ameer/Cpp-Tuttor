import type { Trace } from "../types/trace";

export interface ReturnInfo {
  /** the function whose frame just collapsed */
  functionName: string;
  /** value it handed back, when the caller stored it in a local (else null) */
  value: string | null;
  /** the caller local that received the value, for placing the bubble */
  intoLocal: string | null;
}

// On a "return" step the just-popped frame handed a value back to its caller.
// The schema carries no explicit return value, but it is reconstructable and
// never guessed: the ONE caller local that changed between the previous step
// and this one is exactly what the call evaluated to (factorial's `rest`,
// main's `result`, …). When the value is consumed inline (e.g.
// `return fib(n-1) + fib(n-2)`) no local changes, so we report the unwind
// without a number rather than inventing one.
export function computeReturnInfo(trace: Trace | null, index: number): ReturnInfo | null {
  if (!trace || index <= 0) return null;
  const cur = trace.steps[index];
  const prev = trace.steps[index - 1];
  if (!cur || !prev || cur.event !== "return") return null;

  const caller = cur.stack[0];
  const returnedFn = prev.stack[0]?.functionName ?? cur.functionName;
  if (!caller) return { functionName: returnedFn, value: null, intoLocal: null };

  const prevCaller = prev.stack.find((f) => f.frameId === caller.frameId);
  if (!prevCaller) return { functionName: returnedFn, value: null, intoLocal: null };

  // Prefer a local that went uninitialised → initialised; fall back to any
  // whose printed value changed.
  let becameSet: { name: string; value: string | null } | null = null;
  let changed: { name: string; value: string | null } | null = null;
  for (const local of caller.locals) {
    const before = prevCaller.locals.find((l) => l.name === local.name);
    if (!local.isInitialized) continue;
    if (!before || !before.isInitialized) {
      becameSet ??= { name: local.name, value: local.value };
    } else if (before.value !== local.value) {
      changed ??= { name: local.name, value: local.value };
    }
  }
  const hit = becameSet ?? changed;
  return { functionName: returnedFn, value: hit?.value ?? null, intoLocal: hit?.name ?? null };
}
