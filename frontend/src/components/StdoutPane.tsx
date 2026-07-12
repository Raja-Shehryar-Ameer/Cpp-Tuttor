import { Check, CircleAlert, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import { useCurrentStep, useTraceStore } from "../store/traceStore";
import { notify } from "../store/toastStore";

export function StdoutPane() {
  const step = useCurrentStep();
  const trace = useTraceStore((s) => s.trace);
  const currentStep = useTraceStore((s) => s.currentStep);
  const atLastStep = trace !== null && currentStep === trace.steps.length - 1;
  const output = step?.stdout ?? "";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.error("The browser blocked clipboard access — select the output and copy manually.");
    }
  };

  return (
    <div className="stdout-pane">
      <div className="stdout-head">
        <h3>
          <Terminal size={12} aria-hidden="true" />
          Output
        </h3>
        <button
          className="stdout-copy"
          onClick={copy}
          disabled={output.length === 0}
          title={copied ? "Copied" : "Copy output"}
          aria-label="Copy output to clipboard"
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{output}</pre>
      {trace?.error && atLastStep && (
        <div className="program-error">
          <CircleAlert size={15} aria-hidden="true" />
          {trace.error}
        </div>
      )}
    </div>
  );
}
