# BroadClass AI service — Phase 1 image.
#
# We pull in the [stt] (deepgram-sdk) and [embeddings] (sentence-transformers
# + torch CPU) extras. Torch CPU is large (~250 MB) and sentence-transformers
# downloads its model on first use unless we pre-download during build.
#
# Image size after build is in the ~1.5 GB range — that's the cost of running
# a real embedding model alongside the FastAPI service. If this becomes a
# pain we can swap to OpenAI text-embedding-3-small (network call, no torch).

FROM python:3.11-slim AS base

# System deps:
# - libpq5 for asyncpg
# - ffmpeg NOT needed here (Origin runs FFmpeg, ai-service just receives PCM)
# - ca-certificates so HTTPS to Deepgram / Groq / HuggingFace works
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps. We pin torch to the CPU-only wheels via PyTorch's
# index URL — the default index pulls CUDA wheels that bloat the image
# by ~2 GB and we don't ship a GPU container yet.
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
        torch>=2.2 \
    && pip install --no-cache-dir ".[stt,llm,embeddings]"

COPY app ./app
COPY scripts ./scripts

# Pin the HuggingFace cache to a known location BEFORE the pre-download so
# we can guarantee the runtime user reads from the same path. Previously
# this defaulted to /root/.cache at build time and /home/aiuser/.cache at
# run time → cache miss → the model re-downloaded on the first request.
ENV HF_HOME=/app/hf-cache \
    TRANSFORMERS_CACHE=/app/hf-cache
RUN mkdir -p "$HF_HOME"

# Pre-download the embedding model. Override at build time with:
#   docker build --build-arg EMBEDDING_MODEL=other-model .
ARG EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
ENV EMBEDDING_MODEL_NAME=${EMBEDDING_MODEL}
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')"

# Non-root user — chown everything under /app including the populated HF
# cache so the runtime user can read the pre-downloaded weights.
RUN useradd --system --uid 1001 --no-create-home aiuser \
    && chown -R aiuser:aiuser /app
USER aiuser

ENV PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:8080/health/live', timeout=3); sys.exit(0)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
