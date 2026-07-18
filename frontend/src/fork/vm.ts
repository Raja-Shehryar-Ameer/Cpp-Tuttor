// Compiles the parsed program to a tiny stack bytecode, then runs it under a
// fork-aware scheduler. Bytecode (not tree-walking) is what makes fork()
// honest: a child is just a clone of the parent's (instruction pointer, stack,
// call frames), so a fork inside a loop or a helper function duplicates the
// whole execution state correctly. Crashes are modeled like Unix: an
// out-of-bounds index or runaway recursion kills only that process with a
// SIGSEGV-style status; the rest of the tree carries on.

import { lex, Parser, type Expr, type FuncDef, type Program, type Stmt } from "./simulate.ts";

type Op =
  | "CONST" | "LOAD" | "STORE" | "POP" | "DUP"
  | "ADD" | "SUB" | "MUL" | "DIV" | "MOD"
  | "SHL" | "SHR" | "BAND" | "BOR" | "BXOR"
  | "LT" | "LE" | "GT" | "GE" | "EQ" | "NE" | "NOT" | "NEG"
  | "JMP" | "JZ" | "JNZ"
  | "CALL" | "RET" | "ANEW" | "ALOAD" | "ASTORE"
  | "PRINT" | "FORK" | "EXIT" | "WAIT" | "WAITPID" | "GETPID" | "GETPPID" | "SLEEP" | "HALT";

interface Instr {
  op: Op;
  arg?: number | string;
  argc?: number;
}

interface FuncInfo {
  addr: number;
  params: string[];
}

// ------------------------------ compiler ------------------------------------

/** `&name` in a wait()/waitpid() status position → the variable to fill. */
function statusVarOf(a: Expr | undefined): string | undefined {
  return a && a.k === "un" && a.op === "&" && a.a.k === "var" ? a.a.name : undefined;
}

// Library calls that are common in exam programs but deliberately not modeled;
// they quietly return 0 without an "unknown function" warning (validation.ts
// already warns about the interesting ones like exec* and scanf).
const KNOWN_UNMODELED = new Set([
  "srand", "rand", "time", "atoi", "abs",
  "execl", "execlp", "execle", "execv", "execvp", "execvpe", "system",
  "signal", "kill", "raise", "alarm", "pause", "abort",
  "pipe", "close", "read", "write", "dup", "dup2",
  "scanf", "gets", "fgets", "getchar", "fflush", "setbuf", "perror",
  "malloc", "free", "calloc",
]);

const BIN_OPS: Record<string, Op> = {
  "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD",
  "<<": "SHL", ">>": "SHR", "&": "BAND", "|": "BOR", "^": "BXOR",
  "<": "LT", "<=": "LE", ">": "GT", ">=": "GE", "==": "EQ", "!=": "NE",
};

class Compiler {
  code: Instr[] = [];
  warnings: string[] = [];
  private funcs: Record<string, FuncInfo> = {};
  private userFuncs: Map<string, FuncDef> = new Map();
  private arrayNames = new Set<string>();
  // break targets the innermost loop OR switch; continue only loops
  private breakables: { breaks: number[]; continues: number[] | null }[] = [];
  private swId = 0;

  private emit(op: Op, arg?: number | string, argc?: number): number {
    this.code.push({ op, arg, argc });
    return this.code.length - 1;
  }
  private patch(i: number, arg: number) {
    this.code[i].arg = arg;
  }
  private warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  compileProgram(prog: Program): { code: Instr[]; funcs: Record<string, FuncInfo>; warnings: string[] } {
    this.userFuncs = prog.functions;
    // Bootstrap: globals live in the root frame, then main() runs and its
    // return value becomes the exit status.
    for (const g of prog.globals) this.stmt(g);
    this.emit("CALL", "main", 0);
    this.emit("EXIT");
    for (const f of prog.functions.values()) {
      if (f.name === "main" && f.params.length > 0)
        this.warn("main()'s parameters (argc/argv) aren't modeled — they read as 0.");
      this.funcs[f.name] = { addr: this.code.length, params: f.params };
      for (const s of f.body) this.stmt(s);
      this.emit("CONST", 0); // falling off the end returns 0
      this.emit("RET");
    }
    this.emit("HALT");
    return { code: this.code, funcs: this.funcs, warnings: this.warnings };
  }

  private stmt(s: Stmt) {
    switch (s.k) {
      case "decl":
        for (const it of s.items) {
          if (it.arr) {
            this.arrayNames.add(it.name);
            this.emit("CONST", it.arr.size);
            this.emit("ANEW", it.name);
            it.arr.init?.forEach((e, idx) => {
              this.emit("CONST", idx);
              this.expr(e);
              this.emit("ASTORE", it.name);
              this.emit("POP");
            });
          } else {
            if (it.e) this.expr(it.e);
            else this.emit("CONST", 0);
            this.emit("STORE", it.name);
            this.emit("POP");
          }
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
        this.emit("RET");
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
        this.breakables.push({ breaks: [], continues: [] });
        this.stmt(s.body);
        this.emit("JMP", lcond);
        const lend = this.code.length;
        this.patch(jz, lend);
        const frame = this.breakables.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        frame.continues!.forEach((c) => this.patch(c, lcond));
        break;
      }
      case "dowhile": {
        const ltop = this.code.length;
        this.breakables.push({ breaks: [], continues: [] });
        this.stmt(s.body);
        const lcond = this.code.length;
        this.expr(s.c);
        this.emit("JNZ", ltop);
        const lend = this.code.length;
        const frame = this.breakables.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        frame.continues!.forEach((c) => this.patch(c, lcond));
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
        this.breakables.push({ breaks: [], continues: [] });
        this.stmt(s.body);
        const lpost = this.code.length;
        if (s.post) {
          this.expr(s.post);
          this.emit("POP");
        }
        this.emit("JMP", lcond);
        const lend = this.code.length;
        if (jz >= 0) this.patch(jz, lend);
        const frame = this.breakables.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        frame.continues!.forEach((c) => this.patch(c, lpost));
        break;
      }
      case "switch": {
        // dispatch on a hidden temp so the scrutinee is evaluated exactly once
        const tmp = `__switch${this.swId++}`;
        this.expr(s.e);
        this.emit("STORE", tmp);
        this.emit("POP");
        const jumps: { at: number; ci: number }[] = [];
        s.cases.forEach((c, ci) => {
          if (c.v === null) return;
          this.emit("LOAD", tmp);
          this.emit("CONST", c.v);
          this.emit("EQ");
          jumps.push({ at: this.emit("JNZ", -1), ci });
        });
        const jmpDefault = this.emit("JMP", -1);
        this.breakables.push({ breaks: [], continues: null });
        const bodyAddr: number[] = [];
        s.cases.forEach((c, ci) => {
          bodyAddr[ci] = this.code.length; // fall-through is the natural layout
          for (const b of c.body) this.stmt(b);
        });
        const lend = this.code.length;
        jumps.forEach((j) => this.patch(j.at, bodyAddr[j.ci]));
        const dflt = s.cases.findIndex((c) => c.v === null);
        this.patch(jmpDefault, dflt >= 0 ? bodyAddr[dflt] : lend);
        const frame = this.breakables.pop()!;
        frame.breaks.forEach((b) => this.patch(b, lend));
        break;
      }
      case "break": {
        const frame = this.breakables[this.breakables.length - 1];
        if (frame) frame.breaks.push(this.emit("JMP", -1));
        break;
      }
      case "continue": {
        for (let i = this.breakables.length - 1; i >= 0; i--) {
          const frame = this.breakables[i];
          if (frame.continues) {
            frame.continues.push(this.emit("JMP", -1));
            break;
          }
        }
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
        if (e.op === "&") {
          // address-of only means something as a wait()/waitpid() status slot,
          // which call() intercepts before compiling args; elsewhere it's 0
          this.emit("CONST", 0);
          break;
        }
        this.expr(e.a);
        this.emit(e.op === "!" ? "NOT" : "NEG");
        break;
      case "cond": {
        this.expr(e.c);
        const jz = this.emit("JZ", -1);
        this.expr(e.t);
        const jmp = this.emit("JMP", -1);
        this.patch(jz, this.code.length);
        this.expr(e.f);
        this.patch(jmp, this.code.length);
        break;
      }
      case "assign": {
        const opFor = (op: string): Op =>
          op === "+=" ? "ADD" : op === "-=" ? "SUB" : op === "*=" ? "MUL" : "DIV";
        if (e.target.k === "index") {
          this.expr(e.target.i);
          if (e.op === "=") {
            this.expr(e.e);
          } else {
            this.emit("DUP"); // keep the index for the store
            this.emit("ALOAD", e.target.name);
            this.expr(e.e);
            this.emit(opFor(e.op));
          }
          this.emit("ASTORE", e.target.name);
          break;
        }
        const name = (e.target as Extract<Expr, { k: "var" }>).name;
        if (e.op === "=") {
          this.expr(e.e);
        } else {
          this.emit("LOAD", name);
          this.expr(e.e);
          this.emit(opFor(e.op));
        }
        this.emit("STORE", name);
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
      case "index":
        this.expr(e.i);
        this.emit("ALOAD", e.name);
        break;
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
    this.emit(BIN_OPS[e.op]);
  }

  private call(e: Extract<Expr, { k: "call" }>) {
    const arg0 = () => {
      if (e.args[0]) this.expr(e.args[0]);
      else this.emit("CONST", 0);
    };
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
        // wait(&s) records the packed status (exit code << 8) into s
        this.emit("WAIT", statusVarOf(e.args[0]));
        return;
      case "waitpid":
        // first arg picks WHICH child (-1 = any), second may be &status
        if (e.args[0]) this.expr(e.args[0]);
        else this.emit("CONST", -1);
        this.emit("WAITPID", statusVarOf(e.args[1]));
        return;
      case "exit":
      case "_exit":
        arg0();
        this.emit("EXIT");
        return;
      case "sleep":
      case "usleep":
        arg0();
        this.emit("SLEEP");
        return;
      // <sys/wait.h> status macros, modeled on the real bit layout
      case "WEXITSTATUS": // (s >> 8) & 0xff
        arg0();
        this.emit("CONST", 8);
        this.emit("SHR");
        this.emit("CONST", 255);
        this.emit("BAND");
        return;
      case "WIFEXITED": // !(s & 0x7f)
        arg0();
        this.emit("CONST", 127);
        this.emit("BAND");
        this.emit("NOT");
        return;
      case "WIFSIGNALED": // (s & 0x7f) != 0
        arg0();
        this.emit("CONST", 127);
        this.emit("BAND");
        this.emit("CONST", 0);
        this.emit("NE");
        return;
      case "WTERMSIG": // s & 0x7f
        arg0();
        this.emit("CONST", 127);
        this.emit("BAND");
        return;
      case "puts": {
        if (e.args[0]?.k === "str") {
          this.emit("PRINT", e.args[0].v + "\\n", 0);
        } else {
          this.warn(`line ${e.line}: puts() with a non-literal argument isn't supported — it prints nothing.`);
          this.emit("CONST", 0);
        }
        return;
      }
      case "putchar":
        arg0();
        this.emit("PRINT", "%c", 1);
        return;
      case "printf": {
        const fmt = e.args[0]?.k === "str" ? e.args[0].v : "";
        const valueArgs = e.args.slice(1);
        for (const a of valueArgs) this.expr(a);
        this.emit("PRINT", fmt, valueArgs.length);
        return;
      }
    }
    const fn = this.userFuncs.get(e.name);
    if (fn) {
      if (e.args.length !== fn.params.length)
        throw new Error(
          `line ${e.line}: ${e.name}() takes ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, got ${e.args.length}`,
        );
      for (const a of e.args) {
        if (a.k === "var" && this.arrayNames.has(a.name))
          throw new Error(`line ${e.line}: arrays can't be passed to functions yet — pass elements one by one`);
        this.expr(a);
      }
      this.emit("CALL", e.name, e.args.length);
      return;
    }
    // unknown call: evaluate args for side effects, discard, yield 0
    if (!KNOWN_UNMODELED.has(e.name))
      this.warn(`line ${e.line}: unknown function ${e.name}() — treated as returning 0.`);
    for (const a of e.args) {
      this.expr(a);
      this.emit("POP");
    }
    this.emit("CONST", 0);
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

interface Frame {
  vars: Map<string, number>;
  arrays: Map<string, number[]>;
  ret: number;
}

interface Proc extends ProcNode {
  ip: number;
  stack: number[];
  frames: Frame[];
  statusWord: number | null; // what wait() reads: code << 8, or the signal
  alive: boolean;
  waiting: boolean;
  waitFor: number | null; // pid a blocked waitpid() targets; null = any child
  waitVar: string | null; // variable a blocked wait's &status should fill
  unwaited: number[];
}

const MAX_PROCS = 100;
const MAX_STEPS = 500_000;
const MAX_FRAMES = 200;
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
      else if (s === "x") out += (args[ai++] ?? 0).toString(16);
      else if (s === "%") out += "%";
      else out += "%" + (s ?? "");
    } else out += c;
  }
  return out;
}

export function simulateFork(source: string): SimResult {
  const notes: string[] = [];
  let code: Instr[];
  let funcs: Record<string, FuncInfo>;
  try {
    const prog = new Parser(lex(source)).parseProgram();
    const compiled = new Compiler().compileProgram(prog);
    code = compiled.code;
    funcs = compiled.funcs;
    notes.push(...compiled.warnings);
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
      statusWord: null,
      reparented: false,
      zombie: false,
      childIds: [],
      ip: parent ? parent.ip : 0,
      stack: parent ? parent.stack.slice() : [],
      frames: parent
        ? parent.frames.map((f) => ({
            vars: new Map(f.vars),
            arrays: new Map([...f.arrays].map(([k, v]) => [k, v.slice()])),
            ret: f.ret,
          }))
        : [{ vars: new Map(), arrays: new Map(), ret: -1 }],
      alive: true,
      waiting: false,
      waitFor: null,
      waitVar: null,
      unwaited: [],
    };
    procs.push(p);
    return p;
  };

  // Variable scope: the current call frame, falling back to the root frame,
  // which doubles as global scope (fork clones it all, which IS C's copy-on-
  // write semantics: each process owns its copy of every variable).
  const topF = (p: Proc) => p.frames[p.frames.length - 1];
  const getVar = (p: Proc, name: string): number =>
    topF(p).vars.get(name) ?? p.frames[0].vars.get(name) ?? 0;
  const setVar = (p: Proc, name: string, v: number) => {
    const f = topF(p).vars.has(name) ? topF(p) : p.frames[0].vars.has(name) ? p.frames[0] : topF(p);
    f.vars.set(name, v);
  };
  const getArr = (p: Proc, name: string): number[] | undefined =>
    topF(p).arrays.get(name) ?? p.frames[0].arrays.get(name);

  const root = spawn(null);
  root.label = "P0";

  // Ready queue: FIFO of runnable processes. sleep() pushes the sleeper to
  // the back so its siblings/children get the CPU first — which is exactly
  // how the classic "parent sleeps, child exits → zombie" programs behave.
  const queue: Proc[] = [root];

  const terminate = (p: Proc, status: number, sig = 0) => {
    p.alive = false;
    // Real wait() packs a status word: exit code in the high byte, or the
    // fatal signal in the low bits. exitStatus mirrors the shell's $?.
    p.exitStatus = sig ? (128 + sig) & 0xff : status & 0xff;
    p.statusWord = sig ? sig : (status & 0xff) << 8;
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
      if (par.waiting && (par.waitFor === null || par.waitFor === p.pid)) {
        // Parent was blocked in wait()/waitpid() for us: reaped immediately,
        // no zombie. A &status pointer receives the packed word.
        const idx = par.unwaited.indexOf(p.id);
        if (idx >= 0) par.unwaited.splice(idx, 1);
        if (par.waitVar) setVar(par, par.waitVar, p.statusWord);
        par.waiting = false;
        par.waitFor = null;
        par.waitVar = null;
        par.stack.push(p.pid);
        queue.push(par);
      } else if (par.alive) {
        // Parent alive but not waiting (or waiting for a different child):
        // this child is now a ZOMBIE. The flag is cleared if a later wait()
        // reaps it; if the parent exits without ever waiting, it sticks.
        p.zombie = true;
      }
      // Parent already dead: we were reparented; init reaps us silently.
    }
  };

  // A Unix-flavored crash: only this process dies, with a SIGSEGV status.
  const crash = (p: Proc, msg: string) => {
    notes.push(`${p.label} crashed: ${msg} — the process was killed (SIGSEGV-style status 139).`);
    terminate(p, 0, 11);
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
        case "LOAD": st.push(getVar(p, ins.arg as string)); break;
        case "STORE": {
          const v = st[st.length - 1];
          setVar(p, ins.arg as string, v);
          break; // leave value on stack (assignment is an expression)
        }
        case "POP": st.pop(); break;
        case "DUP": st.push(st[st.length - 1]); break;
        case "ADD": { const b = st.pop()!; st.push((st.pop()! + b) | 0); break; }
        case "SUB": { const b = st.pop()!; st.push((st.pop()! - b) | 0); break; }
        case "MUL": { const b = st.pop()!; st.push((st.pop()! * b) | 0); break; }
        case "DIV": { const b = st.pop()!; st.push(b === 0 ? 0 : (st.pop()! / b) | 0); break; }
        case "MOD": { const b = st.pop()!; st.push(b === 0 ? 0 : (st.pop()! % b) | 0); break; }
        case "SHL": { const b = st.pop()!; st.push(st.pop()! << b); break; }
        case "SHR": { const b = st.pop()!; st.push(st.pop()! >> b); break; }
        case "BAND": { const b = st.pop()!; st.push(st.pop()! & b); break; }
        case "BOR": { const b = st.pop()!; st.push(st.pop()! | b); break; }
        case "BXOR": { const b = st.pop()!; st.push(st.pop()! ^ b); break; }
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
        case "CALL": {
          const fn = funcs[ins.arg as string];
          if (p.frames.length >= MAX_FRAMES) {
            crash(p, `stack overflow in ${ins.arg}() — recursion went too deep`);
            return "ended";
          }
          const argc = ins.argc ?? 0;
          const args = argc ? st.splice(st.length - argc, argc) : [];
          const vars = new Map<string, number>();
          fn.params.forEach((nm, ix) => vars.set(nm, args[ix] ?? 0));
          p.frames.push({ vars, arrays: new Map(), ret: p.ip });
          p.ip = fn.addr;
          break;
        }
        case "RET": {
          const v = st.pop() ?? 0;
          const frame = p.frames.pop()!;
          p.ip = frame.ret;
          st.push(v);
          break;
        }
        case "ANEW": {
          const size = st.pop()!;
          if (size < 0 || size > 100_000) {
            crash(p, `array "${ins.arg}" has an impossible size (${size})`);
            return "ended";
          }
          topF(p).arrays.set(ins.arg as string, new Array(size).fill(0));
          break;
        }
        case "ALOAD": {
          const idx = st.pop()!;
          const arr = getArr(p, ins.arg as string);
          if (!arr) {
            crash(p, `no array named "${ins.arg}" is in scope`);
            return "ended";
          }
          if (idx < 0 || idx >= arr.length) {
            crash(p, `index ${idx} is out of bounds for ${ins.arg}[${arr.length}]`);
            return "ended";
          }
          st.push(arr[idx]);
          break;
        }
        case "ASTORE": {
          const v = st.pop()!;
          const idx = st.pop()!;
          const arr = getArr(p, ins.arg as string);
          if (!arr) {
            crash(p, `no array named "${ins.arg}" is in scope`);
            return "ended";
          }
          if (idx < 0 || idx >= arr.length) {
            crash(p, `index ${idx} is out of bounds for ${ins.arg}[${arr.length}]`);
            return "ended";
          }
          arr[idx] = v;
          st.push(v); // assignment is an expression
          break;
        }
        case "SLEEP":
          // Yield the CPU: everyone else runs before the sleeper resumes —
          // this is what lets a child exit while its parent naps (zombie).
          st.pop();
          st.push(0); // sleep() returns 0
          return "slept";
        case "PRINT": {
          const argc = ins.argc ?? 0;
          const args = argc ? st.splice(st.length - argc, argc) : [];
          const text = applyFormat(ins.arg as string, args);
          p.output += text;
          outputChunks.push(text);
          st.push(text.length); // printf returns the character count
          break;
        }
        case "FORK": {
          if (procs.length >= MAX_PROCS) {
            cappedProcs = true;
            st.push(-1);
            break;
          }
          const child = spawn(p); // clones ip, stack, frames from parent
          child.stack.push(0); // child sees fork() == 0
          st.push(child.pid); // parent sees the child pid
          p.childIds.push(child.id);
          p.unwaited.push(child.id);
          queue.push(child); // becomes runnable after the parent yields
          break;
        }
        case "WAIT":
        case "WAITPID": {
          const sv = ins.arg as string | undefined;
          // reaping is what un-zombifies a dead child; &status gets the word
          const reap = (cid: number) => {
            const kid = byId(cid);
            p.unwaited.splice(p.unwaited.indexOf(cid), 1);
            kid.zombie = false;
            if (sv) setVar(p, sv, kid.statusWord ?? 0);
            st.push(kid.pid);
          };
          const target = ins.op === "WAITPID" ? st.pop()! : -1;
          if (target !== -1) {
            // waitpid(pid, …): that exact child — not just any dead one
            const cid = p.unwaited.find((c) => byId(c).pid === target);
            if (cid === undefined) {
              st.push(-1); // not our un-reaped child → ECHILD
              break;
            }
            if (!byId(cid).alive) {
              reap(cid);
              break;
            }
            p.waiting = true;
            p.waitFor = target;
            p.waitVar = sv ?? null;
            return "ended";
          }
          const done = p.unwaited.find((cid) => !byId(cid).alive);
          if (done !== undefined) {
            reap(done);
            break;
          }
          if (p.unwaited.length === 0) {
            st.push(-1); // no children to wait for
            break;
          }
          p.waiting = true; // block; a child will unblock us on exit
          p.waitFor = null;
          p.waitVar = sv ?? null;
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
