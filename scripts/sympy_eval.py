#!/usr/bin/env python3
"""Sandboxed SymPy evaluator. Reads one expression from stdin, prints JSON result.

Safety: restricted builtins, banned-keyword scan, SIGALRM timeout, no imports/IO.
Intended only for verifying student-grade math (integrals, derivatives, solving,
simplification, matrices, limits, series). Not a general code runner.
"""
import sys
import json
import signal


def _timeout(signum, frame):
    print(json.dumps({"error": "计算超时"}))
    sys.exit(0)


signal.signal(signal.SIGALRM, _timeout)
signal.alarm(6)

# Hard resource caps so a hostile expression (e.g. 2**(10**9), factorial(10**8))
# cannot exhaust host memory or CPU before the SIGALRM fires.
try:
    import resource  # noqa: E402 - POSIX only; best-effort hardening

    _MEM_BYTES = 768 * 1024 * 1024  # 768 MiB address space
    for _lim in (resource.RLIMIT_AS, getattr(resource, "RLIMIT_DATA", None)):
        if _lim is None:
            continue
        try:
            soft, hard = resource.getrlimit(_lim)
            cap = _MEM_BYTES if hard == resource.RLIM_INFINITY else min(_MEM_BYTES, hard)
            resource.setrlimit(_lim, (cap, hard))
        except (ValueError, OSError):
            pass
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (6, 7))
    except (ValueError, OSError):
        pass
except ImportError:
    pass

code = sys.stdin.read().strip()
if not code:
    print(json.dumps({"error": "空表达式"}))
    sys.exit(0)

# Block obvious escape vectors before any evaluation.
BANNED = (
    "import", "__", "open(", "exec(", "eval(", "compile(", "globals",
    "locals", "getattr", "setattr", "delattr", "vars(", "input(",
    "os.", "sys.", "subprocess", "socket", "shutil", "pathlib", "builtins",
)
lowered = code.replace(" ", "")
for token in BANNED:
    if token.replace(" ", "") in lowered:
        print(json.dumps({"error": "表达式包含禁止的操作"}))
        sys.exit(0)

import sympy  # noqa: E402

SAFE_BUILTINS = {
    "abs": abs, "round": round, "min": min, "max": max, "sum": sum,
    "range": range, "len": len, "float": float, "int": int, "complex": complex,
    "str": str, "list": list, "tuple": tuple, "dict": dict, "set": set,
    "bool": bool, "pow": pow, "print": print, "enumerate": enumerate,
    "map": map, "zip": zip, "sorted": sorted,
}

namespace = {name: getattr(sympy, name) for name in dir(sympy) if not name.startswith("_")}
namespace["__builtins__"] = SAFE_BUILTINS
# Common symbols students use, pre-declared for convenience.
for sym in ("x", "y", "z", "t", "n", "k", "a", "b", "c"):
    namespace[sym] = sympy.Symbol(sym)

try:
    try:
        value = eval(code, namespace)  # noqa: S307 - restricted namespace
    except SyntaxError:
        local = {}
        exec(code, namespace, local)  # noqa: S102 - restricted namespace
        value = local.get("result")
    text = str(value)
    if len(text) > 1500:
        text = text[:1500] + " …(已截断)"
    print(json.dumps({"result": text}, ensure_ascii=False))
except Exception as exc:  # noqa: BLE001 - surface any math error to the model
    print(json.dumps({"error": str(exc)[:300]}, ensure_ascii=False))
