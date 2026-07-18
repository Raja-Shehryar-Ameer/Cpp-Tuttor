// A C-subset front end for the fork() simulator: functions (with recursion),
// int variables and arrays, globals, if/for/while/do-while/switch, ternary,
// arithmetic + bit operators, #define constants, printf/puts/putchar. It is
// deliberately NOT a full C compiler — the goal is the exam "dry run the
// fork() program" exercise, so everything it can't model fails with an error
// that names the construct and the line instead of a generic parse error.

// ------------------------------ lexer ---------------------------------------

type Tok = { t: string; v: string; line: number };

const KEYWORDS = new Set([
  "int", "pid_t", "char", "void", "long", "short", "unsigned", "signed", "const", "static", "size_t",
  "float", "double",
  "if", "else", "for", "while", "do", "switch", "case", "default", "return", "break", "continue",
  "struct", "union", "enum", "typedef", "goto",
]);

/** Tokens that may open a declaration or parameter ("const unsigned int x"). */
const TYPE_TOKENS = new Set([
  "int", "pid_t", "char", "void", "long", "short", "unsigned", "signed", "const", "static", "size_t",
]);
const FLOATY = new Set(["float", "double"]);

const UNSUPPORTED_KW: Record<string, string> = {
  struct: "struct isn't supported — model the data with plain int variables",
  union: "union isn't supported — model the data with plain int variables",
  enum: "enum isn't supported — use #define or plain int constants",
  typedef: "typedef isn't supported — use int/pid_t directly",
  goto: "goto isn't supported — use loops and break/continue",
};

/** One lexer pass: tokens + object-like #define macros found along the way. */
function rawLex(src: string, captureDefines: boolean): { toks: Tok[]; macros: Map<string, string> } {
  const toks: Tok[] = [];
  const macros = new Map<string, string>();
  let i = 0;
  let line = 1; // 1-based, so errors match editor gutters
  const n = src.length;
  const push = (t: string, v: string) => toks.push({ t, v, line });
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "#") {
      let dir = "";
      while (i < n && src[i] !== "\n") dir += src[i++];
      if (captureDefines) {
        const m = /^#\s*define\s+(\w+)(\()?/.exec(dir);
        if (m) {
          if (m[2])
            throw new Error(`line ${line}: #define with parameters isn't supported — inline the expression instead`);
          const rest = dir.slice(dir.indexOf(m[1]) + m[1].length);
          macros.set(m[1], rest.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim());
        }
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"') {
      let s = "";
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") {
          s += src[i] + src[i + 1];
          i += 2;
        } else {
          if (src[i] === "\n") line++;
          s += src[i++];
        }
      }
      i++;
      push("str", s);
      continue;
    }
    if (c === "'") {
      // char literal → its code point
      i++;
      let ch: number;
      if (src[i] === "\\") {
        const e = src[i + 1];
        ch = e === "n" ? 10 : e === "t" ? 9 : e === "0" ? 0 : e.charCodeAt(0);
        i += 2;
      } else {
        ch = src.charCodeAt(i);
        i++;
      }
      i++; // closing '
      push("num", String(ch));
      continue;
    }
    if (/[0-9]/.test(c)) {
      let s = "";
      while (i < n && /[0-9]/.test(src[i])) s += src[i++];
      push("num", s);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = "";
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
      push(KEYWORDS.has(s) ? s : "id", s);
      continue;
    }
    // multi-char operators
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "<<", ">>"].includes(two)) {
      push("op", two);
      i += 2;
      continue;
    }
    push("op", c);
    i++;
  }
  push("eof", "");
  return { toks, macros };
}

/** Lex with #define expansion: macro names become their (re-lexed) bodies. */
function lex(src: string): Tok[] {
  const { toks, macros } = rawLex(src, true);
  if (macros.size === 0) return toks;
  const out: Tok[] = [];
  const expand = (tk: Tok, seen: Set<string>) => {
    if (tk.t === "id" && macros.has(tk.v) && !seen.has(tk.v)) {
      const inner = rawLex(macros.get(tk.v)!, false).toks;
      const nested = new Set(seen).add(tk.v);
      for (const b of inner) if (b.t !== "eof") expand({ ...b, line: tk.line }, nested);
    } else {
      out.push(tk);
    }
  };
  for (const tk of toks) {
    if (tk.t === "eof") out.push(tk);
    else expand(tk, new Set());
  }
  return out;
}

// ------------------------------ AST -----------------------------------------

type Expr =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "str"; v: string }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "un"; op: string; a: Expr }
  | { k: "cond"; c: Expr; t: Expr; f: Expr }
  | { k: "assign"; target: Expr; op: string; e: Expr; line: number }
  | { k: "incdec"; name: string; op: string; pre: boolean }
  | { k: "index"; name: string; i: Expr; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number };

interface DeclItem {
  name: string;
  e: Expr | null;
  arr: { size: number; init: Expr[] | null } | null;
}

type Stmt =
  | { k: "decl"; items: DeclItem[] }
  | { k: "expr"; e: Expr }
  | { k: "if"; c: Expr; then: Stmt; else: Stmt | null }
  | { k: "for"; init: Stmt | null; cond: Expr | null; post: Expr | null; body: Stmt }
  | { k: "while"; c: Expr; body: Stmt }
  | { k: "dowhile"; body: Stmt; c: Expr }
  | { k: "switch"; e: Expr; cases: { v: number | null; body: Stmt[] }[] }
  | { k: "block"; body: Stmt[] }
  | { k: "return"; e: Expr | null }
  | { k: "break" }
  | { k: "continue" };

interface FuncDef {
  name: string;
  params: string[];
  body: Stmt[];
  line: number;
}

interface Program {
  functions: Map<string, FuncDef>;
  globals: Stmt[];
}

class Parser {
  private p = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  private peek(o = 0): Tok {
    return this.toks[this.p + o];
  }
  private next(): Tok {
    return this.toks[this.p++];
  }
  private eat(t: string, v?: string): Tok {
    const tok = this.toks[this.p];
    if (tok.t !== t || (v !== undefined && tok.v !== v))
      throw new Error(
        tok.t === "eof"
          ? `expected ${v ?? t} but the program ended — check for a missing brace or semicolon`
          : `line ${tok.line}: expected ${v ?? t} but found "${tok.v || tok.t}"`,
      );
    this.p++;
    return tok;
  }
  private is(t: string, v?: string): boolean {
    const tok = this.toks[this.p];
    return tok.t === t && (v === undefined || tok.v === v);
  }
  private isTypeTok(): boolean {
    return TYPE_TOKENS.has(this.peek().t);
  }

  /** Whole translation unit: function definitions and global declarations. */
  parseProgram(): Program {
    const functions = new Map<string, FuncDef>();
    const globals: Stmt[] = [];
    while (!this.is("eof")) {
      if (this.is("op", ";")) {
        this.next();
        continue;
      }
      const tok = this.peek();
      if (UNSUPPORTED_KW[tok.t]) throw new Error(`line ${tok.line}: ${UNSUPPORTED_KW[tok.t]}`);
      if (FLOATY.has(tok.t))
        throw new Error(`line ${tok.line}: ${tok.t} isn't supported — the simulator models int values only`);
      if (!this.isTypeTok())
        throw new Error(
          `line ${tok.line}: unexpected "${tok.v || tok.t}" at top level — expected a function definition or a global variable declaration`,
        );
      this.typePrefix();
      while (this.is("op", "*")) this.next();
      const nameTok = this.eat("id");
      if (this.is("op", "(")) {
        const params = this.paramList();
        if (this.is("op", ";")) {
          this.next(); // prototype — the definition will follow
          continue;
        }
        if (functions.has(nameTok.v)) throw new Error(`line ${nameTok.line}: ${nameTok.v}() is defined twice`);
        functions.set(nameTok.v, { name: nameTok.v, params, body: this.block().body, line: nameTok.line });
      } else {
        globals.push(this.declTail(nameTok.v, true));
      }
    }
    if (!functions.has("main")) throw new Error("no main() function found — the simulator starts from int main()");
    return { functions, globals };
  }

  /** Consume one-or-more type/qualifier tokens ("const unsigned int"). */
  private typePrefix(): void {
    let saw = false;
    for (;;) {
      const t = this.peek();
      if (FLOATY.has(t.t))
        throw new Error(`line ${t.line}: ${t.t} isn't supported — the simulator models int values only`);
      if (!TYPE_TOKENS.has(t.t)) break;
      this.next();
      saw = true;
    }
    if (!saw) {
      const t = this.peek();
      throw new Error(`line ${t.line}: expected a type but found "${t.v || t.t}"`);
    }
  }

  private paramList(): string[] {
    this.eat("op", "(");
    const params: string[] = [];
    if (this.is("void") && this.peek(1).t === "op" && this.peek(1).v === ")") this.next(); // (void)
    while (!this.is("op", ")")) {
      const t = this.peek();
      if (FLOATY.has(t.t))
        throw new Error(`line ${t.line}: ${t.t} isn't supported — the simulator models int values only`);
      if (!TYPE_TOKENS.has(t.t))
        throw new Error(`line ${t.line}: expected a parameter type but found "${t.v || t.t}"`);
      this.typePrefix();
      while (this.is("op", "*")) this.next();
      // the name is optional in a prototype: int helper(int);
      const name = this.is("id") ? this.eat("id") : null;
      if (this.is("op", "["))
        throw new Error(
          `line ${(name ?? t).line}: array parameters aren't supported — arrays can't be passed to functions yet`,
        );
      params.push(name ? name.v : `__p${params.length}`);
      if (this.is("op", ",")) this.next();
    }
    this.eat("op", ")");
    return params;
  }

  private block(): Stmt & { k: "block" } {
    this.eat("op", "{");
    const body: Stmt[] = [];
    while (!this.is("op", "}") && !this.is("eof")) body.push(this.statement());
    this.eat("op", "}");
    return { k: "block", body };
  }

  private statement(): Stmt {
    const tok = this.peek();
    if (UNSUPPORTED_KW[tok.t]) throw new Error(`line ${tok.line}: ${UNSUPPORTED_KW[tok.t]}`);
    if (FLOATY.has(tok.t))
      throw new Error(`line ${tok.line}: ${tok.t} isn't supported — the simulator models int values only`);
    if (this.is("case") || this.is("default"))
      throw new Error(`line ${tok.line}: "${tok.t}" label outside of a switch block`);
    if (this.is("op", "{")) return this.block();
    if (this.isTypeTok()) return this.declaration();
    if (this.is("if")) return this.ifStmt();
    if (this.is("for")) return this.forStmt();
    if (this.is("while")) return this.whileStmt();
    if (this.is("do")) return this.doWhileStmt();
    if (this.is("switch")) return this.switchStmt();
    if (this.is("return")) {
      this.next();
      let e: Expr | null = null;
      if (!this.is("op", ";")) e = this.expr();
      this.eat("op", ";");
      return { k: "return", e };
    }
    if (this.is("break")) {
      this.next();
      this.eat("op", ";");
      return { k: "break" };
    }
    if (this.is("continue")) {
      this.next();
      this.eat("op", ";");
      return { k: "continue" };
    }
    const e = this.expr();
    this.eat("op", ";");
    return { k: "expr", e };
  }

  private declaration(): Stmt {
    this.typePrefix();
    while (this.is("op", "*")) this.next();
    return this.declTail(this.eat("id").v, true);
  }

  /** The rest of a declaration once the type and first name are consumed. */
  private declTail(firstName: string, eatSemi: boolean): Stmt {
    const items: DeclItem[] = [];
    let name = firstName;
    for (;;) {
      let e: Expr | null = null;
      let arr: DeclItem["arr"] = null;
      if (this.is("op", "[")) {
        const open = this.next();
        let size: number | null = null;
        if (!this.is("op", "]")) {
          if (!this.is("num"))
            throw new Error(`line ${open.line}: the size of array "${name}" must be a number literal`);
          size = Number(this.next().v);
        }
        this.eat("op", "]");
        let init: Expr[] | null = null;
        if (this.is("op", "=")) {
          this.next();
          this.eat("op", "{");
          init = [];
          while (!this.is("op", "}")) {
            init.push(this.assignExpr());
            if (this.is("op", ",")) this.next();
          }
          this.eat("op", "}");
        }
        if (size === null && init === null)
          throw new Error(`line ${open.line}: array "${name}" needs a size or an { … } initializer`);
        if (size !== null && init && init.length > size)
          throw new Error(`line ${open.line}: more initializers than the size of "${name}" (${size})`);
        arr = { size: size ?? init!.length, init };
      } else if (this.is("op", "=")) {
        this.next();
        e = this.assignExpr();
      }
      items.push({ name, e, arr });
      if (this.is("op", ",")) {
        this.next();
        while (this.is("op", "*")) this.next();
        name = this.eat("id").v;
        continue;
      }
      break;
    }
    if (eatSemi) this.eat("op", ";");
    return { k: "decl", items };
  }

  private ifStmt(): Stmt {
    this.next();
    this.eat("op", "(");
    const c = this.expr();
    this.eat("op", ")");
    const then = this.statement();
    let els: Stmt | null = null;
    if (this.is("else")) {
      this.next();
      els = this.statement();
    }
    return { k: "if", c, then, else: els };
  }

  private forStmt(): Stmt {
    this.next();
    this.eat("op", "(");
    let init: Stmt | null = null;
    if (!this.is("op", ";")) {
      if (this.isTypeTok()) {
        this.typePrefix();
        while (this.is("op", "*")) this.next();
        init = this.declTail(this.eat("id").v, false);
      } else {
        init = { k: "expr", e: this.expr() };
      }
    }
    this.eat("op", ";");
    const cond = this.is("op", ";") ? null : this.expr();
    this.eat("op", ";");
    const post = this.is("op", ")") ? null : this.expr();
    this.eat("op", ")");
    const body = this.statement();
    return { k: "for", init, cond, post, body };
  }

  private whileStmt(): Stmt {
    this.next();
    this.eat("op", "(");
    const c = this.expr();
    this.eat("op", ")");
    const body = this.statement();
    return { k: "while", c, body };
  }

  private doWhileStmt(): Stmt {
    this.next();
    const body = this.statement();
    this.eat("while");
    this.eat("op", "(");
    const c = this.expr();
    this.eat("op", ")");
    this.eat("op", ";");
    return { k: "dowhile", body, c };
  }

  private switchStmt(): Stmt {
    this.next();
    this.eat("op", "(");
    const e = this.expr();
    this.eat("op", ")");
    this.eat("op", "{");
    const cases: { v: number | null; body: Stmt[] }[] = [];
    while (!this.is("op", "}") && !this.is("eof")) {
      if (this.is("case")) {
        const line = this.next().line;
        let sign = 1;
        if (this.is("op", "-")) {
          this.next();
          sign = -1;
        }
        if (!this.is("num")) throw new Error(`line ${line}: case labels must be number or char literals`);
        cases.push({ v: sign * Number(this.next().v), body: [] });
        this.eat("op", ":");
      } else if (this.is("default")) {
        this.next();
        this.eat("op", ":");
        cases.push({ v: null, body: [] });
      } else {
        if (cases.length === 0) {
          const t = this.peek();
          throw new Error(`line ${t.line}: statements inside switch must come after a case or default label`);
        }
        cases[cases.length - 1].body.push(this.statement());
      }
    }
    this.eat("op", "}");
    return { k: "switch", e, cases };
  }

  // expression precedence (C order): assign → ternary → || → && → | → ^ → &
  // → equality → relational → shift → additive → multiplicative → unary
  private expr(): Expr {
    return this.assignExpr();
  }
  private assignExpr(): Expr {
    const left = this.ternary();
    if (
      (left.k === "var" || left.k === "index") &&
      (this.is("op", "=") || this.is("op", "+=") || this.is("op", "-=") || this.is("op", "*=") || this.is("op", "/="))
    ) {
      const opTok = this.next();
      const e = this.assignExpr();
      return { k: "assign", target: left, op: opTok.v, e, line: opTok.line };
    }
    return left;
  }
  private ternary(): Expr {
    const c = this.or();
    if (this.is("op", "?")) {
      this.next();
      const t = this.assignExpr();
      this.eat("op", ":");
      const f = this.assignExpr();
      return { k: "cond", c, t, f };
    }
    return c;
  }
  private or(): Expr {
    let a = this.and();
    while (this.is("op", "||")) {
      this.next();
      a = { k: "bin", op: "||", a, b: this.and() };
    }
    return a;
  }
  private and(): Expr {
    let a = this.bitor();
    while (this.is("op", "&&")) {
      this.next();
      a = { k: "bin", op: "&&", a, b: this.bitor() };
    }
    return a;
  }
  private bitor(): Expr {
    let a = this.bitxor();
    while (this.is("op", "|")) {
      this.next();
      a = { k: "bin", op: "|", a, b: this.bitxor() };
    }
    return a;
  }
  private bitxor(): Expr {
    let a = this.bitand();
    while (this.is("op", "^")) {
      this.next();
      a = { k: "bin", op: "^", a, b: this.bitand() };
    }
    return a;
  }
  private bitand(): Expr {
    let a = this.equality();
    while (this.is("op", "&")) {
      this.next();
      a = { k: "bin", op: "&", a, b: this.equality() };
    }
    return a;
  }
  private equality(): Expr {
    let a = this.rel();
    while (this.is("op", "==") || this.is("op", "!=")) {
      const op = this.next().v;
      a = { k: "bin", op, a, b: this.rel() };
    }
    return a;
  }
  private rel(): Expr {
    let a = this.shift();
    while (this.is("op", "<") || this.is("op", ">") || this.is("op", "<=") || this.is("op", ">=")) {
      const op = this.next().v;
      a = { k: "bin", op, a, b: this.shift() };
    }
    return a;
  }
  private shift(): Expr {
    let a = this.add();
    while (this.is("op", "<<") || this.is("op", ">>")) {
      const op = this.next().v;
      a = { k: "bin", op, a, b: this.add() };
    }
    return a;
  }
  private add(): Expr {
    let a = this.mul();
    while (this.is("op", "+") || this.is("op", "-")) {
      const op = this.next().v;
      a = { k: "bin", op, a, b: this.mul() };
    }
    return a;
  }
  private mul(): Expr {
    let a = this.unary();
    while (this.is("op", "*") || this.is("op", "/") || this.is("op", "%")) {
      const op = this.next().v;
      a = { k: "bin", op, a, b: this.unary() };
    }
    return a;
  }
  private unary(): Expr {
    if (this.is("op", "!") || this.is("op", "-")) {
      const op = this.next().v;
      return { k: "un", op, a: this.unary() };
    }
    if (this.is("op", "+")) {
      this.next(); // unary plus is a no-op
      return this.unary();
    }
    if (this.is("op", "&")) {
      // address-of, so wait(&status) / waitpid(pid, &status, 0) parse; the
      // compiler gives it meaning only in those status-slot positions
      this.next();
      return { k: "un", op: "&", a: this.unary() };
    }
    if (this.is("op", "*")) {
      const t = this.peek();
      throw new Error(
        `line ${t.line}: pointer dereference (*) isn't supported — the simulator has no pointers beyond &status`,
      );
    }
    if (this.is("op", "++") || this.is("op", "--")) {
      const op = this.next().v;
      const name = this.eat("id").v;
      return { k: "incdec", name, op, pre: true };
    }
    return this.postfix();
  }
  private postfix(): Expr {
    let e = this.primary();
    while (this.is("op", "[")) {
      const line = this.peek().line;
      if (e.k !== "var")
        throw new Error(`line ${line}: [ ] indexing is only supported directly on a named array`);
      this.next();
      const i = this.expr();
      this.eat("op", "]");
      e = { k: "index", name: e.name, i, line };
    }
    if (this.is("op", "++") || this.is("op", "--")) {
      const opTok = this.peek();
      if (e.k === "var") {
        this.next();
        return { k: "incdec", name: e.name, op: opTok.v, pre: false };
      }
      if (e.k === "index")
        throw new Error(`line ${opTok.line}: ${opTok.v} on array elements isn't supported — use a[i] = a[i] + 1`);
    }
    return e;
  }
  private primary(): Expr {
    if (this.is("num")) return { k: "num", v: Number(this.next().v) };
    if (this.is("str")) return { k: "str", v: this.next().v };
    if (this.is("op", "(")) {
      this.next();
      const e = this.expr();
      this.eat("op", ")");
      return e;
    }
    if (this.is("id")) {
      const tok = this.next();
      if (this.is("op", "(")) {
        this.next();
        const args: Expr[] = [];
        while (!this.is("op", ")")) {
          args.push(this.assignExpr());
          if (this.is("op", ",")) this.next();
        }
        this.eat("op", ")");
        return { k: "call", name: tok.v, args, line: tok.line };
      }
      return { k: "var", name: tok.v };
    }
    const tok = this.peek();
    throw new Error(
      tok.t === "eof"
        ? "the program ended mid-expression — check for a missing brace or value"
        : `line ${tok.line}: unexpected "${tok.v || tok.t}" in an expression`,
    );
  }
}

export type { Stmt, Expr, DeclItem, FuncDef, Program };
export { lex, Parser };
