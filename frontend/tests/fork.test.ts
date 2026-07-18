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

// ============================ targeted waitpid & statuses ====================

{
  // waitpid(pid, &s, 0) waits for THAT child even when another is already dead
  const r = sim("waitpid-targeted", `
    int main() {
      int a = fork();
      if (a == 0) { exit(5); }
      int b = fork();
      if (b == 0) { sleep(1); exit(7); }
      int s;
      waitpid(b, &s, 0);
      printf("first %d\\n", s);
      wait(&s);
      printf("second %d\\n", s);
      return 0;
    }`);
  eq(r.output, "first 1792\nsecond 1280\n", "waitpid-targeted: statuses packed as code << 8, right child first");
  eq(zombies(r), [], "waitpid-targeted: the bypassed child is reaped by the later wait()");
}

{
  // the target child already exited → immediate reap, zombie flag cleared
  const r = sim("waitpid-dead-target", `
    int main() {
      int c = fork();
      if (c == 0) { exit(2); }
      sleep(1);
      int s;
      waitpid(c, &s, 0);
      printf("code %d\\n", s / 256);
      return 0;
    }`);
  eq(r.output, "code 2\n", "waitpid-dead-target: WEXITSTATUS via s/256");
  eq(zombies(r), [], "waitpid-dead-target: reaped");
}

{
  const r = sim("waitpid-not-a-child", `
    int main() {
      int s;
      int got = waitpid(4242, &s, 0);
      printf("%d\\n", got);
      return 0;
    }`);
  eq(r.output, "-1\n", "waitpid-not-a-child: returns -1 (ECHILD)");
}

{
  // wait(&s) fills the status word: exit(3) → 3 << 8 = 768
  const r = sim("wait-status", `
    int main() {
      if (fork() == 0) { exit(3); }
      int s;
      wait(&s);
      printf("%d %d\\n", s, s / 256);
      return 0;
    }`);
  eq(r.output, "768 3\n", "wait-status: packed word and extracted exit code");
}

{
  // & outside a wait status slot degrades to 0 instead of a parse error
  const r = sim("addrof-elsewhere", 'int main() { int x = 5; int y = &x; printf("%d\\n", y); return 0; }');
  eq(r.output, "0\n", "addrof-elsewhere: address-of degrades to 0");
}

// ============================ FAST Sessional-II past paper ===================
// The full exam program: fork in a short-circuit ||, fork in a short-circuit
// &&, a child that falls through BOTH branches to return 1 (so waitpid's
// status reads 1 << 8 = 256), orphans adopted mid-run, and a zombie reaped by
// a later wait(NULL).

{
  const r = sim("fast-sessional", `
    #include <stdio.h>
    #include <stdlib.h>
    #include <unistd.h>
    #include <sys/types.h>
    #include <sys/wait.h>

    int main()
    {
        pid_t pid1, pid2, pid3, pid4, pid5;

        pid1 = fork();

        if (pid1 == 0 || (pid2 = fork()) == 0)
        {
            printf("A\\n");
            exit(0);
        }
        else
        {
            wait(NULL);

            pid3 = fork();

            if (pid3 == 0 && (pid4 = fork()) == 0)
            {
                printf("B\\n");
                exit(0);
            }
            else if (pid3 > 0)
            {
                int s;

                waitpid(pid3, &s, 0);

                printf("Status of PID3 = %d\\n", s);

                pid5 = fork();

                if (pid5 == 0)
                {
                    printf("C\\n");
                    exit(0);
                }
                else
                {
                    wait(NULL);

                    printf("D\\n");

                    return 0;
                }
            }
        }

        return 1;
    }`);
  eq(r.processes.length, 6, "fast: 6 processes (P0..P5)");
  eq(byLabel(r, "P0").childIds, [1, 2, 3, 5], "fast: root forks P1 (pid1), P2 (||), P3 (pid3), P5 (pid5)");
  eq(byLabel(r, "P3").childIds, [4], "fast: P4 comes from the && inside P3");
  // P3: pid3==0 → && forks P4 but pid4 != 0 → false; else-if pid3>0 false in
  // the child → falls through to return 1. waitpid packs it: 1 << 8 = 256.
  eq(byLabel(r, "P3").exitStatus, 1, "fast: P3 falls through to return 1");
  ok(r.output.includes("Status of PID3 = 256"), "fast: the exam's status is 256, not 0", r.output);
  eq(r.output, "A\nA\nB\nStatus of PID3 = 256\nD\nC\n", "fast: one valid ordering, deterministic here");
  eq(zombies(r), [], "fast: P2's zombie phase ends when the last wait(NULL) reaps it");
  eq(orphans(r), ["P4", "P5"], "fast: P4 outlives P3, P5 outlives P0");
  eq(byLabel(r, "P1").exitStatus, 0, "fast: P1 exits 0");
  eq(byLabel(r, "P2").exitStatus, 0, "fast: P2 exits 0");
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

// ============================ functions ======================================

{
  const r = sim("fn-basic", `
    int square(int x) { return x * x; }
    int main() { printf("%d\\n", square(6)); return 0; }`);
  eq(r.processes.length, 1, "fn-basic: no forks");
  eq(r.output, "36\n", "fn-basic: call, param, return value");
}

{
  // fork inside a recursive helper: each generation forks exactly one child
  const r = sim("fn-fork-chain", `
    void spawn_chain(int n) {
      if (n == 0) { return; }
      if (fork() == 0) { spawn_chain(n - 1); exit(n); }
      wait(NULL);
    }
    int main() { spawn_chain(3); return 0; }`);
  eq(r.processes.length, 4, "fn-fork-chain: P0..P3");
  for (const [parent, kid] of [["P0", 1], ["P1", 2], ["P2", 3]] as const) {
    eq(byLabel(r, parent).childIds, [kid], `fn-fork-chain: ${parent} → P${kid}`);
  }
  eq(r.processes.map((p) => p.exitStatus), [0, 3, 2, 1], "fn-fork-chain: each level exits with its depth");
  eq(zombies(r), [], "fn-fork-chain: every generation reaps its child");
}

{
  const r = sim("fn-prototype", `
    int helper(int);
    int helper(int x) { return x + 1; }
    int main() { printf("%d\\n", helper(4)); return 0; }`);
  eq(r.output, "5\n", "fn-prototype: forward declaration is skipped, definition wins");
}

{
  // runaway recursion kills only that process, SIGSEGV-style
  const r = sim("fn-stack-overflow", `
    int boom(int n) { return boom(n + 1); }
    int main() { boom(0); return 0; }`);
  ok(r.notes.some((n) => n.includes("stack overflow")), "fn-stack-overflow: note names the crash", r.notes);
  eq(byLabel(r, "P0").exitStatus, 139, "fn-stack-overflow: 128 + SIGSEGV(11)");
}

// ============================ extended C subset ==============================

{
  // ternary: both sides of the fork pick a different branch
  const r = sim("ternary", `
    int main() {
      int pid = fork();
      printf("%d\\n", pid == 0 ? 111 : 222);
      if (pid != 0) { wait(NULL); }
      return 0;
    }`);
  eq(r.output, "222\n111\n", "ternary: parent 222 first, child 111 after");
}

{
  const r = sim("do-while", `
    int main() {
      int i = 0;
      do { printf("%d", i); i++; } while (i < 3);
      printf("\\n");
      return 0;
    }`);
  eq(r.output, "012\n", "do-while: body runs before the test");
}

{
  const r = sim("switch-fork", `
    int main() {
      int pid = fork();
      switch (pid == 0 ? 1 : 0) {
        case 0:
          printf("parent\\n");
          wait(NULL);
          break;
        case 1:
          printf("child\\n");
          break;
        default:
          printf("never\\n");
      }
      return 0;
    }`);
  eq(r.output, "parent\nchild\n", "switch-fork: each process takes its own case");
  eq(zombies(r), [], "switch-fork: reaped");
}

{
  const r = sim("switch-fallthrough", `
    int main() {
      switch (1) {
        case 1: printf("one ");
        case 2: printf("two "); break;
        case 3: printf("three ");
      }
      printf("end\\n");
      return 0;
    }`);
  eq(r.output, "one two end\n", "switch-fallthrough: case 1 falls into case 2, break skips 3");
}

{
  // the classic exam pattern: store fork() pids in an array, reap them in order
  const r = sim("array-pids", `
    int main() {
      int pids[3];
      for (int i = 0; i < 3; i++) {
        pids[i] = fork();
        if (pids[i] == 0) { exit(i + 10); }
      }
      int s;
      for (int i = 0; i < 3; i++) {
        waitpid(pids[i], &s, 0);
        printf("%d:%d ", i, WEXITSTATUS(s));
      }
      printf("\\n");
      return 0;
    }`);
  eq(r.processes.length, 4, "array-pids: 3 children");
  eq(r.output, "0:10 1:11 2:12 \n", "array-pids: reaped in pid order with the right exit codes");
  eq(zombies(r), [], "array-pids: all reaped");
}

{
  const r = sim("array-oob", `
    int main() {
      int a[2];
      a[5] = 1;
      printf("unreached\\n");
      return 0;
    }`);
  ok(r.notes.some((n) => n.includes("out of bounds")), "array-oob: note names the crash", r.notes);
  eq(byLabel(r, "P0").exitStatus, 139, "array-oob: SIGSEGV-style status");
  eq(r.output, "", "array-oob: execution stops at the crash");
}

{
  const r = sim("bit-ops", `
    int main() {
      printf("%d %d %d %d %d\\n", 1 << 4, 20 >> 2, 12 & 10, 12 | 3, 12 ^ 10);
      return 0;
    }`);
  eq(r.output, "16 5 8 15 6\n", "bit-ops: shift, and, or, xor with C precedence");
}

{
  // the real <sys/wait.h> macros over the packed status word
  const r = sim("wait-macros", `
    int main() {
      if (fork() == 0) { exit(7); }
      int s;
      wait(&s);
      printf("%d %d\\n", WIFEXITED(s), WEXITSTATUS(s));
      return 0;
    }`);
  eq(r.output, "1 7\n", "wait-macros: WIFEXITED true, WEXITSTATUS unpacks the code");
}

{
  const r = sim("define-macros", `
    #define KIDS 3
    #define GREET "hi %d\\n"
    int main() {
      for (int i = 0; i < KIDS; i++) {
        if (fork() == 0) { printf(GREET, i); exit(0); }
        wait(NULL);
      }
      return 0;
    }`);
  eq(r.processes.length, 4, "define-macros: KIDS expanded to 3");
  eq(r.output, "hi 0\nhi 1\nhi 2\n", "define-macros: a macro can even be the format string");
}

{
  // globals are per-process after fork — copy-on-write, not shared memory
  const r = sim("globals-cow", `
    int counter = 0;
    void bump() { counter = counter + 1; }
    int main() {
      bump();
      if (fork() == 0) { bump(); printf("child %d\\n", counter); exit(0); }
      wait(NULL);
      printf("parent %d\\n", counter);
      return 0;
    }`);
  eq(r.output, "child 2\nparent 1\n", "globals-cow: the child's write never reaches the parent");
}

{
  const r = sim("puts-putchar", `
    int main() {
      puts("hello");
      putchar(65);
      putchar(10);
      return 0;
    }`);
  eq(r.output, "hello\nA\n", "puts-putchar: newline appended, char code printed");
}

{
  // unknown functions still run but say so in the notes
  const r = sim("unknown-warns", 'int main() { int x = foo(); printf("%d\\n", x); return 0; }');
  eq(r.output, "0\n", "unknown-warns: unknown call yields 0");
  ok(r.notes.some((n) => n.includes("unknown function foo()")), "unknown-warns: warning note present", r.notes);
}

// ============================ targeted error messages ========================
// Unsupported constructs must fail with a message that names the construct
// and the line — never a generic "unexpected token".

{
  const expectError = (label: string, src: string, needle: string) => {
    const r = simulateFork(src);
    ok(r.error !== null && r.error.includes(needle), `error(${label}): says "${needle}"`, r.error);
    eq(r.processes.length, 0, `error(${label}): no half-built tree`);
  };
  expectError("struct", "struct point { int x; };\nint main() { return 0; }", "struct isn't supported");
  expectError("float", "int main() { float f = 1; return 0; }", "float isn't supported");
  expectError("define-params", "#define MAX(a,b) ((a)>(b)?(a):(b))\nint main() { return 0; }",
    "#define with parameters");
  expectError("top-level-junk", "int main() { return 0; }\nxyz;", 'unexpected "xyz" at top level');
  expectError("deref", "int main() { int x = 0; int y = *x; return 0; }", "pointer dereference");
  expectError("array-param", "void f(int a[]) { }\nint main() { return 0; }", "array parameters aren't supported");
  expectError("array-arg", "void f(int x) { }\nint main() { int a[2]; f(a); return 0; }", "arrays can't be passed");
  expectError("goto", "int main() { goto end; }", "goto isn't supported");
  expectError("arity", "void f(int a) { }\nint main() { f(); return 0; }", "takes 1 argument");
  expectError("case-outside", "int main() { case 1: return 0; }", "label outside");
  expectError("elem-incdec", "int main() { int a[2]; a[0]++; return 0; }", "a[i] = a[i] + 1");
  expectError("redefined", "int f() { return 1; }\nint f() { return 2; }\nint main() { return 0; }", "defined twice");
  expectError("array-size", "int main() { int n = 2; int a[n]; return 0; }", "must be a number literal");
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
  () => "if (fork() == 0) { exit(3); } int st; waitpid(-1, &st, 0);",
  () => "int t = fork() == 0 ? 1 : 2; if (t == 1) { exit(0); }",
  () => "do { sleep(1); } while (0);",
  () => "switch (fork()) { case 0: exit(1); default: wait(0); }",
  (r) => `int buf[4]; for (int q = 0; q < 4; q++) { buf[q] = q * ${1 + Math.floor(r() * 3)}; }`,
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

console.log(fails === 0 ? "ALL PASS (52 scenario groups + invariants over 300 fuzzed programs)" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
