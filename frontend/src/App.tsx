import {
  Check,
  CircleAlert,
  GitFork,
  Link2,
  MemoryStick,
  Moon,
  Pencil,
  Play,
  Shapes,
  SquareCode,
  Sun,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { fetchSharedTrace, requestTrace } from "./api/client";
import { Controls } from "./components/Controls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StdoutPane } from "./components/StdoutPane";
import { ToastHost } from "./components/Toast";
import { MemoryDiagram } from "./components/diagram/MemoryDiagram";
import { usePlayback } from "./hooks/usePlayback";
import { SAMPLES } from "./samples";
import { notify } from "./store/toastStore";
import { useTraceStore } from "./store/traceStore";
import { validateTracerSource } from "./validation";

// Code-split the heavy corners: CodeMirror only loads for the tracer, the
// lesson engine only for the playground — first paint pays for neither.
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((m) => ({ default: m.EditorPane })),
);
const DSPage = lazy(() => import("./components/ds/DSPage").then((m) => ({ default: m.DSPage })));
const ForkPage = lazy(() => import("./fork/ForkPage").then((m) => ({ default: m.ForkPage })));

const DEFAULT_SAMPLE = "pointers — swap via pointers";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("cpptutor-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updatePermalink(traceId: string | null): void {
  const url = new URL(window.location.href);
  if (traceId) url.searchParams.set("t", traceId);
  else url.searchParams.delete("t");
  window.history.replaceState(null, "", url);
}

export default function App() {
  const [mode, setMode] = useState<"code" | "ds" | "fork">("code");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [code, setCode] = useState(SAMPLES[DEFAULT_SAMPLE]);
  const [stdin, setStdin] = useState("");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const trace = useTraceStore((s) => s.trace);
  const loading = useTraceStore((s) => s.loading);
  const requestError = useTraceStore((s) => s.requestError);
  const { setTrace, setLoading, setRequestError } = useTraceStore();
  usePlayback();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cpptutor-theme", theme);
  }, [theme]);

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
      .catch((error: Error) => {
        useTraceStore.getState().setRequestError(error.message);
        notify.error(error.message);
      });
  }, []);

  const visualize = async () => {
    // Catch the obvious problems here — instant feedback instead of a
    // compile-in-Docker round-trip that ends the same way.
    const check = validateTracerSource(code);
    if (check.errors.length > 0) {
      check.errors.forEach((m) => notify.error(m));
      return;
    }
    check.warnings.forEach((m) => notify.warning(m));

    setLoading(true);
    setRequestError(null);
    try {
      const result = await requestTrace(code, stdin);
      setTrace(result.trace);
      setTraceId(result.traceId);
      updatePermalink(result.traceId);
      if (result.trace.status === "ok") {
        notify.success(`Trace ready — ${result.trace.steps.length} step${result.trace.steps.length === 1 ? "" : "s"}.`);
      } else if (result.trace.steps.length > 0) {
        // Partial trace (crash, timeout, step limit): playable, but say why.
        notify.warning(result.trace.error ?? `Trace ended early (${result.trace.status}).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      setRequestError(message);
      notify.error(message);
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
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      notify.success("Share link copied to the clipboard.");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.error("The browser blocked clipboard access — copy the address bar URL instead.");
    }
  };

  return (
    <div className="app">
      <ToastHost />
      <header>
        <h1>
          <span className="logo-mark">
            <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
              <rect x="2" y="2" width="60" height="60" rx="12" fill="#1f8a54" stroke="#2a2924" strokeWidth="4" />
              <g transform="matrix(0.84 0 0 0.84 5.12 3.4)">
                <rect x="12" y="38" width="14" height="14" rx="3.5" fill="#ffffff" />
                <rect x="38" y="38" width="14" height="14" rx="3.5" fill="none" stroke="#ffffff" strokeWidth="3.5" />
                <path d="M 19 38 C 19 12, 45 12, 45 29" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
                <path d="M 40.5 28.5 L 45 35.5 L 49.5 28.5 Z" fill="#ffffff" />
              </g>
            </svg>
          </span>
          Shinso <span className="tagline">step-by-step C++ visualizer</span>
        </h1>
        <nav className="main-nav" aria-label="mode">
          <button className={mode === "code" ? "active" : ""} onClick={() => setMode("code")}>
            <SquareCode size={14} aria-hidden="true" /> Tracer
          </button>
          <button className={mode === "ds" ? "active" : ""} onClick={() => setMode("ds")}>
            <Shapes size={14} aria-hidden="true" /> DS &amp; Algorithms
          </button>
          <button className={mode === "fork" ? "active" : ""} onClick={() => setMode("fork")}>
            <GitFork size={14} aria-hidden="true" /> C fork()
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-btn theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "switch to light theme" : "switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
          </button>
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
      <ErrorBoundary>
        <Suspense fallback={<div className="pane-loading">loading…</div>}>
          {mode === "ds" ? (
            <DSPage />
          ) : mode === "fork" ? (
            <ForkPage theme={theme} />
          ) : (
            <>
              <main>
                <section className="editor-pane">
                  <Suspense fallback={<div className="pane-loading">loading editor…</div>}>
                    <EditorPane code={code} onChange={setCode} theme={theme} />
                  </Suspense>
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
                  {trace === null ? (
                    <div className="diagram-empty">
                      <span className="empty-icon">
                        <MemoryStick size={22} aria-hidden="true" />
                      </span>
                      <h2>Watch your program think</h2>
                      <p>
                        Press Visualize and step through every call, variable, and pointer —
                        the stack and heap drawn like a textbook diagram.
                      </p>
                    </div>
                  ) : (
                    <MemoryDiagram />
                  )}
                </section>
              </main>
              <footer>
                <Controls />
                <StdoutPane />
              </footer>
            </>
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
