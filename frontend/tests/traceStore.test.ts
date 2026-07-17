// Tests for the trace player store: step clamping, autoplay stop, heapIds
// wiring. Drives the zustand store directly via getState() — no React.
// Run: node --experimental-strip-types frontend/tests/traceStore.test.ts

import { useTraceStore } from "../src/store/traceStore.ts";
import type { Step, Trace } from "../src/types/trace.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const eq = (got: unknown, want: unknown, label: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(label, { got, want });
};

const step = (heapAddrs: string[] = []): Step => ({
  line: 1,
  event: "step",
  functionName: "main",
  stdout: "",
  stack: [],
  heap: heapAddrs.map((address) => ({
    address,
    label: "obj",
    kind: "struct" as const,
    elements: [],
    freed: false,
  })),
});

const trace = (steps: Step[]): Trace => ({
  version: 1,
  language: "cpp",
  status: "ok",
  error: null,
  sourceCode: "int main(){}",
  steps,
});

const store = () => useTraceStore.getState();

// --- setTrace resets player state and computes heapIds ----------------------

useTraceStore.setState({ currentStep: 3, playing: true, requestError: "old" });
store().setTrace(trace([step(["0xa"]), step(["0xa", "0xb"])]));
eq(store().currentStep, 0, "setTrace resets currentStep");
eq(store().playing, false, "setTrace stops playback");
eq(store().requestError, null, "setTrace clears requestError");
eq(store().heapIds.length, 2, "heapIds computed per step");
eq(store().heapIds[1].get("0xb"), "H2", "heapIds numbered by first appearance");

// --- setStep clamps both ends ----------------------------------------------

store().setStep(-5);
eq(store().currentStep, 0, "setStep clamps below zero");
store().setStep(999);
eq(store().currentStep, 1, "setStep clamps to last step");
store().setStep(Number.MAX_SAFE_INTEGER);
eq(store().currentStep, 1, "End-key jump clamps to last step");

// --- stepForward stops playback exactly at the end --------------------------

store().setStep(0);
store().setPlaying(true);
store().stepForward();
eq(store().currentStep, 1, "stepForward advances");
eq(store().playing, false, "stepForward at last step stops playback");
store().stepForward();
eq(store().currentStep, 1, "stepForward at end stays put");

// --- stepBack clamps at zero ------------------------------------------------

store().setStep(0);
store().stepBack();
eq(store().currentStep, 0, "stepBack at start stays put");

// --- empty / cleared trace wedge cases --------------------------------------

store().setTrace(null);
eq(store().heapIds.length, 0, "null trace clears heapIds");
store().setStep(5);
eq(store().currentStep, 0, "setStep with no trace clamps to 0");
store().stepForward();
eq(store().currentStep, 0, "stepForward with no trace stays at 0");

store().setTrace(trace([]));
store().setStep(7);
eq(store().currentStep, 0, "zero-step trace clamps to 0");
eq(store().heapIds[store().currentStep] ?? null, null, "out-of-range heapIds is absent (hook falls back to empty map)");

if (fails === 0) {
  console.log("ALL PASS (traceStore clamping + heapIds wiring)");
  process.exit(0);
}
console.error(`${fails} failure(s)`);
process.exit(1);
