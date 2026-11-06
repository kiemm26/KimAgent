"""
runner/main.py
FastAPI microservice for Python sandboxed execution
"""
import os
import base64
import tempfile
import io
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sandbox import execute_code

app = FastAPI(title="kim-python-runner", version="1.0.0")

RUNNER_SECRET = os.environ.get("RUNNER_SECRET", "")
MAX_TIMEOUT = int(os.environ.get("MAX_EXEC_TIMEOUT", "10"))
SANDBOX_DIR = Path("/tmp/sandbox")
SANDBOX_DIR.mkdir(parents=True, exist_ok=True)


def verify_secret(x_runner_secret: str = Header(default="")):
    if RUNNER_SECRET and x_runner_secret != RUNNER_SECRET:
        raise HTTPException(status_code=401, detail="Invalid runner secret")


# ── Request/Response Models ───────────────────────────────────────

class ExecuteRequest(BaseModel):
    code: str
    timeout: int = 8


class ExecuteResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    error: str | None


class ChartRequest(BaseModel):
    code: str
    title: str = "Chart"


class ChartResponse(BaseModel):
    success: bool
    image_base64: str | None
    error: str | None


# ── Endpoints ─────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "kim-python-runner"}


@app.post("/execute", response_model=ExecuteResponse, dependencies=[Depends(verify_secret)])
def execute(req: ExecuteRequest):
    timeout = min(req.timeout, MAX_TIMEOUT)
    result = execute_code(req.code, timeout)
    return ExecuteResponse(**result)


@app.post("/chart", response_model=ChartResponse, dependencies=[Depends(verify_secret)])
def render_chart(req: ChartRequest):
    # Inject matplotlib backend before user code
    setup_code = """
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
"""
    full_code = setup_code + "\n" + req.code

    # Redirect savefig to memory buffer
    capture_code = full_code + """
import io as _io
_buf = _io.BytesIO()
plt.savefig(_buf, format='png', dpi=100, bbox_inches='tight')
plt.close('all')
_buf.seek(0)
_img_data = _buf.read()
"""
    result = execute_code(capture_code, timeout_seconds=min(MAX_TIMEOUT, 15))

    if not result["success"]:
        return ChartResponse(success=False, image_base64=None, error=result["error"])

    # The image bytes are in _img_data local var — re-run to get it
    # Simpler approach: write to file and read back
    output_path = SANDBOX_DIR / "output.png"
    chart_code = setup_code + "\n" + req.code + f"\nplt.savefig('{output_path}', dpi=100, bbox_inches='tight')\nplt.close('all')"
    result2 = execute_code(chart_code, timeout_seconds=min(MAX_TIMEOUT, 15))

    if not result2["success"]:
        return ChartResponse(success=False, image_base64=None, error=result2["error"])

    if not output_path.exists():
        return ChartResponse(success=False, image_base64=None, error="Chart file not generated. Did you call plt.savefig()?")

    with open(output_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    output_path.unlink(missing_ok=True)

    return ChartResponse(success=True, image_base64=img_b64, error=None)


@app.post("/pdf-info", dependencies=[Depends(verify_secret)])
def pdf_info(file_b64: str):
    try:
        import pdfplumber
        pdf_bytes = base64.b64decode(file_b64)
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            info = {
                "pages": len(pdf.pages),
                "text_preview": pdf.pages[0].extract_text()[:500] if pdf.pages else "",
            }
        return {"success": True, "info": info}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
