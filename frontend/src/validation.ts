// Pre-flight input validation: catch the obvious problems in the browser and
// say so in plain words, instead of burning a Docker round-trip (tracer) or a
// cryptic parse error (fork simulator) to find out.

export interface Validation {
  /** blocking problems — don't run */
  errors: string[];
  /** worth a heads-up, but still run */
  warnings: string[];
}

const MAX_TRACER_BYTES = 64 * 1024;

/** Counts braces/parens outside strings, chars, and comments. */
function balance(src: string): { braces: number; parens: number } {
  let braces = 0;
  let parens = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      if (c === "{") braces++;
      else if (c === "}") braces--;
      else if (c === "(") parens++;
      else if (c === ")") parens--;
      i++;
    }
  }
  return { braces, parens };
}

function structural(src: string): string[] {
  const errors: string[] = [];
  const { braces, parens } = balance(src);
  if (braces > 0) errors.push(`Unbalanced braces: ${braces} more { than } — a block is never closed.`);
  if (braces < 0) errors.push(`Unbalanced braces: ${-braces} more } than { — there's a stray closing brace.`);
  if (parens > 0) errors.push(`Unbalanced parentheses: ${parens} more ( than ).`);
  if (parens < 0) errors.push(`Unbalanced parentheses: ${-parens} more ) than (.`);
  if (!/\bmain\s*\(/.test(src)) errors.push("No main() function found — execution starts from main().");
  return errors;
}

export function validateTracerSource(code: string): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = code.trim();

  if (trimmed.length === 0) {
    errors.push("The editor is empty — write (or pick) a C++ program first.");
    return { errors, warnings };
  }
  if (new Blob([code]).size > MAX_TRACER_BYTES) {
    errors.push("This program is over 64 KB — the tracer is built for exam-sized programs, not projects.");
    return { errors, warnings };
  }
  errors.push(...structural(code));

  if (/\bfork\s*\(/.test(code))
    warnings.push("fork() spotted — the C fork() tab draws the process tree; the tracer follows only one process.");
  if (/\b(system|popen|remove|rename)\s*\(/.test(code))
    warnings.push("OS calls like system() run inside a sandbox — they'll likely fail silently.");
  if (/\bwhile\s*\(\s*(1|true)\s*\)/.test(code) && !/\bbreak\b/.test(code))
    warnings.push("while(1) with no break — the tracer will stop at its step limit.");
  return { errors, warnings };
}

export function validateForkSource(code: string): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = code.trim();

  if (trimmed.length === 0) {
    errors.push("The editor is empty — write a C program that calls fork().");
    return { errors, warnings };
  }
  errors.push(...structural(code));
  if (/\b(std::|cout|cin|endl|new\s+\w|class\s+\w)/.test(code))
    errors.push("This looks like C++ — the fork simulator runs C: printf() instead of cout, no classes.");

  if (!/\bfork\s*\(/.test(code) && errors.length === 0)
    warnings.push("No fork() call — the tree will be a single P0 node.");
  if (/\bexec[lv]p?e?\s*\(/.test(code))
    warnings.push("exec*() isn't simulated — it's treated as an unknown call that returns 0.");
  if (/\b(scanf|gets|fgets|getchar)\s*\(/.test(code))
    warnings.push("stdin isn't simulated — reads return 0.");
  if (/\bpthread_|<threads?\.h>/.test(code)) warnings.push("Threads aren't simulated — only processes via fork().");
  if (/\b(signal|kill|sigaction)\s*\(/.test(code))
    warnings.push("Signals aren't simulated — signal()/kill() are treated as unknown calls.");
  if (/\bpipe\s*\(|\bdup2?\s*\(/.test(code)) warnings.push("Pipes/fd plumbing aren't simulated.");
  return { errors, warnings };
}
