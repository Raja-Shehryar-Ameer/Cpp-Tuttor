// PNG export without dependencies.
//
// SVG scenes: clone the element and BAKE every visual computed style into
// attributes (this resolves CSS variables, the active theme, and — crucially —
// the GlideG `style.transform` translations that position every node), then
// rasterize via blob-URL → Image → canvas. Web fonts are fetched once and
// embedded as data-URI @font-face rules; any failure falls back silently to
// the system font stack.
//
// Gantt chart / paging grid: pure data, drawn by hand on a canvas. Colors are
// read live from the DOM (a hidden chip probe + CSS custom properties) so the
// stylesheet stays the single source of truth.

import type { DLRun } from "../ds/deadlock";
import { procName, RES_NAMES } from "../ds/deadlock";
import type { PageRun } from "../ds/paging";
import { PAGE_ALGOS } from "../ds/paging";
import type { ProcSpec, SchedRun } from "../ds/sched";
import { SCHED_ALGOS } from "../ds/sched";

const BAKE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "paint-order",
  "text-transform",
];

function bakeTree(orig: Element, copy: Element): void {
  if (copy instanceof SVGElement) {
    const cs = getComputedStyle(orig);
    for (const p of BAKE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "none" || p === "fill" || p === "stroke") copy.setAttribute(p, v);
    }
    if (cs.transform && cs.transform !== "none") copy.setAttribute("transform", cs.transform);
    if (cs.display === "none") copy.setAttribute("display", "none");
    copy.removeAttribute("style");
    copy.removeAttribute("class");
  }
  const oc = orig.children;
  const cc = copy.children;
  for (let i = 0; i < oc.length; i += 1) bakeTree(oc[i], cc[i]);
}

// ---- web font embedding (module-cached, silent fallback) ----

let fontCssCache: string | null | undefined;

async function fontCss(): Promise<string> {
  if (fontCssCache !== undefined) return fontCssCache ?? "";
  try {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')];
    let css = "";
    for (const link of links) css += await (await fetch(link.href)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
      css = css.split(u).join(`data:font/woff2;base64,${btoa(bin)}`);
    }
    fontCssCache = css;
  } catch {
    fontCssCache = null; // fonts stay whatever the system resolves — fine
  }
  return fontCssCache ?? "";
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}

/** Theme-resolved value of a CSS custom property. */
const cssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function svgToImage(svg: SVGSVGElement): Promise<{ img: HTMLImageElement; w: number; h: number }> {
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width > 0 ? vb.width : svg.clientWidth || 460;
  const h = vb && vb.height > 0 ? vb.height : svg.clientHeight || 240;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  bakeTree(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.style.maxWidth = "";
  const fonts = await fontCss();
  if (fonts) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fonts;
    clone.insertBefore(style, clone.firstChild);
  }
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg rasterization failed"));
      img.src = url;
    });
    return { img, w, h };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** Export one or more SVG scenes side by side as a PNG (2× scale). */
export async function exportSvgsPng(svgs: SVGSVGElement[], filename: string, scale = 2): Promise<void> {
  const shots = await Promise.all(svgs.map(svgToImage));
  const gap = svgs.length > 1 ? 28 : 0;
  const pad = 20;
  const w = shots.reduce((s, x) => s + x.w, 0) + gap * (shots.length - 1) + pad * 2;
  const h = Math.max(...shots.map((x) => x.h)) + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = cssVar("--panel") || "#ffffff";
  ctx.fillRect(0, 0, w, h);
  let x = pad;
  for (const { img, w: iw, h: ih } of shots) {
    ctx.drawImage(img, x, pad + (h - pad * 2 - ih) / 2, iw, ih);
    x += iw + gap;
  }
  downloadCanvas(canvas, filename);
}

// ---- hand-drawn exports (Gantt / paging grid) ----

/** Live colors of the process/page chip classes, read off a hidden probe. */
function chipColors(): { bg: string[]; idleText: string } {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const bg: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    probe.className = `proc-chip pc-${i}`;
    bg.push(getComputedStyle(probe).backgroundColor);
  }
  probe.className = "proc-chip gantt-idle";
  const idleText = getComputedStyle(probe).color;
  probe.remove();
  return { bg, idleText };
}

const MONO = `13px "JetBrains Mono", Consolas, monospace`;

export function drawGanttPng(run: SchedRun, procs: ProcSpec[], filename: string): void {
  const meta = SCHED_ALGOS.find((a) => a.key === run.algo)!;
  const { bg, idleText } = chipColors();
  const ink = cssVar("--ink");
  const panel = cssVar("--panel");
  const text = cssVar("--text");
  const muted = cssVar("--muted");
  const colorOf = (name: string): string => bg[procs.findIndex((p) => p.name === name) % 8];

  const unit = 42;
  const pad = 26;
  const barY = 52;
  const barH = 46;
  const scale = 2;
  const w = run.makespan * unit + pad * 2;
  const h = barY + barH + 56;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = text;
  ctx.font = `bold 15px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillText(
    `Gantt — ${meta.short}${meta.usesQuantum ? ` (q=${run.quantum})` : ""} · avg wait ${run.avgWaiting.toFixed(2)} · avg TAT ${run.avgTurnaround.toFixed(2)} · ${run.contextSwitches} ctx switches`,
    pad,
    30,
  );

  for (const s of run.slices) {
    const x = pad + s.start * unit;
    const sw = (s.end - s.start) * unit;
    if (s.name) {
      ctx.fillStyle = colorOf(s.name);
      ctx.fillRect(x, barY, sw, barH);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, barY, sw, barH);
      ctx.fillStyle = "#fffcf5";
      ctx.font = `bold ${MONO}`;
      ctx.textAlign = "center";
      if (sw >= 26) ctx.fillText(s.name, x + sw / 2, barY + barH / 2 + 5);
    } else {
      ctx.strokeStyle = muted;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 1, barY + 1, sw - 2, barH - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = idleText;
      ctx.font = MONO;
      ctx.textAlign = "center";
      if (sw >= 26) ctx.fillText("—", x + sw / 2, barY + barH / 2 + 5);
    }
  }
  ctx.fillStyle = muted;
  ctx.font = `11px "JetBrains Mono", monospace`;
  ctx.textAlign = "center";
  for (let t = 0; t <= run.makespan; t += 1) {
    if (unit >= 18 || t % 5 === 0 || t === run.makespan) ctx.fillText(String(t), pad + t * unit, barY + barH + 22);
  }
  downloadCanvas(canvas, filename);
}

export function drawBankerPng(run: DLRun, filename: string): void {
  const { bg } = chipColors();
  const ink = cssVar("--ink");
  const panel = cssVar("--panel");
  const panel2 = cssVar("--panel-2");
  const text = cssVar("--text");
  const muted = cssVar("--muted");
  const ok = cssVar("--ok");
  const danger = cssVar("--danger");

  const spec = run.spec;
  const n = spec.alloc.length;
  const m = spec.available.length;
  const banker = spec.mode === "banker";
  const matrices: { title: string; mat: number[][] }[] = [
    { title: "Allocation", mat: spec.alloc },
    banker ? { title: "Max", mat: spec.max! } : { title: "Request", mat: spec.request! },
    { title: banker ? "Need" : "Request left", mat: run.need },
  ];

  const cell = 32;
  const labelW = 46;
  const gapX = 34;
  const pad = 22;
  const headerY = 58;
  const matW = labelW + m * cell;
  const scale = 2;
  const w = pad * 2 + matrices.length * matW + (matrices.length - 1) * gapX;
  const h = headerY + 24 + (n + 1) * cell + 84;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = text;
  ctx.font = `bold 15px "Space Grotesk", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(
    `${banker ? "Banker's algorithm" : "Deadlock detection"} · Available (${spec.available.join(",")}) · ${
      banker
        ? run.safe ? `SAFE — ${run.safeSeq.map(procName).join(" → ")}` : `UNSAFE — ${run.stuck.map(procName).join(", ")} stuck`
        : run.safe ? "no deadlock" : `DEADLOCKED — ${run.stuck.map(procName).join(", ")}`
    }`,
    pad,
    32,
  );

  matrices.forEach(({ title, mat }, k) => {
    const x0 = pad + k * (matW + gapX);
    ctx.fillStyle = text;
    ctx.font = `bold 12px "Space Grotesk", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(title, x0, headerY);
    ctx.font = `bold 11px "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = muted;
    for (let j = 0; j < m; j += 1) ctx.fillText(RES_NAMES[j], x0 + labelW + j * cell + cell / 2, headerY + 24);
    for (let i = 0; i < n; i += 1) {
      const y = headerY + 30 + i * cell;
      // process chip
      ctx.fillStyle = bg[i % 8];
      ctx.fillRect(x0 + 2, y + 4, labelW - 10, cell - 10);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0 + 2, y + 4, labelW - 10, cell - 10);
      ctx.fillStyle = "#fffcf5";
      ctx.font = `bold 12px "JetBrains Mono", monospace`;
      ctx.fillText(procName(i), x0 + 2 + (labelW - 10) / 2, y + cell / 2 + 4);
      for (let j = 0; j < m; j += 1) {
        const x = x0 + labelW + j * cell;
        ctx.strokeStyle = panel2;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x, y, cell, cell);
        ctx.fillStyle = text;
        ctx.font = MONO;
        ctx.fillText(String(mat[i][j]), x + cell / 2, y + cell / 2 + 4);
      }
    }
  });

  // verdict strip
  const stripY = headerY + 30 + n * cell + 26;
  ctx.textAlign = "left";
  ctx.font = `bold 13px "JetBrains Mono", monospace`;
  ctx.fillStyle = run.safe ? ok : danger;
  ctx.fillText(
    banker
      ? run.safe ? `Safe sequence: ${run.safeSeq.map(procName).join(" → ")}` : `No safe sequence — ${run.stuck.map(procName).join(", ")} can never satisfy Need`
      : run.safe ? `Completion order: ${run.safeSeq.map(procName).join(" → ") || "(everyone already finished)"}` : `Deadlocked set: ${run.stuck.map(procName).join(", ")}`,
    pad,
    stripY,
  );
  ctx.fillStyle = muted;
  ctx.font = `11px "JetBrains Mono", monospace`;
  ctx.fillText(`final Work (${run.steps[run.steps.length - 1].work.join(",")})`, pad, stripY + 20);
  downloadCanvas(canvas, filename);
}

export function drawPageGridPng(run: PageRun, filename: string): void {
  const meta = PAGE_ALGOS.find((a) => a.key === run.algo)!;
  const { bg } = chipColors();
  const ink = cssVar("--ink");
  const panel = cssVar("--panel");
  const panel2 = cssVar("--panel-2");
  const text = cssVar("--text");
  const muted = cssVar("--muted");
  const ok = cssVar("--ok");
  const danger = cssVar("--danger");

  const cell = 38;
  const labelW = 52;
  const pad = 22;
  const headerY = 56;
  const rows = run.frameCount + 2; // ref row + frames + h/f row
  const scale = 2;
  const w = labelW + run.steps.length * cell + pad * 2;
  const h = headerY + rows * cell + pad;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = text;
  ctx.font = `bold 15px "Space Grotesk", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(
    `Page replacement — ${meta.short} · ${run.frameCount} frames · ${run.faults} faults / ${run.hits} hits (hit ratio ${(run.hitRatio * 100).toFixed(1)}%)`,
    pad,
    32,
  );

  const colX = (j: number): number => pad + labelW + j * cell;
  const rowY = (r: number): number => headerY + r * cell;
  ctx.textAlign = "center";

  // row labels
  ctx.fillStyle = muted;
  ctx.font = `bold 11px "JetBrains Mono", monospace`;
  ctx.textAlign = "right";
  ctx.fillText("ref", pad + labelW - 10, rowY(0) + cell / 2 + 4);
  for (let f = 0; f < run.frameCount; f += 1) ctx.fillText(`f${f}`, pad + labelW - 10, rowY(f + 1) + cell / 2 + 4);
  ctx.fillText("h/f", pad + labelW - 10, rowY(run.frameCount + 1) + cell / 2 + 4);
  ctx.textAlign = "center";

  run.steps.forEach((s, j) => {
    const x = colX(j);
    // ref chip
    ctx.fillStyle = bg[((s.page % 8) + 8) % 8];
    ctx.fillRect(x + 3, rowY(0) + 5, cell - 10, cell - 12);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x + 3, rowY(0) + 5, cell - 10, cell - 12);
    ctx.fillStyle = "#fffcf5";
    ctx.font = `bold ${MONO}`;
    ctx.fillText(String(s.page), x + (cell - 4) / 2, rowY(0) + cell / 2 + 4);
    // frame cells
    for (let f = 0; f < run.frameCount; f += 1) {
      const y = rowY(f + 1);
      ctx.strokeStyle = panel2;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, cell, cell);
      const page = s.frames[f];
      const touched = s.slot === f;
      if (touched) {
        ctx.strokeStyle = s.hit ? ok : danger;
        ctx.lineWidth = 2.4;
        ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
      }
      ctx.fillStyle = page === null ? muted : text;
      ctx.font = touched ? `bold ${MONO}` : MONO;
      ctx.fillText(page === null ? "·" : String(page), x + cell / 2, y + cell / 2 + 4);
    }
    // verdict row
    ctx.fillStyle = s.hit ? ok : danger;
    ctx.font = `bold ${MONO}`;
    ctx.fillText(s.hit ? "H" : "F", x + cell / 2, rowY(run.frameCount + 1) + cell / 2 + 4);
  });
  downloadCanvas(canvas, filename);
}
