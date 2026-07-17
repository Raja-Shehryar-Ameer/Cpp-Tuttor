// Detailed tests for the fork() process-tree simulator.
// Run: node --experimental-strip-types frontend/tests/fork.test.ts
//
// Two layers:
//  1. deterministic exam-style programs with hand-derived ground truth —
//     tree shape, pids/ppids, zombie and orphan classification, wait()
//     reaping, output ordering, exit statuses;
//  2. structural invariants checked on EVERY simulation (tree consistency,
//     label/pid scheme, zombie/orphan exclusivity, output accounting) plus a
//     300-program random fuzzer built from always-terminating fragments.

import { simulateFork, type ProcNode, type SimResult } from "../src/fork/vm.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const eq = (got: unknown, want: unknown, label: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(label, { got, want });
};
const ok = (cond: boolean, label: string, ...ctx: unknown[]) => {
  if (!cond) fail(label, ...ctx);
};

const byLabel = (r: SimResult, label: string): ProcNode => {
  const p = r.processes.find((q) => q.label === label);
  if (!p) throw new Error(`no process ${label}`);
  return p;
};
const zombies = (r: SimResult) => r.processes.filter((p) => p.zombie).map((p) => p.label);
const orphans = (r: SimResult) => r.processes.filter((p) => p.reparented).map((p) => p.label);

/** Invariants every simulation must satisfy, whatever the program. */
function checkInvariants(r: SimResult, label: string): void {
  if (r.error !== null) { fail(`${label}: unexpected error`, r.error); return; }
  const ps = r.processes;
  if (ps.length === 0) { fail(`${label}: no processes`); return; }
  const byId = new Map(ps.map((p) => [p.id, p]));

  const root = ps[0];
  ok(root.id === 0 && root.parentId === null && root.ppid === 1, `${label}: P0 is the root under PID 1`, root);
  ok(!root.zombie && !root.reparented, `${label}: the root can be neither zombie nor orphan`);

  for (const p of ps) {
    ok(p.label === `P${p.id}`, `${label}: label scheme`, p.label, p.id);
    ok(p.pid === 1000 + p.id, `${label}: pid scheme`, p.pid, p.id);
    ok(p.exitStatus === null || (p.exitStatus >= 0 && p.exitStatus <= 255),
      `${label}: exit status outside 0..255`, p.exitStatus);
    if (p.parentId !== null) {
      const parent = byId.get(p.parentId);
      if (!parent) { fail(`${label}: dangling parentId`, p.id); continue; }
      ok(parent.childIds.includes(p.id), `${label}: parent/child link asymmetric`, p.id);
      ok(p.ppid === parent.pid, `${label}: ppid disagrees with parent`, p.id);
      ok(parent.id < p.id, `${label}: child born before its parent`, p.id);
    }
    const sorted = [...p.childIds].sort((a, b) => a - b);
    ok(JSON.stringify(sorted) === JSON.stringify(p.childIds) && new Set(p.childIds).size === p.childIds.length,
      `${label}: childIds not ascending/unique`, p.childIds);
    for (const c of p.childIds) ok(byId.get(c)?.parentId === p.id, `${label}: childIds points at a non-child`, p.id, c);
    ok(!(p.zombie && p.reparented), `${label}: zombie and orphan are mutually exclusive`, p.id);
    if (p.zombie) {
      ok(p.exitStatus !== null, `${label}: a zombie must have exited`, p.id);
      const parent = byId.get(p.parentId!)!;
      ok(parent !== undefined, `${label}: zombie without parent`, p.id);
    }
    if (p.reparented) {
      const parent = byId.get(p.parentId!)!;
      ok(parent.exitStatus !== null, `${label}: orphan whose parent never died`, p.id);
    }
  }
  eq(r.systemdAdopted, ps.filter((p) => p.reparented).map((p) => p.id), `${label}: systemdAdopted list`);
  const perProc = ps.reduce((n, p) => n + p.output.length, 0);
  eq(perProc, r.output.length, `${label}: global output length != sum of per-process output`);
}

function sim(label: string, src: string): SimResult {
  const r = simulateFork(src);
  checkInvariants(r, label);
  return r;
}

// ============================ tree shape =====================================

{
  const r = sim("no-fork", 'int main() { printf("hi\\n"); return 0; }');
  eq(r.processes.length, 1, "no-fork: exactly one process");
  eq(r.output, "hi\n", "no-fork: output");
  eq(r.processes[0].exitStatus, 0, "no-fork: exit status");
}

{
  const r = sim("single-fork", "int main() { fork(); return 0; }");
  eq(r.processes.length, 2, "single-fork: two processes");
  eq(byLabel(r, "P0").childIds, [1], "single-fork: P0 owns P1");
}

{
  // the classic: fork(); fork(); → 4 processes, P1 re-runs the second fork
  const r = sim("double-fork", "int main() { fork(); fork(); return 0; }");
  eq(r.processes.length, 4, "double-fork: 4 processes");
  eq(byLabel(r, "P0").childIds, [1, 2], "double-fork: P0's children");
  eq(byLabel(r, "P1").childIds, [3], "double-fork: P1 forks once more");
  eq(byLabel(r, "P2").childIds, [], "double-fork: P2 is a leaf");
}

{
  // fork() in a 3-iteration loop → 2^3 = 8 processes, binomial tree
  const r = sim("loop-fork", "int main() { for (int i = 0; i < 3; i++) { fork(); } return 0; }");
  eq(r.processes.length, 8, "loop-fork: 2^3 processes");
  eq(byLabel(r, "P0").childIds.length, 3, "loop-fork: root forks 3 times");
  eq(byLabel(r, "P1").childIds.length, 2, "loop-fork: i=0 child continues the loop twice");
  const leaves = r.processes.filter((p) => p.childIds.length === 0).length;
  eq(leaves, 4, "loop-fork: binomial tree has 4 leaves");
}

{
  // fork() && fork(): child short-circuits (0), parent evaluates both → 3
  const r = sim("fork-and", "int main() { fork() && fork(); return 0; }");
  eq(r.processes.length, 3, "fork&&fork: 3 processes");
  eq(byLabel(r, "P0").childIds, [1, 2], "fork&&fork: both children belong to the root");
  eq(byLabel(r, "P1").childIds, [], "fork&&fork: the first child stops at &&");
}

{
  // fork() || fork(): parent short-circuits (pid ≠ 0), child forks again → 3
  const r = sim("fork-or", "int main() { fork() || fork(); return 0; }");
  eq(r.processes.length, 3, "fork||fork: 3 processes");
  eq(byLabel(r, "P0").childIds, [1], "fork||fork: root forks once");
  eq(byLabel(r, "P1").childIds, [2], "fork||fork: the child forks the third");
}

{
  // descend-only chain: each generation forks exactly once
  const r = sim("chain", `
    int main() {
      if (fork() == 0) { if (fork() == 0) { if (fork() == 0) { } } }
      return 0;
    }`);
  eq(r.processes.length, 4, "chain: 4 generations");
  for (const [parent, kid] of [["P0", 1], ["P1", 2], ["P2", 3]] as const) {
    eq(byLabel(r, parent).childIds, [kid], `chain: ${parent} → P${kid}`);
  }
}

{
  // break stops the forking loop in parent AND child
  const r = sim("loop-break", "int main() { for (int i = 0; i < 5; i++) { fork(); break; } return 0; }");
  eq(r.processes.length, 2, "loop-break: only one fork happens");
}

{
  // while (fork() == 0): every child loops and forks again, parents leave
  const r = sim("while-chain", "int main() { int n = 0; while (fork() == 0 && n < 3) { n = n + 1; } return 0; }");
  eq(r.processes.length, 5, "while-chain: P0..P4");
  for (let i = 0; i < 4; i++) {
    eq(byLabel(r, `P${i}`).childIds, [i + 1], `while-chain: P${i} forks P${i + 1}`);
  }
}

// ============================ pids and ppids =================================

{
  const r = sim("pid-values", `
    int main() {
      int pid = fork();
      if (pid == 0) { printf("c %d %d\\n", getpid(), getppid()); }
      else { printf("p %d\\n", pid); wait(0); }
      return 0;
    }`);
  eq(r.output, "p 1001\nc 1001 1000\n", "pid-values: parent sees child pid; child sees own pid and ppid");
  eq(zombies(r), [], "pid-values: reaped, no zombie");
}

{
  // fork() straight inside printf: parent prints the pid, the child prints 0
  const r = sim("fork-in-printf", 'int main() { printf("%d\\n", fork()); return 0; }');
  eq(r.processes.length, 2, "fork-in-printf: 2 processes");
  eq(r.output, "1001\n0\n", "fork-in-printf: parent prints pid, child prints 0");
}

// ============================ zombies ========================================

{
  // child exits while the parent naps and NEVER waits → zombie sticks
  const r = sim("zombie-basic", `
    int main() {
      if (fork() == 0) { exit(0); }
      sleep(1);
      printf("parent done\\n");
      return 0;
    }`);
  eq(zombies(r), ["P1"], "zombie-basic: the child is a zombie");
  eq(orphans(r), [], "zombie-basic: no orphans");
  ok(r.notes.some((n) => n.includes("zombie")), "zombie-basic: zombie note shown");
}

{
  // zombie during the nap, but a later wait() reaps it → flag cleared
  const r = sim("zombie-reaped", `
    int main() {
      if (fork() == 0) { exit(3); }
      sleep(1);
      int got = wait(0);
      printf("reaped %d\\n", got);
      return 0;
    }`);
  eq(zombies(r), [], "zombie-reaped: reaping clears the zombie");
  eq(byLabel(r, "P1").exitStatus, 3, "zombie-reaped: child exit status kept");
  ok(r.output.includes("reaped 1001"), "zombie-reaped: wait() returned the child pid", r.output);
  ok(!r.notes.some((n) => n.includes("zombie")), "zombie-reaped: no zombie note");
}

{
  // parent blocks in wait() BEFORE the child dies → reaped instantly, never a zombie
  const r = sim("wait-first", `
    int main() {
      if (fork() == 0) { printf("child\\n"); exit(0); }
      int got = wait(0);
      printf("got %d\\n", got);
      return 0;
    }`);
  eq(zombies(r), [], "wait-first: no zombie when the parent is already waiting");
  eq(r.output, "child\ngot 1001\n", "wait-first: output ordering");
}

{
  // two children, ONE wait: first reaped, second left to rot
  const r = sim("two-kids-one-wait", `
    int main() {
      if (fork() == 0) { exit(0); }
      if (fork() == 0) { exit(0); }
      wait(0);
      sleep(1);
      printf("end\\n");
      return 0;
    }`);
  eq(zombies(r), ["P2"], "two-kids-one-wait: exactly the unwaited child is a zombie");
  ok(!byLabel(r, "P1").zombie, "two-kids-one-wait: the waited child is clean");
}

{
  // reap-all loop: while (wait(0) > 0); → every child collected
  const r = sim("reap-all", `
    int main() {
      for (int i = 0; i < 3; i = i + 1) { if (fork() == 0) { exit(i); } }
      while (wait(0) > 0) { }
      printf("all reaped\\n");
      return 0;
    }`);
  eq(r.processes.length, 4, "reap-all: 3 children");
  eq(zombies(r), [], "reap-all: nothing left unreaped");
  eq(r.processes.slice(1).map((p) => p.exitStatus), [0, 1, 2], "reap-all: children carry their exit codes");
  ok(r.output.includes("all reaped"), "reap-all: loop terminated via wait() == -1");
}

{
  const r = sim("wait-no-children", 'int main() { int got = wait(0); printf("%d\\n", got); return 0; }');
  eq(r.output, "-1\n", "wait-no-children: wait() returns -1 (ECHILD)");
}

{
  // waitpid() is accepted as an alias for wait()
  const r = sim("waitpid-alias", `
    int main() {
      if (fork() == 0) { exit(9); }
      waitpid(-1, 0, 0);
      return 0;
    }`);
  eq(zombies(r), [], "waitpid-alias: reaps like wait()");
  eq(byLabel(r, "P1").exitStatus, 9, "waitpid-alias: child status");
}

// ============================ orphans ========================================

{
  // parent exits while the child naps → adopted by PID 1, getppid() says so
  const r = sim("orphan-basic", `
    int main() {
      if (fork() == 0) {
        sleep(2);
        printf("ppid %d\\n", getppid());
        exit(0);
      }
      printf("parent exits\\n");
      return 0;
    }`);
  eq(orphans(r), ["P1"], "orphan-basic: the survivor is an orphan");
  eq(zombies(r), [], "orphan-basic: no zombies");
  eq(r.systemdAdopted, [1], "orphan-basic: adopted list");
  ok(r.output.includes("ppid 1\n"), "orphan-basic: getppid() returns 1 after adoption", r.output);
  ok(r.notes.some((n) => n.includes("orphan")), "orphan-basic: orphan note shown");
}

{
  // the daemon double-fork: middle child exits at once, grandchild is adopted,
  // the launcher reaps the middle child so nothing is left a zombie
  const r = sim("daemon-double-fork", `
    int main() {
      if (fork() == 0) {
        if (fork() == 0) {
          sleep(2);
          printf("daemon ppid %d\\n", getppid());
          exit(0);
        }
        exit(0);
      }
      wait(0);
      printf("launcher done\\n");
      return 0;
    }`);
  eq(orphans(r), ["P2"], "daemon: only the grandchild is orphaned");
  eq(zombies(r), [], "daemon: middle child was reaped, orphan exits silently to init");
  eq(byLabel(r, "P1").childIds, [2], "daemon: grandchild hangs under the middle child in the tree");
  const launcher = r.output.indexOf("launcher done");
  const daemon = r.output.indexOf("daemon ppid 1");
  ok(launcher >= 0 && daemon > launcher, "daemon: launcher returns before the daemon speaks", r.output);
}

{
  // an orphan's OWN exit is silent: reparented stays, zombie must not appear
  const r = sim("orphan-exits", `
    int main() {
      if (fork() == 0) { sleep(2); exit(7); }
      return 0;
    }`);
  const kid = byLabel(r, "P1");
  ok(kid.reparented && !kid.zombie, "orphan-exits: init reaps orphans silently", kid);
  eq(kid.exitStatus, 7, "orphan-exits: status still recorded");
}

// ============================ memory semantics ===============================

{
  // fork() copies variables — the child's writes never leak into the parent
  const r = sim("var-isolation", `
    int main() {
      int x = 5;
      if (fork() == 0) { x = x + 1; printf("child x %d\\n", x); exit(0); }
      sleep(1);
      printf("parent x %d\\n", x);
      return 0;
    }`);
  eq(r.output, "child x 6\nparent x 5\n", "var-isolation: separate address spaces");
}

{
  // loop counter is cloned mid-loop: i=1 child performs exactly one more fork
  const r = sim("counter-clone", `
    int main() {
      for (int i = 0; i < 2; i++) { fork(); }
      return 0;
    }`);
  eq(r.processes.length, 4, "counter-clone: 4 processes");
  eq(byLabel(r, "P1").childIds.length, 1, "counter-clone: i=0 child forks once more");
  eq(byLabel(r, "P2").childIds.length, 0, "counter-clone: i=1 child is done");
}

// ============================ exit statuses ==================================

{
  const r = sim("exit-masking", `
    int main() {
      if (fork() == 0) { exit(300); }
      if (fork() == 0) { exit(-1); }
      if (fork() == 0) { exit(256); }
      while (wait(0) > 0) { }
      return 0;
    }`);
  eq(byLabel(r, "P1").exitStatus, 44, "exit-masking: exit(300) reads back as 300 & 0xff");
  eq(byLabel(r, "P2").exitStatus, 255, "exit-masking: exit(-1) reads back as 255");
  eq(byLabel(r, "P3").exitStatus, 0, "exit-masking: exit(256) reads back as 0");
}

// ============================ output ordering ================================

{
  // deterministic interleaving: parent A, naps; child B, dies; parent C
  const r = sim("sleep-ordering", `
    int main() {
      if (fork() == 0) { printf("B"); exit(0); }
      printf("A");
      sleep(1);
      printf("C");
      return 0;
    }`);
  eq(r.output, "ABC", "sleep-ordering: sleeper yields to the child");
  eq(byLabel(r, "P0").output, "AC", "sleep-ordering: per-process output kept apart");
  eq(byLabel(r, "P1").output, "B", "sleep-ordering: child owns its line");
}

// ============================ robustness =====================================

{
  // fork bomb: capped at 100 processes with an explanatory note, still returns
  const r = simulateFork("int main() { while (1) { fork(); } return 0; }");
  eq(r.error, null, "fork-bomb: no crash");
  eq(r.processes.length, 100, "fork-bomb: process cap enforced");
  ok(r.notes.some((n) => n.includes("Process cap")), "fork-bomb: cap note shown");
}

{
  // once capped, fork() returns -1 like a real EAGAIN — programs can see it
  const r = simulateFork(`
    int main() {
      int failed = 0;
      for (int i = 0; i < 300; i++) { if (fork() == -1) { failed = 1; } }
      if (failed) { printf("saw EAGAIN\\n"); }
      return 0;
    }`);
  eq(r.error, null, "fork-cap-visible: no crash");
  ok(r.output.includes("saw EAGAIN"), "fork-cap-visible: fork() reports -1 after the cap");
}

{
  const r = simulateFork("int main() { fork(; }");
  ok(r.error !== null, "parse-error: reported");
  eq(r.processes.length, 0, "parse-error: no half-built tree");
}

{
  const r = simulateFork("int add(int a, int b) { return a + b; }");
  ok(r.error !== null && r.error.includes("main"), "no-main: names the problem", r.error);
}

{
  // unknown library calls are absorbed as 0, args still evaluated
  const r = sim("unknown-calls", 'int main() { srand(42); int x = rand(); printf("x %d\\n", x); return 0; }');
  eq(r.output, "x 0\n", "unknown-calls: rand() yields 0 in the model");
}

// ============================ randomized fuzz ================================
// Programs assembled from always-terminating fragments: every simulation must
// satisfy the structural invariants, never error, and never blow the cap.

function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS: ((r: () => number) => string)[] = [
  () => "fork();",
  () => "if (fork() == 0) { exit(1); }",
  () => "if (fork() == 0) { sleep(1); exit(2); }",
  () => "if (fork() > 0) { wait(0); }",
  () => "sleep(1);",
  () => "wait(0);",
  () => "while (wait(0) > 0) { }",
  () => 'printf("m %d %d\\n", getpid(), getppid());',
  (r) => `for (int i = 0; i < ${1 + Math.floor(r() * 2)}; i++) { fork(); }`,
  (r) => `if (fork() ${r() < 0.5 ? "&&" : "||"} fork()) { sleep(1); }`,
];

const seed = Number(process.env.FUZZ_SEED ?? Date.now() % 0xffffffff) >>> 0;
console.log(`fuzz seed: ${seed} (reproduce with FUZZ_SEED=${seed})`);
for (let t = 0; t < 300; t += 1) {
  const rand = makeRand(seed + t);
  const parts: string[] = [];
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i += 1) parts.push(FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)](rand));
  const src = `int main() {\n  ${parts.join("\n  ")}\n  return 0;\n}`;
  const r = simulateFork(src);
  if (r.error !== null) { fail("fuzz: program failed to run", src, r.error); continue; }
  checkInvariants(r, `fuzz#${t}`);
  ok(r.processes.length <= 100, `fuzz#${t}: cap respected`);
  if (fails > 0) { console.error("offending program:\n" + src); break; }
}

console.log(fails === 0 ? "ALL PASS (30 scenario groups + invariants over 300 fuzzed programs)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
