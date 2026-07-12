import { Check, Copy, GitFork, Play, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { notify } from "../store/toastStore";
import { validateForkSource } from "../validation";
import { simulateFork, type ProcNode } from "./vm";

const SAMPLE = `#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("start\\n");
    int pid = fork();
    if (pid == 0) {
        printf("child says hi\\n");
    } else {
        wait(NULL);
        printf("parent reaped child\\n");
    }
    fork();                 // both processes fork once more
    printf("done\\n");
    return 0;
}
`;

// Same visual language as the DS playground trees: r=21 circles, mono labels,
// plain edges. A process is just "P<n>" — everything else lives in tooltips
// and the output panel, exactly like a BST node is just its key.
const R = 21;
const H_PITCH = 64; // min centre-to-centre gap between leaf circles
const V_GAP = 88; // vertical distance between generations
const PAD = 30;

interface Placed {
  node: ProcNode;
  x: number;
  y: number;
}

// Tidy tree layout: leaves packed left-to-right, each parent centred over its
// children (identical approach to the playground's BST renderer).
function layout(processes: ProcNode[]): { placed: Placed[]; width: number; height: number } {
  const byId = new Map(processes.map((p) => [p.id, p]));
  const pos = new Map<number, { x: number; y: number }>();
  let cursor = PAD;

  const place = (id: number, depth: number): number => {
    const node = byId.get(id)!;
    const kids = node.childIds.filter((c) => byId.has(c));
    let x: number;
    if (kids.length === 0) {
      x = cursor;
      cursor += H_PITCH;
    } else {
      const centres = kids.map((k) => place(k, depth + 1));
      x = (centres[0] + centres[centres.length - 1]) / 2;
    }
    pos.set(id, { x, y: PAD + depth * V_GAP });
    return x;
  };
  processes.filter((p) => p.parentId === null).forEach((r) => place(r.id, 0));

  const placed = processes.map((node) => ({ node, ...pos.get(node.id)! }));
  const maxY = Math.max(...placed.map((p) => p.y), PAD);
  return { placed, width: Math.max(cursor - H_PITCH + PAD * 2, 260), height: maxY + R + PAD };
}

// Orphans and zombies are the states exam questions probe, so they get loud
// contrasting fills (same semantic palette as the playground: amber = watch
// this, red = trouble) rather than subtle dashes.
function nodeClass(n: ProcNode): string {
  if (n.zombie) return "ds-circle fork-zombie";
  if (n.reparented) return "ds-circle fork-orphan";
  return "ds-circle";
}

function ProcessTree({ processes }: { processes: ProcNode[] }) {
  const { placed, width, height } = useMemo(() => layout(processes), [processes]);
  const byId = new Map(placed.map((p) => [p.node.id, p]));

  return (
    <svg className="fork-tree" width={width} height={height} role="img" aria-label="process tree">
      {placed.map((p) =>
        p.node.childIds
          .filter((c) => byId.has(c))
          .map((c) => {
            const kid = byId.get(c)!;
            return <line key={`${p.node.id}-${c}`} className="ds-edge" x1={p.x} y1={p.y} x2={kid.x} y2={kid.y} />;
          }),
      )}
      {placed.map((p) => (
        <g key={p.node.id} className="ds-node" transform={`translate(${p.x}, ${p.y})`}>
          <title>
            {`${p.node.label} — pid ${p.node.pid}` +
              (p.node.zombie ? "\nZOMBIE: exited before its parent, never reaped by wait()" : "") +
              (p.node.reparented ? "\nORPHAN: outlived its parent → adopted by systemd (PID 1)" : "") +
              (p.node.output ? `\nprints:\n${p.node.output.replace(/\n$/, "")}` : "\nprints nothing")}
          </title>
          <circle className={nodeClass(p.node)} r={R} />
          <text className="ds-value" dy="4">
            {p.node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ForkPage() {
  const [source, setSource] = useState(SAMPLE);
  const [result, setResult] = useState(() => simulateFork(SAMPLE));
  const [copied, setCopied] = useState(false);

  const run = () => {
    const check = validateForkSource(source);
    if (check.errors.length > 0) {
      check.errors.forEach((m) => notify.error(m));
      return; // keep the previous tree on screen instead of blanking it
    }
    check.warnings.forEach((m) => notify.warning(m));

    const next = simulateFork(source);
    setResult(next);
    if (next.error) {
      notify.error(`Couldn't parse the program — ${next.error}.`);
    } else {
      const zombies = next.processes.filter((p) => p.zombie).length;
      const orphans = next.processes.filter((p) => p.reparented).length;
      const extras = [zombies > 0 && `${zombies} zombie${zombies > 1 ? "s" : ""}`, orphans > 0 && `${orphans} orphan${orphans > 1 ? "s" : ""}`]
        .filter(Boolean)
        .join(", ");
      const n = next.processes.length;
      notify.success(`${n} process${n === 1 ? "" : "es"}${extras ? ` — ${extras}` : ""}.`);
    }
  };

  const copyOut = async () => {
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.error("The browser blocked clipboard access — select the output and copy manually.");
    }
  };

  return (
    <main className="fork-main">
      <section className="editor-pane">
        <textarea
          className="fork-editor"
          spellCheck={false}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="C source using fork()"
        />
        <div className="fork-run-row">
          <button className="primary" onClick={run}>
            <Play size={14} aria-hidden="true" /> Build process tree
          </button>
          <span className="fork-count">
            {result.error ? "—" : `${result.processes.length} process${result.processes.length === 1 ? "" : "es"}`}
          </span>
        </div>
      </section>

      <section className="fork-view">
        <div className="region-header">
          <GitFork size={13} aria-hidden="true" />
          <span>Process tree</span>
          <span className="grow-hint">P0 = main</span>
        </div>

        {result.error ? (
          <div className="fork-error">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{result.error}</span>
          </div>
        ) : (
          <>
            {(result.processes.some((p) => p.reparented) || result.processes.some((p) => p.zombie)) && (
              <div className="fork-legend">
                {result.processes.some((p) => p.reparented) && (
                  <span className="legend-item">
                    <span className="legend-dot orphan" /> orphan — adopted by systemd
                  </span>
                )}
                {result.processes.some((p) => p.zombie) && (
                  <span className="legend-item">
                    <span className="legend-dot zombie" /> zombie — never reaped
                  </span>
                )}
              </div>
            )}
            <div className="fork-scroll">
              <ProcessTree processes={result.processes} />
            </div>
          </>
        )}

        <div className="fork-bottom">
          <div className="stdout-head">
            <h3>Output — one valid ordering</h3>
            <button className="stdout-copy" onClick={copyOut} disabled={!result.output}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="fork-output">{result.output}</pre>
          {result.notes.map((note, i) => (
            <p className="fork-note" key={i}>
              {note}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
