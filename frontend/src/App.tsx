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
import { fetchSharedTrace, requestTrace, type TracerLanguage } from "./api/client";
import { Controls } from "./components/Controls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LangIcon } from "./components/LangIcon";
import { StdoutPane } from "./components/StdoutPane";
import { ToastHost } from "./components/Toast";
import { MemoryDiagram } from "./components/diagram/MemoryDiagram";
import { usePlayback } from "./hooks/usePlayback";
import { DEFAULT_SAMPLE, SAMPLES_BY_LANG } from "./samples";
import { notify } from "./store/toastStore";
import { useTraceStore } from "./store/traceStore";
import type { TraceStatus } from "./types/trace";
import { validateTracerSource } from "./validation";

// Code-split the heavy corners: CodeMirror only loads for the tracer, the
// lesson engine only for the playground — first paint pays for neither.
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((m) => ({ default: m.EditorPane })),
);
const DSPage = lazy(() => import("./components/ds/DSPage").then((m) => ({ default: m.DSPage })));
const ForkPage = lazy(() => import("./fork/ForkPage").then((m) => ({ default: m.ForkPage })));

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("cpptutor-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// One actionable next step per failure class, shown under the backend's message.
const STATUS_HINTS: Partial<Record<TraceStatus, string>> = {
  timeout: "If the program reads input, fill the stdin box before running; otherwise look for a loop whose exit condition can never become true.",
  step_limit: "Shrink the input or loop bounds — the visualizer plays the first steps only.",
};

function updatePermalink(traceId: string | null): void {
  const url = new URL(window.location.href);
  if (traceId) url.searchParams.set("t", traceId);
  else url.searchParams.delete("t");
  window.history.replaceState(null, "", url);
}

export default function App() {
  // A `?lab=` permalink opens the DS mode straight away (no code→ds flash);
  // DSPage owns decoding the payload. `?lab` and `?t` never coexist.
  const [mode, setMode] = useState<"code" | "ds" | "fork">(() =>
    new URLSearchParams(window.location.search).has("lab") ? "ds" : "code",
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [language, setLanguage] = useState<TracerLanguage>("cpp");
  const [code, setCode] = useState(SAMPLES_BY_LANG.cpp[DEFAULT_SAMPLE.cpp]);
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
  // A lab permalink takes precedence and is handled inside DSPage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("lab")) return;
    const shared = params.get("t");
    if (!shared) return;
    fetchSharedTrace(shared)
      .then((sharedTrace) => {
        useTraceStore.getState().setTrace(sharedTrace);
        setTraceId(shared);
        setCode(sharedTrace.sourceCode);
        // Traces stored before the language field default to the cpp editor.
        if (sharedTrace.language) setLanguage(sharedTrace.language);
      })
      .catch((error: Error) => {
        useTraceStore.getState().setRequestError(error.message);
        notify.error(error.message);
      });
  }, []);

  const switchLanguage = (lang: TracerLanguage) => {
    if (lang === language) return;
    setLanguage(lang);
    setCode(SAMPLES_BY_LANG[lang][DEFAULT_SAMPLE[lang]]);
  };

  const visualize = async () => {
    // Catch the obvious problems here — instant feedback instead of a
    // compile-in-Docker round-trip that ends the same way.
    const check = validateTracerSource(code, language);
    if (check.errors.length > 0) {
      notify.errors(check.errors);
      return;
    }
    if (new Blob([stdin]).size > 64 * 1024) {
      notify.errors(["The stdin box holds over 64 KB — trim the input to exam size."]);
      return;
    }
    notify.warnings(check.warnings);

    setLoading(true);
    setRequestError(null);
    try {
      const result = await requestTrace(code, stdin, language);
      setTrace(result.trace);
      setTraceId(result.traceId);
      updatePermalink(result.traceId);
      if (result.trace.status === "ok") {
        notify.success(`Trace ready — ${result.trace.steps.length} step${result.trace.steps.length === 1 ? "" : "s"}.`);
      } else if (result.trace.steps.length > 0) {
        // Partial trace (crash, timeout, step limit): playable, but say why.
        notify.warning(
          [result.trace.error ?? `Trace ended early (${result.trace.status}).`, STATUS_HINTS[result.trace.status]]
            .filter(Boolean)
            .join(" "),
        );
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
          Shinso <span className="tagline">the machine shows its work</span>
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
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
          </button>
          {mode === "code" && trace === null && (
            <>
              <div className="lang-seg" role="group" aria-label="language">
                <button
                  className={language === "cpp" ? "active" : ""}
                  onClick={() => switchLanguage("cpp")}
                >
                  <LangIcon language="cpp" /> C++
                </button>
                <button
                  className={language === "c" ? "active" : ""}
                  onClick={() => switchLanguage("c")}
                >
                  <LangIcon language="c" /> C
                </button>
                <button
                  className={language === "python" ? "active" : ""}
                  onClick={() => switchLanguage("python")}
                >
                  <LangIcon language="python" /> Py
                </button>
              </div>
              <select
                key={language}
                defaultValue={DEFAULT_SAMPLE[language]}
                onChange={(e) => setCode(SAMPLES_BY_LANG[language][e.target.value])}
                title="example gallery"
              >
                {Object.keys(SAMPLES_BY_LANG[language]).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </>
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
          <CircleAlert size={14} aria-hidden="true" />
          {requestError}
        </div>
      )}
      {trace && trace.status !== "ok" && trace.steps.length === 0 && (
        <div className="request-error">
          <CircleAlert size={14} aria-hidden="true" />
          <span>
            {trace.error}
            {STATUS_HINTS[trace.status] && <span className="error-hint"> {STATUS_HINTS[trace.status]}</span>}
          </span>
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
                    <EditorPane code={code} onChange={setCode} theme={theme} language={language} />
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
