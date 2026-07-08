import { Braces, Check, CircleAlert, Link2, Pencil, Play, Shapes, SquareCode } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchSharedTrace, requestTrace } from "./api/client";
import { Controls } from "./components/Controls";
import { EditorPane } from "./components/EditorPane";
import { StdoutPane } from "./components/StdoutPane";
import { DSPage } from "./components/ds/DSPage";
import { MemoryDiagram } from "./components/diagram/MemoryDiagram";
import { usePlayback } from "./hooks/usePlayback";
import { SAMPLES } from "./samples";
import { useTraceStore } from "./store/traceStore";

const DEFAULT_SAMPLE = "pointers — swap via pointers";

function updatePermalink(traceId: string | null): void {
  const url = new URL(window.location.href);
  if (traceId) url.searchParams.set("t", traceId);
  else url.searchParams.delete("t");
  window.history.replaceState(null, "", url);
}

export default function App() {
  const [mode, setMode] = useState<"code" | "ds">("code");
  const [code, setCode] = useState(SAMPLES[DEFAULT_SAMPLE]);
  const [stdin, setStdin] = useState("");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const trace = useTraceStore((s) => s.trace);
  const loading = useTraceStore((s) => s.loading);
  const requestError = useTraceStore((s) => s.requestError);
  const { setTrace, setLoading, setRequestError } = useTraceStore();
  usePlayback();

  // Shared permalink: ?t=<id> loads a stored trace without re-running code.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("t");
    if (!shared) return;
    fetchSharedTrace(shared)
      .then((sharedTrace) => {
        useTraceStore.getState().setTrace(sharedTrace);
        setTraceId(shared);
        setCode(sharedTrace.sourceCode);
      })
      .catch((error: Error) => useTraceStore.getState().setRequestError(error.message));
  }, []);

  const visualize = async () => {
    setLoading(true);
    setRequestError(null);
    try {
      const result = await requestTrace(code, stdin);
      setTrace(result.trace);
      setTraceId(result.traceId);
      updatePermalink(result.traceId);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  const stopPlayback = () => {
    setTrace(null);
    setTraceId(null);
    setCopied(false);
    updatePermalink(null);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="app">
      <header>
        <h1>
          <span className="logo-mark">
            <Braces size={15} aria-hidden="true" />
          </span>
          CppTutor <span className="tagline">step-by-step C++ visualizer</span>
        </h1>
        <div className="header-actions">
          <div className="mode-switch" role="tablist" aria-label="mode">
            <button className={mode === "code" ? "active" : ""} onClick={() => setMode("code")}>
              <SquareCode size={13} aria-hidden="true" /> C++ Tracer
            </button>
            <button className={mode === "ds" ? "active" : ""} onClick={() => setMode("ds")}>
              <Shapes size={13} aria-hidden="true" /> Data Structures
            </button>
          </div>
          {mode === "code" && trace === null && (
            <select
              defaultValue={DEFAULT_SAMPLE}
              onChange={(e) => setCode(SAMPLES[e.target.value])}
              title="example gallery"
            >
              {Object.keys(SAMPLES).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          )}
          {mode === "code" &&
            (trace === null ? (
              <button className="primary" onClick={visualize} disabled={loading}>
                <Play size={14} aria-hidden="true" />
                {loading ? "Tracing…" : "Visualize"}
              </button>
            ) : (
              <>
                {traceId && (
                  <button onClick={copyLink}>
                    {copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                )}
                <button onClick={stopPlayback}>
                  <Pencil size={14} aria-hidden="true" />
                  Edit code
                </button>
              </>
            ))}
        </div>
      </header>
      {requestError && (
        <div className="request-error">
          <CircleAlert size={15} aria-hidden="true" />
          {requestError}
        </div>
      )}
      {trace && trace.status !== "ok" && trace.steps.length === 0 && (
        <div className="request-error">
          <CircleAlert size={15} aria-hidden="true" />
          {trace.error}
        </div>
      )}
      {mode === "ds" ? (
        <DSPage />
      ) : (
        <>
          <main>
            <section className="editor-pane">
              <EditorPane code={code} onChange={setCode} />
              {trace === null && (
                <textarea
                  className="stdin-box"
                  placeholder="stdin for the program (optional)"
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                />
              )}
            </section>
            <section className="diagram-pane">
              <MemoryDiagram />
            </section>
          </main>
          <footer>
            <Controls />
            <StdoutPane />
          </footer>
        </>
      )}
    </div>
  );
}
