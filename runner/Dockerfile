# ================================================================
# runner/Dockerfile — Python 3.12 Slim FastAPI Sandbox
# ================================================================
FROM python:3.12-slim

# Install system deps for Matplotlib, Tesseract, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1001 -s /bin/sh appuser

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py sandbox.py ./

# Create sandbox temp dir
RUN mkdir -p /tmp/sandbox && chown appuser:appuser /tmp/sandbox

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
