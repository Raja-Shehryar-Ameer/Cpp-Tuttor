// Compiles the parsed main() body to a tiny stack bytecode, then runs it under
// a fork-aware scheduler. Bytecode (not tree-walking) is what makes fork()
// honest: a child is just a clone of the parent's (instruction pointer, stack,
// variables), so a fork inside a loop duplicates the loop counter correctly.

import { lex, Parser, type Expr, type Stmt } from "./simulate";

type Op =
  | "CONST" | "LOAD" | "STORE" | "POP" | "DUP"
  | "ADD" | "SUB" | "MUL" | "DIV" | "MOD"
  | "LT" | "LE" | "GT" | "GE" | "EQ" | "NE" | "NOT" | "NEG"
  | "JMP" | "JZ" | "JNZ"
  | "PRINT" | "FORK" | "EXIT" | "WAIT" | "GETPID" | "GETPPID" | "SLEEP" | "HALT";

interface Instr {
  op: Op;
  arg?: number | string;
  argc?: number;
}

// ------------------------------ compiler ------------------------------------

class Compiler {
  code: Instr[] = [];
  private loops: { breaks: number[]; continues: number[] }[] = [];

  private emit(op: Op, arg?: number | string, argc?: number): number {
    this.code.push({ op, arg, argc });
    return this.code.length - 1;
  }
  private patch(i: number, arg: number) {
    this.code[i].arg = arg;
  }

  compileProgram(body: Stmt[]): Instr[] {
    for (const s of body) this.stmt(s);
    this.emit("HALT");
    return this.code;
  }

  private stmt(s: Stmt) {
    switch (s.k) {
      case "decl":
        for (const it of s.items) {
          if (it.e) this.expr(it.e);
          else this.emit("CONST", 0);
          this.emit("STORE", it.name);
          this.emit("POP");
        }
        break;
      case "expr":
        this.expr(s.e);
        this.emit("POP");
        break;
      case "block":
        for (const b of s.body) this.stmt(b);
        break;
      case "return":
        if (s.e) this.expr(s.e);
        else this.emit("CONST", 0);
        this.emit("EXIT");
        break;
      case "if": {
        this.expr(s.c);
        const jz = this.emit("JZ", -1);
        this.stmt(s.then);
        if (s.else) {
          const jmp = this.emit("JMP", -1);
          this.patch(jz, this.code.length);
          this.stmt(s.else);
          this.patch(jmp, this.code.length);
        } else {
          this.patch(jz, this.code.length);
        }
        break;
      }
      case "while": {
        const lcond = this.code.length;
        this.expr(s.c);
        const jz = this.emit("JZ", -1);
        this.loops.push({ breaks: [], continues: [] });
        this.stmt(s.body);
        this.emit("JMP", lcond);
        const lend = this.code.length;
        this.patch(jz, lend);
        const frame = this.loops.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        frame.continues.forEach((c) => this.patch(c, lcond));
        break;
      }
      case "for": {
        if (s.init) this.stmt(s.init);
        const lcond = this.code.length;
        let jz = -1;
        if (s.cond) {
          this.expr(s.cond);
          jz = this.emit("JZ", -1);
        }
        this.loops.push({ breaks: [], continues: [] });
        this.stmt(s.body);
        const lpost = this.code.length;
        if (s.post) {
          this.expr(s.post);
          this.emit("POP");
        }
        this.emit("JMP", lcond);
        const lend = this.code.length;
        if (jz >= 0) this.patch(jz, lend);
        const frame = this.loops.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        frame.continues.forEach((c) => this.patch(c, lpost));
        break;
      }
      case "break": {
        const frame = this.loops[this.loops.length - 1];
        if (frame) frame.breaks.push(this.emit("JMP", -1));
        break;
      }
      case "continue": {
        const frame = this.loops[this.loops.length - 1];
        if (frame) frame.continues.push(this.emit("JMP", -1));
        break;
      }
    }
  }

  private expr(e: Expr) {
    switch (e.k) {
      case "num":
        this.emit("CONST", e.v);
        break;
      case "str":
        this.emit("CONST", 0); // bare string in a non-printf position: unsupported → 0
        break;
      case "var":
        this.emit("LOAD", e.name);
        break;
      case "un":
        this.expr(e.a);
        this.emit(e.op === "!" ? "NOT" : "NEG");
        break;
      case "assign": {
        if (e.op === "=") {
          this.expr(e.e);
        } else {
          this.emit("LOAD", e.name);
          this.expr(e.e);
          this.emit(e.op === "+=" ? "ADD" : e.op === "-=" ? "SUB" : e.op === "*=" ? "MUL" : "DIV");
        }
        this.emit("STORE", e.name);
        break;
      }
      case "incdec": {
        const delta: Op = e.op === "++" ? "ADD" : "SUB";
        if (e.pre) {
          this.emit("LOAD", e.name);
          this.emit("CONST", 1);
          this.emit(delta);
          this.emit("STORE", e.name);
        } else {
          this.emit("LOAD", e.name); // expression value = old
          this.emit("LOAD", e.name);
          this.emit("CONST", 1);
          this.emit(delta);
          this.emit("STORE", e.name);
          this.emit("POP");
        }
        break;
      }
      case "bin":
        this.binary(e);
        break;
      case "call":
        this.call(e);
        break;
    }
  }

  private binary(e: Extract<Expr, { k: "bin" }>) {
    if (e.op === "&&" || e.op === "||") {
      this.expr(e.a);
      const short = this.emit(e.op === "&&" ? "JZ" : "JNZ", -1); // stack consumed
      this.expr(e.b);
      const jnz2 = this.emit(e.op === "&&" ? "JZ" : "JNZ", -1);
      this.emit("CONST", e.op === "&&" ? 1 : 0);
      const jmp = this.emit("JMP", -1);
      const other = this.code.length;
      this.patch(short, other);
      this.patch(jnz2, other);
      this.emit("CONST", e.op === "&&" ? 0 : 1);
      this.patch(jmp, this.code.length);
      return;
    }
    this.expr(e.a);
    this.expr(e.b);
    const map: Record<string, Op> = {
      "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD",
      "<": "LT", "<=": "LE", ">": "GT", ">=": "GE", "==": "EQ", "!=": "NE",
    };
    this.emit(map[e.op]);
  }

  private call(e: Extract<Expr, { k: "call" }>) {
    switch (e.name) {
      case "fork":
        this.emit("FORK");
        return;
      case "getpid":
        this.emit("GETPID");
        return;
      case "getppid":
        this.emit("GETPPID");
        return;
      case "wait":
      case "waitpid":
        this.emit("WAIT"); // args (status ptr) ignored
        return;
      case "exit":
      case "_exit":
        if (e.args[0]) this.expr(e.args[0]);
        else this.emit("CONST", 0);
        this.emit("EXIT");
        return;
      case "sleep":
      case "usleep":
        if (e.args[0]) this.expr(e.args[0]);
        else this.emit("CONST", 0);
        this.emit("SLEEP");
        return;
      case "printf": {
        const fmt = e.args[0]?.k === "str" ? e.args[0].v : "";
        const valueArgs = e.args.slice(1);
        for (const a of valueArgs) this.expr(a);
        this.emit("PRINT", fmt, valueArgs.length);
        return;
      }
      default:
        // unknown call: evaluate args for side effects, discard, yield 0
        for (const a of e.args) {
          this.expr(a);
          this.emit("POP");
        }
        this.emit("CONST", 0);
    }
  }
}

// ------------------------------ runtime -------------------------------------

export interface ProcNode {
  id: number;
  label: string; // P0, P1, …
  pid: number;
  parentId: number | null;
  ppid: number;
  output: string;
  exitStatus: number | null;
  reparented: boolean; // orphaned then adopted by systemd/init
  zombie: boolean; // exited before its parent, which never wait()ed for it
  childIds: number[];
}

export interface SimResult {
  processes: ProcNode[];
  systemdAdopted: number[]; // ids reparented to systemd/init
  output: string;
  notes: string[];
  error: string | null;
}

interface Proc extends ProcNode {
  ip: number;
  stack: number[];
  vars: Map<string, number>;
  alive: boolean;
  waiting: boolean;
  unwaited: number[];
}

const MAX_PROCS = 100;
const MAX_STEPS = 500_000;
const SYSTEMD_PID = 1;
const BASE_PID = 1000;

function applyFormat(fmt: string, args: number[]): string {
  let out = "";
  let ai = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === "\\") {
      const n = fmt[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "\\" ? "\\" : n ?? "";
    } else if (c === "%") {
      const s = fmt[++i];
      if (s === "d" || s === "i" || s === "u" || s === "l") out += String(args[ai++] ?? 0);
      else if (s === "c") out += String.fromCharCode(args[ai++] ?? 0);
      else if (s === "%") out += "%";
      else out += "%" + (s ?? "");
    } else out += c;
  }
  return out;
}

export function simulateFork(source: string): SimResult {
  const notes: string[] = [];
  let code: Instr[];
  try {
    const body = new Parser(lex(source)).parseMain();
    code = new Compiler().compileProgram(body);
  } catch (err) {
    return {
      processes: [],
      systemdAdopted: [],
      output: "",
      notes: [],
      error: err instanceof Error ? err.message : "parse error",
    };
  }

  const procs: Proc[] = [];
  const byId = (id: number) => procs[id];
  const outputChunks: string[] = [];

  const spawn = (parent: Proc | null): Proc => {
    const id = procs.length;
    const p: Proc = {
      id,
      label: `P${id}`,
      pid: BASE_PID + id,
      parentId: parent ? parent.id : null,
      ppid: parent ? parent.pid : SYSTEMD_PID,
      output: "",
      exitStatus: null,
      reparented: false,
      zombie: false,
      childIds: [],
      ip: parent ? parent.ip : 0,
      stack: parent ? parent.stack.slice() : [],
      vars: parent ? new Map(parent.vars) : new Map(),
      alive: true,
      waiting: false,
      unwaited: [],
    };
    procs.push(p);
    return p;
  };

  const root = spawn(null);
  root.label = "P0";

  // Ready queue: FIFO of runnable processes. sleep() pushes the sleeper to
  // the back so its siblings/children get the CPU first — which is exactly
  // how the classic "parent sleeps, child exits → zombie" programs behave.
  const queue: Proc[] = [root];

  const terminate = (p: Proc, status: number) => {
    p.alive = false;
    p.exitStatus = status;
    p.ip = code.length;
    // Orphan any children still running — the kernel reparents them to
    // systemd/init (PID 1). We keep the fork-time parent in the tree and just
    // flag the adoption.
    for (const cid of p.childIds) {
      const kid = byId(cid);
      if (kid.alive) kid.reparented = true;
    }
    if (p.parentId !== null) {
      const par = byId(p.parentId);
      if (par.waiting) {
        // Parent was blocked in wait(): reaped immediately, no zombie.
        const idx = par.unwaited.indexOf(p.id);
        if (idx >= 0) par.unwaited.splice(idx, 1);
        par.waiting = false;
        par.stack.push(p.pid);
        queue.push(par);
      } else if (par.alive) {
        // Parent alive but not waiting: this child is now a ZOMBIE. The flag
        // is cleared if a later wait() reaps it; if the parent exits without
        // ever waiting, it sticks (init reaps it, but it *was* a zombie).
        p.zombie = true;
      }
      // Parent already dead: we were reparented; init reaps us silently.
    }
  };

  let steps = 0;
  let cappedProcs = false;

  const run = (p: Proc): "slept" | "ended" => {
    while (p.alive && !p.waiting) {
      if (p.ip >= code.length) {
        terminate(p, 0);
        return "ended";
      }
      if (++steps > MAX_STEPS) {
        notes.push("Stopped: too many steps (possible infinite loop).");
        procs.forEach((q) => (q.alive = false));
        return "ended";
      }
      const ins = code[p.ip++];
      const st = p.stack;
      switch (ins.op) {
        case "CONST": st.push(ins.arg as number); break;
        case "LOAD": st.push(p.vars.get(ins.arg as string) ?? 0); break;
        case "STORE": {
          const v = st[st.length - 1];
          p.vars.set(ins.arg as string, v);
          break; // leave value on stack (assignment is an expression)
        }
        case "POP": st.pop(); break;
        case "DUP": st.push(st[st.length - 1]); break;
        case "ADD": { const b = st.pop()!; st.push((st.pop()! + b) | 0); break; }
        case "SUB": { const b = st.pop()!; st.push((st.pop()! - b) | 0); break; }
        case "MUL": { const b = st.pop()!; st.push((st.pop()! * b) | 0); break; }
        case "DIV": { const b = st.pop()!; st.push(b === 0 ? 0 : (st.pop()! / b) | 0); break; }
        case "MOD": { const b = st.pop()!; st.push(b === 0 ? 0 : (st.pop()! % b) | 0); break; }
        case "LT": { const b = st.pop()!; st.push(st.pop()! < b ? 1 : 0); break; }
        case "LE": { const b = st.pop()!; st.push(st.pop()! <= b ? 1 : 0); break; }
        case "GT": { const b = st.pop()!; st.push(st.pop()! > b ? 1 : 0); break; }
        case "GE": { const b = st.pop()!; st.push(st.pop()! >= b ? 1 : 0); break; }
        case "EQ": { const b = st.pop()!; st.push(st.pop()! === b ? 1 : 0); break; }
        case "NE": { const b = st.pop()!; st.push(st.pop()! !== b ? 1 : 0); break; }
        case "NOT": st.push(st.pop()! === 0 ? 1 : 0); break;
        case "NEG": st.push(-st.pop()! | 0); break;
        case "JMP": p.ip = ins.arg as number; break;
        case "JZ": if (st.pop() === 0) p.ip = ins.arg as number; break;
        case "JNZ": if (st.pop() !== 0) p.ip = ins.arg as number; break;
        case "GETPID": st.push(p.pid); break;
        case "GETPPID": st.push(p.reparented ? SYSTEMD_PID : p.ppid); break;
        case "SLEEP":
          // Yield the CPU: everyone else runs before the sleeper resumes —
          // this is what lets a child exit while its parent naps (zombie).
          st.pop();
          return "slept";
        case "PRINT": {
          const argc = ins.argc ?? 0;
          const args = argc ? st.splice(st.length - argc, argc) : [];
          const text = applyFormat(ins.arg as string, args);
          p.output += text;
          outputChunks.push(text);
          break;
        }
        case "FORK": {
          if (procs.length >= MAX_PROCS) {
            cappedProcs = true;
            st.push(-1);
            break;
          }
          const child = spawn(p); // clones ip, stack, vars from parent
          child.stack.push(0); // child sees fork() == 0
          st.push(child.pid); // parent sees the child pid
          p.childIds.push(child.id);
          p.unwaited.push(child.id);
          queue.push(child); // becomes runnable after the parent yields
          break;
        }
        case "WAIT": {
          // reap an already-exited child if one is waiting to be collected —
          // that collection is what un-zombifies it
          const done = p.unwaited.find((cid) => !byId(cid).alive);
          if (done !== undefined) {
            p.unwaited.splice(p.unwaited.indexOf(done), 1);
            byId(done).zombie = false;
            st.push(byId(done).pid);
            break;
          }
          if (p.unwaited.length === 0) {
            st.push(-1); // no children to wait for
            break;
          }
          p.waiting = true; // block; a child will unblock us on exit
          return "ended";
        }
        case "EXIT": terminate(p, st.pop()! | 0); return "ended";
        case "HALT": terminate(p, 0); return "ended";
      }
    }
    return "ended";
  };

  // Scheduler: FIFO ready queue. A process runs to its next yield (wait(),
  // sleep(), or termination); sleepers go to the back. Parent-before-child
  // order is preserved because a parent keeps the CPU across a fork(), so
  // this is one deterministic — and valid — interleaving.
  let guard = 0;
  while (queue.length > 0) {
    if (++guard > MAX_PROCS * 40 + 100) break;
    const p = queue.shift()!;
    if (!p.alive || p.waiting) continue; // stale entry (already exited / re-blocked)
    const why = run(p);
    if (why === "slept" && p.alive && !p.waiting) queue.push(p);
  }
  if (procs.some((q) => q.alive && q.waiting)) notes.push("A wait() had no child to reap.");

  if (cappedProcs) notes.push(`Process cap reached (${MAX_PROCS}); some forks were not run.`);
  if (procs.some((q) => q.reparented))
    notes.push("Amber: orphans — children that outlived their parent, adopted by systemd (PID 1, classically init).");
  if (procs.some((q) => q.zombie))
    notes.push("Red: zombies — exited before their parent, which never wait()ed to reap them.");
  notes.push("Output shows one valid ordering — real fork() interleavings vary by scheduling.");

  const processes: ProcNode[] = procs.map((p) => ({
    id: p.id,
    label: p.label,
    pid: p.pid,
    parentId: p.parentId,
    ppid: p.ppid,
    output: p.output,
    exitStatus: p.exitStatus,
    reparented: p.reparented,
    zombie: p.zombie,
    childIds: p.childIds,
  }));

  return {
    processes,
    systemdAdopted: procs.filter((p) => p.reparented).map((p) => p.id),
    output: outputChunks.join(""),
    notes,
    error: null,
  };
}
