import { Check, Copy, GitFork, Play, Server, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
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

const NODE_W = 158;
const NODE_VGAP = 116;
const COL_GAP = 26;

interface Placed {
  node: ProcNode;
  cx: number; // centre x
  y: number; // top y
}

// Tidy tree layout: leaves are packed left-to-right, each parent centres over
// its children. Returns absolute positions plus the total canvas size.
function layout(processes: ProcNode[]): { placed: Placed[]; width: number; height: number; topPad: number } {
  const byId = new Map(processes.map((p) => [p.id, p]));
  const pos = new Map<number, { cx: number; y: number }>();
  const hasOrphans = processes.some((p) => p.reparented);
  const topPad = hasOrphans ? NODE_VGAP : 0; // room for the systemd row
  let cursor = 0;

  const place = (id: number, depth: number): number => {
    const node = byId.get(id)!;
    const kids = node.childIds.filter((c) => byId.has(c));
    let cx: number;
    if (kids.length === 0) {
      cx = cursor + NODE_W / 2;
      cursor += NODE_W + COL_GAP;
    } else {
      const centres = kids.map((k) => place(k, depth + 1));
      cx = (centres[0] + centres[centres.length - 1]) / 2;
    }
    pos.set(id, { cx, y: topPad + depth * NODE_VGAP });
    return cx;
  };
  const roots = processes.filter((p) => p.parentId === null);
  roots.forEach((r) => place(r.id, 0));

  const placed = processes.map((node) => ({ node, cx: pos.get(node.id)!.cx, y: pos.get(node.id)!.y }));
  const maxDepth = Math.max(...placed.map((p) => p.y));
  const width = Math.max(cursor - COL_GAP, NODE_W) + 20;
  return { placed, width: width + 20, height: maxDepth + 88 + topPad, topPad };
}

function ProcessTree({ processes }: { processes: ProcNode[] }) {
  const { placed, width, height, topPad } = useMemo(() => layout(processes), [processes]);
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const systemdX = width / 2;
  const systemdY = 10;
  // Draw the dashed reparent links only when there are a few — past that they
  // criss-cross the whole tree; the per-node "orphan → systemd" badges and the
  // note still convey the adoption.
  const orphanCount = placed.filter((p) => p.node.reparented).length;
  const showOrphanEdges = orphanCount > 0 && orphanCount <= 4;

  return (
    <div className="fork-canvas" style={{ minWidth: width, minHeight: height }}>
      <svg className="fork-edges" width={width} height={height} aria-hidden="true">
        {placed.map((p) =>
          p.node.childIds
            .filter((c) => byId.has(c))
            .map((c) => {
              const kid = byId.get(c)!;
              const x1 = p.cx;
              const y1 = p.y + 62;
              const x2 = kid.cx;
              const y2 = kid.y;
              const my = (y1 + y2) / 2;
              return (
                <path
                  key={`${p.node.id}-${c}`}
                  className="fork-edge"
                  d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                />
              );
            }),
        )}
        {topPad > 0 &&
          showOrphanEdges &&
          placed
            .filter((p) => p.node.reparented)
            .map((p) => (
              <path
                key={`sd-${p.node.id}`}
                className="fork-edge orphan"
                d={`M ${systemdX} ${systemdY + 30} C ${systemdX} ${(systemdY + p.y) / 2}, ${p.cx} ${(systemdY + p.y) / 2}, ${p.cx} ${p.y}`}
              />
            ))}
      </svg>

      {topPad > 0 && (
        <div className="proc-node systemd" style={{ left: systemdX - NODE_W / 2, top: systemdY }}>
          <div className="proc-head">
            <Server size={13} aria-hidden="true" />
            <span className="proc-label">systemd</span>
            <span className="proc-pid">PID 1</span>
          </div>
          <div className="proc-sub">init — adopts orphaned children</div>
        </div>
      )}

      {placed.map((p) => {
        const n = p.node;
        return (
          <div
            key={n.id}
            className={`proc-node${n.reparented ? " orphaned" : ""}`}
            style={{ left: p.cx - NODE_W / 2, top: p.y }}
          >
            <div className="proc-head">
              <GitFork size={13} aria-hidden="true" />
              <span className="proc-label">{n.label}</span>
              <span className="proc-pid">pid {n.pid}</span>
            </div>
            {n.output ? (
              <pre className="proc-out">{n.output.replace(/\n$/, "")}</pre>
            ) : (
              <div className="proc-sub">no output</div>
            )}
            <div className="proc-foot">
              {n.reparented && <span className="proc-badge orphan">orphan → systemd</span>}
              <span className="proc-exit">exit {n.exitStatus ?? 0}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ForkPage() {
  const [source, setSource] = useState(SAMPLE);
  const [result, setResult] = useState(() => simulateFork(SAMPLE));
  const [copied, setCopied] = useState(false);

  const run = () => setResult(simulateFork(source));
  const copyOut = async () => {
    try {
      await navigator.clipboard.writeText(result.output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
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
          <div className="fork-scroll">
            <ProcessTree processes={result.processes} />
          </div>
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
