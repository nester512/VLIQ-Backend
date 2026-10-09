"""Workers serve their own metrics; a taken port or WORKER_METRICS_PORT=0 never stops them."""
from __future__ import annotations

from unittest.mock import patch

from src.app import prometheus_metrics as pm


def test_serves_on_the_default_port(monkeypatch) -> None:
    monkeypatch.delenv("WORKER_METRICS_PORT", raising=False)
    with patch.object(pm, "start_http_server") as start:
        pm.serve_worker_metrics(9101)
    start.assert_called_once_with(9101)


def test_zero_switches_it_off(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_METRICS_PORT", "0")
    with patch.object(pm, "start_http_server") as start:
        pm.serve_worker_metrics(9101)
    start.assert_not_called()


def test_taken_port_does_not_stop_the_worker(monkeypatch) -> None:
    monkeypatch.delenv("WORKER_METRICS_PORT", raising=False)
    with patch.object(pm, "start_http_server", side_effect=OSError("in use")):
        pm.serve_worker_metrics(9102)  # no exception
