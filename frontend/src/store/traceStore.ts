import { create } from "zustand";
import type { Step, Trace } from "../types/trace";

interface TraceState {
  trace: Trace | null;
  currentStep: number;
  playing: boolean;
  speedMs: number;
  loading: boolean;
  requestError: string | null;
  setTrace: (trace: Trace | null) => void;
  setStep: (step: number) => void;
  stepForward: () => void;
  stepBack: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeedMs: (ms: number) => void;
  setLoading: (loading: boolean) => void;
  setRequestError: (message: string | null) => void;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export const useTraceStore = create<TraceState>((set) => ({
  trace: null,
  currentStep: 0,
  playing: false,
  speedMs: 800,
  loading: false,
  requestError: null,
  setTrace: (trace) => set({ trace, currentStep: 0, playing: false, requestError: null }),
  setStep: (step) =>
    set((s) => ({ currentStep: clamp(step, (s.trace?.steps.length ?? 1) - 1) })),
  stepForward: () =>
    set((s) => {
      const last = (s.trace?.steps.length ?? 1) - 1;
      const next = clamp(s.currentStep + 1, last);
      return { currentStep: next, playing: s.playing && next < last };
    }),
  stepBack: () => set((s) => ({ currentStep: clamp(s.currentStep - 1, (s.trace?.steps.length ?? 1) - 1) })),
  setPlaying: (playing) => set({ playing }),
  setSpeedMs: (speedMs) => set({ speedMs }),
  setLoading: (loading) => set({ loading }),
  setRequestError: (requestError) => set({ requestError }),
}));

export function useCurrentStep(): Step | null {
  return useTraceStore((s) => s.trace?.steps[s.currentStep] ?? null);
}
