# ---------------------------------------------------------------------------
# Stage 1: Build — install Python dependencies via Poetry
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=2.5.1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_INSTALLER_ONLY_BINARY=":all:"

# Wheels only (POETRY_INSTALLER_ONLY_BINARY): every locked package ships a manylinux
# wheel for this Python. A package without one must FAIL the build, not compile —
# compiling scipy from source once OOM-crashed the shared stage host (2026-10-09).
# No compilers in the image either.
RUN pip install --no-cache-dir "poetry==$POETRY_VERSION"

WORKDIR /app

# Copy only dependency manifests first to leverage layer cache.
COPY pyproject.toml poetry.lock ./

# Install production deps only (no dev group).
RUN poetry install --no-root --only main

# ---------------------------------------------------------------------------
# Stage 2: Runtime — copy the venv + application source
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS runtime

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
