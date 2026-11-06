"""
runner/sandbox.py
Isolated Python execution sandbox with timeout & output capture
"""
import sys
import io
import signal
import traceback
from contextlib import redirect_stdout, redirect_stderr


class TimeoutException(Exception):
    pass


def timeout_handler(signum: int, frame: object) -> None:  # type: ignore[type-arg]
    raise TimeoutException("Execution timed out")


def execute_code(code: str, timeout_seconds: int = 8) -> dict:
    """
    Execute Python code in a sandboxed environment.
    Returns dict with stdout, stderr, error, and success fields.
    """
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # Set timeout via SIGALRM (Unix only)
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(timeout_seconds)

    # Restricted globals — block dangerous builtins
    restricted_globals: dict = {
        "__builtins__": {
            "print": print,
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "sorted": sorted,
            "reversed": reversed,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "abs": abs,
            "max": max,
            "min": min,
            "sum": sum,
            "round": round,
            "type": type,
            "isinstance": isinstance,
            "hasattr": hasattr,
            "getattr": getattr,
            "repr": repr,
            "format": format,
            "__import__": _safe_import,
        }
    }

    local_vars: dict = {}

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compile(code, "<kim-sandbox>", "exec"), restricted_globals, local_vars)
        signal.alarm(0)  # Cancel alarm

        return {
            "success": True,
            "stdout": stdout_buf.getvalue(),
            "stderr": stderr_buf.getvalue(),
            "error": None,
        }
    except TimeoutException:
        signal.alarm(0)
        return {
            "success": False,
            "stdout": stdout_buf.getvalue(),
            "stderr": "",
            "error": f"Execution timed out after {timeout_seconds} seconds",
        }
    except Exception:
        signal.alarm(0)
        return {
            "success": False,
            "stdout": stdout_buf.getvalue(),
            "stderr": stderr_buf.getvalue(),
            "error": traceback.format_exc(),
        }


# Allowlist of safe modules
ALLOWED_MODULES = {
    "pandas", "pd", "numpy", "np", "matplotlib", "matplotlib.pyplot",
    "json", "math", "statistics", "datetime", "collections", "itertools",
    "re", "string", "decimal", "fractions", "random", "time",
    "io", "csv", "base64", "hashlib", "uuid",
    "pypdf", "pdfplumber", "PIL", "pillow",
}


def _safe_import(name: str, *args, **kwargs):
    top_level = name.split(".")[0]
    if top_level not in ALLOWED_MODULES and name not in ALLOWED_MODULES:
        raise ImportError(f"Module '{name}' is not allowed in the sandbox")
    return __import__(name, *args, **kwargs)
