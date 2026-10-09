"""Prometheus metric definitions for VLIQ backend.

All custom metrics are defined here so they are imported once and shared
across modules.  Import from this module rather than defining metrics inline.

Metric naming follows the Prometheus convention:
  <namespace>_<subsystem>_<unit>_<suffix>

Usage:
    from src.app.prometheus_metrics import (
        ofd_requests_total,
        ofd_request_duration_seconds,
        receipt_pipeline_duration_seconds,
        notification_outbox_pending,
        notification_outbox_dead,
    )
"""

from __future__ import annotations

import logging
import os

from prometheus_client import Counter, Gauge, Histogram, start_http_server

_log = logging.getLogger(__name__)


def serve_worker_metrics(default_port: int) -> None:
    """Workers are not HTTP apps: expose their metrics on their own port for Prometheus
    (WORKER_METRICS_PORT overrides; 0 switches it off). Best effort — never stops the worker."""
    port = int(os.environ.get("WORKER_METRICS_PORT", default_port))
    if port <= 0:
        return
    try:
        start_http_server(port)
        _log.info("metrics.served port=%d", port)
    except OSError as exc:  # port taken (e.g. a second worker on the same host): run without it
        _log.warning("metrics.not_served port=%d error=%s", port, exc)

# ---------------------------------------------------------------------------
# OFD client metrics
# ---------------------------------------------------------------------------

ofd_requests_total = Counter(
    "ofd_requests_total",
    "Total OFD API calls by provider and outcome status.",
    labelnames=["provider", "status"],
)
"""Labels:
    provider: 'proverkacheka' | 'ofd_ru' | 'fake'
    status:   'ok' | 'not_found' | 'rate_limit' | 'blocked' | 'error'
"""

ofd_request_duration_seconds = Histogram(
    "ofd_request_duration_seconds",
    "Duration of a single OFD API call (per-attempt, excluding retries).",
    labelnames=["provider"],
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)
"""Labels:
    provider: 'proverkacheka' | 'ofd_ru' | 'fake'
"""

# ---------------------------------------------------------------------------
# Receipt pipeline metrics
# ---------------------------------------------------------------------------

receipt_pipeline_duration_seconds = Histogram(
    "receipt_pipeline_duration_seconds",
    "End-to-end duration of the receipt OCR → OFD → bonus pipeline.",
    labelnames=["status"],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
)
"""Labels:
    status: 'approved' | 'rejected' | 'needs_revision' | 'on_review' | 'error'
"""

# ---------------------------------------------------------------------------
# Notification outbox metrics
# ---------------------------------------------------------------------------

notification_outbox_pending = Gauge(
    "notification_outbox_pending",
    "Number of notification_outbox rows with status='pending'.",
)

notification_outbox_dead = Gauge(
    "notification_outbox_dead",
    "Number of notification_outbox rows with status='dead' (exhausted retries).",
)
