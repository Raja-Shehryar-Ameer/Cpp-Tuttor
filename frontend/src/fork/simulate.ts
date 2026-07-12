// A tiny C-subset interpreter that models fork()/exit()/wait() so a program's
// PROCESS TREE and one valid output ordering can be shown — the classic exam
// "dry run the fork() program" exercise. It is not a full C compiler: it runs
// the body of main() and understands int variables, printf, fork, exit,
// wait/waitpid, getpid/getppid, for/while/if, and integer arithmetic. That
// covers the shape of these questions without pretending to run arbitrary C.

// ------------------------------ lexer ---------------------------------------

type Tok = { t: string; v: string; line: number };

const KEYWORDS = new Set(["int", "pid_t", "char", "void", "if", "else", "for", "while", "return", "break", "continue"]);

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
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
      while (i < n && src[i] !== "\n") i++; // preprocessor line — skip
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
    if (["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/="].includes(two)) {
      push("op", two);
      i += 2;
      continue;
    }
    push("op", c);
    i++;
  }
  push("eof", "");
  return toks;
}

// ------------------------------ AST -----------------------------------------

type Expr =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "str"; v: string }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "un"; op: string; a: Expr }
  | { k: "assign"; name: string; op: string; e: Expr }
  | { k: "incdec"; name: string; op: string; pre: boolean }
  | { k: "call"; name: string; args: Expr[] };

type Stmt =
  | { k: "decl"; items: { name: string; e: Expr | null }[] }
  | { k: "expr"; e: Expr }
  | { k: "if"; c: Expr; then: Stmt; else: Stmt | null }
  | { k: "for"; init: Stmt | null; cond: Expr | null; post: Expr | null; body: Stmt }
  | { k: "while"; c: Expr; body: Stmt }
  | { k: "block"; body: Stmt[] }
  | { k: "return"; e: Expr | null }
  | { k: "break" }
  | { k: "continue" };

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

  /** Find `main` and parse its body; ignore everything else at top level. */
  parseMain(): Stmt[] {
    while (!this.is("eof")) {
      if (this.is("id", "main")) {
        this.next(); // main
        this.eat("op", "(");
        while (!this.is("op", ")")) this.next();
        this.eat("op", ")");
        const block = this.block();
        return block.body;
      }
      this.next();
    }
    throw new Error("no main() function found — the simulator starts from int main()");
  }

  private block(): Stmt & { k: "block" } {
    this.eat("op", "{");
    const body: Stmt[] = [];
    while (!this.is("op", "}") && !this.is("eof")) body.push(this.statement());
    this.eat("op", "}");
    return { k: "block", body };
  }

  private isTypeKw(): boolean {
    return this.is("int") || this.is("pid_t") || this.is("char");
  }

  private statement(): Stmt {
    if (this.is("op", "{")) return this.block();
    if (this.isTypeKw()) return this.declaration();
    if (this.is("if")) return this.ifStmt();
    if (this.is("for")) return this.forStmt();
    if (this.is("while")) return this.whileStmt();
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
    this.next(); // type
    const items: { name: string; e: Expr | null }[] = [];
    do {
      // allow pointer stars / ignore
      while (this.is("op", "*")) this.next();
      const name = this.eat("id").v;
      let e: Expr | null = null;
      if (this.is("op", "=")) {
        this.next();
        e = this.assignExpr();
      }
      items.push({ name, e });
    } while (this.is("op", ",") && this.next());
    this.eat("op", ";");
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
      init = this.isTypeKw() ? this.declNoSemi() : { k: "expr", e: this.expr() };
    }
    this.eat("op", ";");
    const cond = this.is("op", ";") ? null : this.expr();
    this.eat("op", ";");
    const post = this.is("op", ")") ? null : this.expr();
    this.eat("op", ")");
    const body = this.statement();
    return { k: "for", init, cond, post, body };
  }

  private declNoSemi(): Stmt {
    this.next(); // type
    const items: { name: string; e: Expr | null }[] = [];
    do {
      while (this.is("op", "*")) this.next();
      const name = this.eat("id").v;
      let e: Expr | null = null;
      if (this.is("op", "=")) {
        this.next();
        e = this.assignExpr();
      }
      items.push({ name, e });
    } while (this.is("op", ",") && this.next());
    return { k: "decl", items };
  }

  private whileStmt(): Stmt {
    this.next();
    this.eat("op", "(");
    const c = this.expr();
    this.eat("op", ")");
    const body = this.statement();
    return { k: "while", c, body };
  }

  // expression precedence -----------------------------------------------------
  private expr(): Expr {
    return this.assignExpr();
  }
  private assignExpr(): Expr {
    const left = this.or();
    if (
      left.k === "var" &&
      (this.is("op", "=") || this.is("op", "+=") || this.is("op", "-=") || this.is("op", "*=") || this.is("op", "/="))
    ) {
      const op = this.next().v;
      const e = this.assignExpr();
      return { k: "assign", name: left.name, op, e };
    }
    return left;
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
    let a = this.equality();
    while (this.is("op", "&&")) {
      this.next();
      a = { k: "bin", op: "&&", a, b: this.equality() };
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
    let a = this.add();
    while (this.is("op", "<") || this.is("op", ">") || this.is("op", "<=") || this.is("op", ">=")) {
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
    if (this.is("op", "++") || this.is("op", "--")) {
      const op = this.next().v;
      const name = this.eat("id").v;
      return { k: "incdec", name, op, pre: true };
    }
    return this.postfix();
  }
  private postfix(): Expr {
    const e = this.primary();
    if (e.k === "var" && (this.is("op", "++") || this.is("op", "--"))) {
      const op = this.next().v;
      return { k: "incdec", name: e.name, op, pre: false };
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
      const name = this.next().v;
      if (this.is("op", "(")) {
        this.next();
        const args: Expr[] = [];
        while (!this.is("op", ")")) {
          args.push(this.assignExpr());
          if (this.is("op", ",")) this.next();
        }
        this.eat("op", ")");
        return { k: "call", name, args };
      }
      return { k: "var", name };
    }
    const tok = this.peek();
    throw new Error(
      tok.t === "eof"
        ? "the program ended mid-expression — check for a missing brace or value"
        : `line ${tok.line}: unexpected "${tok.v || tok.t}" in an expression`,
    );
  }
}

export type { Stmt, Expr };
export { lex, Parser };
