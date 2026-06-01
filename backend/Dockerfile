# ---------------------------------------------------------------------------
# Stage 1: Build — install Python dependencies via Poetry
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.5 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true

RUN pip install --no-cache-dir "poetry==$POETRY_VERSION"

# Build tools required by native extension packages (zxing-cpp, Pillow, imagehash).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only dependency manifests first to leverage layer cache.
COPY pyproject.toml poetry.lock ./

# Install production deps only (no dev group).
RUN poetry install --no-root --only main

# ---------------------------------------------------------------------------
# Stage 2: Runtime — copy the venv + application source
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

# curl is used by the backend healthcheck in docker-compose.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the venv from the builder stage.
COPY --from=builder /app/.venv /app/.venv

# Copy application source.
COPY . .

# Default: run the FastAPI backend.
EXPOSE 8000
CMD ["uvicorn", "src.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
