import { CircleAlert, Terminal } from "lucide-react";
import { useCurrentStep, useTraceStore } from "../store/traceStore";

export function StdoutPane() {
  const step = useCurrentStep();
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);
  const atLastStep = trace !== null && currentStep === trace.steps.length - 1;
  return (
    <div className="stdout-pane">
      <h3>
        <Terminal size={12} aria-hidden="true" />
        Output
      </h3>
      <pre>{step?.stdout ?? ""}</pre>
      {trace?.error && atLastStep && (
        <div className="program-error">
          <CircleAlert size={15} aria-hidden="true" />
          {trace.error}
        </div>
      )}
    </div>
  );
}
