import { useEffect, useState } from "react";
import { fetchSharedTrace, requestTrace } from "./api/client";
import { Controls } from "./components/Controls";
import { EditorPane } from "./components/EditorPane";
import { StdoutPane } from "./components/StdoutPane";
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
          CppTutor <span className="tagline">step-by-step C++ visualizer</span>
        </h1>
        <div className="header-actions">
          {trace === null && (
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
          {trace === null ? (
            <button className="primary" onClick={visualize} disabled={loading}>
              {loading ? "Tracing…" : "Visualize ▶"}
            </button>
          ) : (
            <>
              {traceId && (
                <button onClick={copyLink}>{copied ? "✓ copied" : "🔗 Copy link"}</button>
              )}
              <button onClick={stopPlayback}>✎ Edit code</button>
            </>
          )}
        </div>
      </header>
      {requestError && <div className="request-error">{requestError}</div>}
      {trace && trace.status !== "ok" && trace.steps.length === 0 && (
        <div className="request-error">{trace.error}</div>
      )}
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
    </div>
  );
}
