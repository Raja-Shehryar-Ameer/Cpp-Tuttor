import { useState } from "react";
import { requestTrace } from "./api/client";
import { Controls } from "./components/Controls";
import { EditorPane } from "./components/EditorPane";
import { StdoutPane } from "./components/StdoutPane";
import { MemoryDiagram } from "./components/diagram/MemoryDiagram";
import { usePlayback } from "./hooks/usePlayback";
import { useTraceStore } from "./store/traceStore";

const STARTER = `#include <iostream>

int main() {
    int x = 10;
    int y = 20;
    int* p = &x;
    *p = 15;
    p = &y;
    std::cout << "x = " << x << "\\n";
    return 0;
}
`;

export default function App() {
  const [code, setCode] = useState(STARTER);
  const [stdin, setStdin] = useState("");
  const trace = useTraceStore((s) => s.trace);
  const loading = useTraceStore((s) => s.loading);
  const requestError = useTraceStore((s) => s.requestError);
  const { setTrace, setLoading, setRequestError } = useTraceStore();
  usePlayback();

  const visualize = async () => {
    setLoading(true);
    setRequestError(null);
    try {
      setTrace(await requestTrace(code, stdin));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>
          CppTutor <span className="tagline">step-by-step C++ visualizer</span>
        </h1>
        <div className="header-actions">
          {trace === null ? (
            <button className="primary" onClick={visualize} disabled={loading}>
              {loading ? "Tracing…" : "Visualize ▶"}
            </button>
          ) : (
            <button onClick={() => setTrace(null)}>✎ Edit code</button>
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
