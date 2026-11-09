"""
runner/sandbox.py
Isolated Python execution sandbox with timeout & output capture
"""
import sys
import io
import threading
import traceback
from contextlib import redirect_stdout, redirect_stderr

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


def execute_code(code: str, timeout_seconds: int = 8) -> dict:
    """
    Execute Python code in a sandboxed environment using thread timeout.
    Safe for FastAPI threadpool execution (avoids SIGALRM in non-main threads).
    """
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    result = {
        "success": False,
        "stdout": "",
        "stderr": "",
        "error": None,
    }

    # Restricted environment
    sandbox_env: dict = {
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

    def worker():
        try:
            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                # Use same dictionary for globals and locals so imports/functions resolve properly
                exec(compile(code, "<kim-sandbox>", "exec"), sandbox_env, sandbox_env)
            result["success"] = True
            result["stdout"] = stdout_buf.getvalue()
            result["stderr"] = stderr_buf.getvalue()
            result["error"] = None
        except Exception:
            result["success"] = False
            result["stdout"] = stdout_buf.getvalue()
            result["stderr"] = stderr_buf.getvalue()
            result["error"] = traceback.format_exc()

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout=timeout_seconds)

    if t.is_alive():
        return {
            "success": False,
            "stdout": stdout_buf.getvalue(),
            "stderr": "",
            "error": f"Execution timed out after {timeout_seconds} seconds",
        }

    return result

