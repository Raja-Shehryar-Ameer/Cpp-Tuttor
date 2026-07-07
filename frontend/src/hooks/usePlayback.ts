import { useEffect } from "react";
import { useTraceStore } from "../store/traceStore";

/** Timer-driven autoplay: advances one step per tick while playing. */
export function usePlayback(): void {
  const playing = useTraceStore((s) => s.playing);
  const speedMs = useTraceStore((s) => s.speedMs);
  const stepForward = useTraceStore((s) => s.stepForward);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(stepForward, speedMs);
    return () => window.clearInterval(timer);
  }, [playing, speedMs, stepForward]);
}
