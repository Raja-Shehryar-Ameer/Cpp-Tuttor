// Tests for the pre-flight source validators (tracer + fork simulator).
// Run: node --experimental-strip-types frontend/tests/validation.test.ts

import { validateForkSource, validateTracerSource } from "../src/validation.ts";

let fails = 0;
const fail = (label: string, ...ctx: unknown[]) => {
  fails += 1;
  console.error("FAIL:", label, ...ctx.map((c) => JSON.stringify(c)));
};
const ok = (cond: boolean, label: string, ...ctx: unknown[]) => {
  if (!cond) fail(label, ...ctx);
};
const hasMatch = (list: string[], re: RegExp) => list.some((m) => re.test(m));

// --- empty and oversized ----------------------------------------------------

ok(hasMatch(validateTracerSource("", "cpp").errors, /empty/), "empty cpp source blocks");
ok(hasMatch(validateTracerSource("   \n  ", "python").errors, /empty/), "whitespace-only blocks");
ok(
  hasMatch(validateTracerSource("Python", "python").errors, /empty/) === false,
  "non-empty python passes the empty check",
);
ok(
  hasMatch(validateTracerSource("x".repeat(65 * 1024), "cpp").errors, /64 KB/),
  "oversized source blocks",
);

// --- C/C++ structural checks ------------------------------------------------

ok(
  hasMatch(validateTracerSource("int f() { return 1; }", "cpp").errors, /main\(\)/),
  "missing main() blocks",
);
ok(
  validateTracerSource("int main() { return 0; }", "cpp").errors.length === 0,
  "minimal main passes",
);
ok(
  hasMatch(validateTracerSource("int main() { {", "cpp").errors, /more \{ than \}/),
  "unclosed brace reported",
);
ok(
  hasMatch(validateTracerSource("int main() { } }", "cpp").errors, /more \} than \{/),
  "stray closing brace reported",
);
ok(
  hasMatch(validateTracerSource("int main( { }", "cpp").errors, /parenthes/i),
  "unbalanced parens reported",
);

// Braces inside strings, chars, and comments must not count.
ok(
  validateTracerSource('int main() { const char* s = "{{{"; return 0; }', "cpp").errors.length === 0,
  "braces in string literals ignored",
);
ok(
  validateTracerSource("int main() { // {{{\n return 0; }", "cpp").errors.length === 0,
  "braces in line comments ignored",
);
ok(
  validateTracerSource("int main() { /* } } */ return 0; }", "cpp").errors.length === 0,
  "braces in block comments ignored",
);
ok(
  validateTracerSource("int main() { char c = '{'; return 0; }", "cpp").errors.length === 0,
  "brace char literal ignored",
);

// --- cross-language detection ----------------------------------------------

ok(
  hasMatch(
    validateTracerSource("#include <iostream>\nint main() { std::cout << 1; }", "c").errors,
    /looks like C\+\+/,
  ),
  "C++ source in C mode flagged",
);
ok(
  hasMatch(validateTracerSource("def f():\n    pass\nmain()", "cpp").errors, /looks like Python/),
  "python source in cpp mode flagged",
);
ok(
  hasMatch(validateTracerSource("int main() { return 0; }", "python").errors, /looks like C/),
  "C source in python mode flagged",
);

// --- Python rules: no brace/main requirements, targeted warnings ------------

{
  const result = validateTracerSource("x = {'a': 1}\nprint(x)", "python");
  ok(result.errors.length === 0, "python dict braces are fine", result.errors);
}
{
  const result = validateTracerSource("while True:\n    x = 1\n", "python");
  ok(hasMatch(result.warnings, /step limit/), "while True without break warns");
}
ok(
  validateTracerSource("while True:\n    break\n", "python").warnings.length === 0,
  "while True with break is quiet",
);
ok(
  hasMatch(validateTracerSource("name = input()\n", "python").warnings, /stdin/),
  "input() warns about the stdin box",
);

// --- C/C++ warnings ---------------------------------------------------------

ok(
  hasMatch(
    validateTracerSource("#include <unistd.h>\nint main() { fork(); }", "c").warnings,
    /fork\(\)/,
  ),
  "fork() points at the fork tab",
);
ok(
  hasMatch(
    validateTracerSource("int main() { while (1) {} }", "cpp").warnings,
    /step limit/,
  ),
  "while(1) without break warns",
);

// --- fork validator ---------------------------------------------------------

ok(hasMatch(validateForkSource("").errors, /empty/), "fork: empty blocks");
ok(
  hasMatch(validateForkSource("int main() { std::cout << 1; }").errors, /looks like C\+\+/),
  "fork: C++ rejected",
);
{
  const result = validateForkSource("int main() { return 0; }");
  ok(result.errors.length === 0, "fork: plain C passes", result.errors);
  ok(hasMatch(result.warnings, /No fork\(\)/), "fork: missing fork() warns");
}
ok(
  validateForkSource("int main() { fork(); return 0; }").warnings.length === 0,
  "fork: fork() present is quiet",
);

if (fails === 0) {
  console.log("ALL PASS (tracer + fork source validation)");
  process.exit(0);
}
console.error(`${fails} failure(s)`);
process.exit(1);
