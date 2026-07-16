"""Every stdin shape, every language, through the real container.

The matrix pins the whole input path: JSON payload → docker stdin → tracer →
(redirect file for C/C++, byte-backed sys.stdin for Python). Cases marked
`crlf` feed raw Windows line endings straight into the sandbox — the tracer
boundary must normalize them for every language.
"""

import pytest

from app.core.config import Settings
from app.models.trace import TraceStatus
from app.services.sandbox import SandboxRunner

pytestmark = pytest.mark.integration


def run(language: str, code: str, stdin: str):
    return SandboxRunner(Settings()).run(code, stdin, language)


# (case id, language, source, stdin, expected stdout fragment)
OK_CASES = [
    # ---- C++ ----------------------------------------------------------------
    ("cpp-two-ints-one-line", "cpp",
     '#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << "sum " << a + b << "\\n"; }\n',
     "3 4\n", "sum 7"),
    ("cpp-two-ints-two-lines", "cpp",
     '#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << "sum " << a + b << "\\n"; }\n',
     "3\n4\n", "sum 7"),
    ("cpp-getline-spaces", "cpp",
     '#include <iostream>\n#include <string>\nint main() { std::string s; std::getline(std::cin, s); std::cout << "line: [" << s << "]\\n"; }\n',
     "hello brave world\n", "line: [hello brave world]"),
    ("cpp-read-until-eof", "cpp",
     '#include <iostream>\nint main() { int x, total = 0; while (std::cin >> x) total += x; std::cout << "total " << total << "\\n"; }\n',
     "1 2 3 4 5\n", "total 15"),
    ("cpp-no-trailing-newline", "cpp",
     '#include <iostream>\nint main() { int n; std::cin >> n; std::cout << "got " << n * 2 << "\\n"; }\n',
     "21", "got 42"),
    ("cpp-crlf-getline", "cpp",
     '#include <iostream>\n#include <string>\nint main() { std::string a, b; std::getline(std::cin, a); std::getline(std::cin, b); std::cout << "[" << a << "|" << b << "]\\n"; }\n',
     "red\r\nblue\r\n", "[red|blue]"),
    ("cpp-unicode-word", "cpp",
     '#include <iostream>\n#include <string>\nint main() { std::string w; std::cin >> w; std::cout << "word: " << w << "\\n"; }\n',
     "héllo\n", "word: héllo"),
    ("cpp-float-negative", "cpp",
     '#include <iostream>\nint main() { double d; std::cin >> d; std::cout << "twice " << d * 2 << "\\n"; }\n',
     "-2.5\n", "twice -5"),
    # empty stream: the sentry fails before extraction, so n keeps its value
    ("cpp-empty-stdin-read-fails-cleanly", "cpp",
     '#include <iostream>\nint main() { int n = 7; if (!(std::cin >> n)) std::cout << "no input, n=" << n << "\\n"; }\n',
     "", "no input, n=7"),
    ("cpp-mixed-cin-then-getline", "cpp",
     '#include <iostream>\n#include <string>\nint main() { int n; std::string rest; std::cin >> n; std::getline(std::cin, rest); std::getline(std::cin, rest); std::cout << n << " then [" << rest << "]\\n"; }\n',
     "5\nhello there\n", "5 then [hello there]"),
    # ---- C ------------------------------------------------------------------
    ("c-scanf-two-ints", "c",
     '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("sum %d\\n", a + b); return 0; }\n',
     "3 4\n", "sum 7"),
    ("c-fgets-spaces", "c",
     '#include <stdio.h>\n#include <string.h>\nint main(void) { char line[64]; fgets(line, sizeof line, stdin); line[strcspn(line, "\\n")] = 0; printf("got [%s]\\n", line); return 0; }\n',
     "hello brave world\n", "got [hello brave world]"),
    ("c-crlf-fgets", "c",
     '#include <stdio.h>\n#include <string.h>\nint main(void) { char line[64]; fgets(line, sizeof line, stdin); line[strcspn(line, "\\n")] = 0; printf("got [%s]\\n", line); return 0; }\n',
     "hi\r\n", "got [hi]"),
    ("c-getchar-count", "c",
     '#include <stdio.h>\nint main(void) { int c, count = 0; while ((c = getchar()) != EOF) count++; printf("chars %d\\n", count); return 0; }\n',
     "abcd\n", "chars 5"),
    ("c-scanf-until-eof", "c",
     '#include <stdio.h>\nint main(void) { int x, total = 0; while (scanf("%d", &x) == 1) total += x; printf("total %d\\n", total); return 0; }\n',
     "10\n20\n30\n", "total 60"),
    ("c-scanf-string-unicode", "c",
     '#include <stdio.h>\nint main(void) { char w[64]; scanf("%63s", w); printf("word: %s\\n", w); return 0; }\n',
     "héllo\n", "word: héllo"),
    ("c-empty-stdin-scanf-fails-cleanly", "c",
     '#include <stdio.h>\nint main(void) { int n = 0; if (scanf("%d", &n) != 1) printf("no input, n=%d\\n", n); return 0; }\n',
     "", "no input, n=0"),
    ("c-float-negative", "c",
     '#include <stdio.h>\nint main(void) { double d; scanf("%lf", &d); printf("twice %g\\n", d * 2); return 0; }\n',
     "-2.5\n", "twice -5"),
    # ---- Python ---------------------------------------------------------------
    ("py-int-no-trailing-newline", "python",
     'n = int(input())\nprint("got", n * 2)\n',
     "21", "got 42"),
    ("py-two-inputs", "python",
     'a = input()\nb = input()\nprint(a, "then", b)\n',
     "first\nsecond\n", "first then second"),
    ("py-split-map", "python",
     'a, b = map(int, input().split())\nprint("sum", a + b)\n',
     "3 4\n", "sum 7"),
    ("py-for-line-in-stdin", "python",
     'import sys\ntotal = 0\nfor line in sys.stdin:\n    total += int(line)\nprint("total", total)\n',
     "10\n20\n30\n", "total 60"),
    ("py-stdin-read", "python",
     'import sys\ndata = sys.stdin.read()\nprint("chars", len(data))\n',
     "abcd\n", "chars 5"),
    ("py-stdin-buffer", "python",
     'import sys\nraw = sys.stdin.buffer.read()\nprint("bytes", len(raw), type(raw).__name__)\n',
     "abcd\n", "bytes 5 bytes"),
    ("py-crlf-input", "python",
     'name = input()\nprint("match" if name == "ada" else "MISMATCH " + repr(name))\n',
     "ada\r\n", "match"),
    ("py-unicode", "python",
     'w = input()\nprint("word:", w, len(w))\n',
     "héllo\n", "word: héllo 5"),
    ("py-prompt-goes-to-stdout", "python",
     'name = input("name? ")\nprint("hi", name)\n',
     "ada\n", "name? hi ada"),
    ("py-mixed-input-then-read", "python",
     'import sys\nfirst = input()\nrest = sys.stdin.read()\nprint(first, "+", rest.strip())\n',
     "one\ntwo three\n", "one + two three"),
]


@pytest.mark.parametrize("case_id,language,code,stdin,expected", OK_CASES, ids=[c[0] for c in OK_CASES])
def test_stdin_shape_traces_clean(case_id, language, code, stdin, expected):
    trace = run(language, code, stdin)
    assert trace.status == TraceStatus.OK, trace.error
    assert trace.steps
    assert expected in trace.steps[-1].stdout


def test_py_empty_stdin_names_the_stdin_box():
    trace = run("python", "name = input()\n", "")
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "EOFError" in trace.error
    assert "stdin box" in trace.error


def test_oversized_stdin_is_rejected_at_the_api():
    from fastapi.testclient import TestClient

    from app.api.routes import app

    client = TestClient(app)
    response = client.post(
        "/api/trace",
        json={"code": "int main() {}", "stdin": "x" * (65 * 1024), "language": "cpp"},
    )
    assert response.status_code == 413
    assert "stdin" in response.json()["detail"]
