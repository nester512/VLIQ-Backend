"""Tests for kopecks→rubles formatting in notification messages.

Regression: the bot rendered kopecks next to ₽ as if they were rubles
(25000 kopecks → "25000 ₽" instead of "250 ₽").
"""

from __future__ import annotations

from src.notification.formatting import format_kopecks, render_money_payload
from src.notification.worker import _render


def test_format_kopecks__whole_rubles() -> None:
    assert format_kopecks(25000) == "250"
    assert format_kopecks(0) == "0"
    assert format_kopecks(100) == "1"


def test_format_kopecks__fractional() -> None:
    assert format_kopecks(25050) == "250,50"
    assert format_kopecks(5) == "0,05"
    assert format_kopecks(-25050) == "-250,50"


def test_format_kopecks__non_int_passthrough() -> None:
    assert format_kopecks(None) == "None"
    assert format_kopecks("oops") == "oops"


def test_render_money_payload__only_money_keys_converted() -> None:
    out = render_money_payload({"bonus_amount": 25000, "available": 30000, "amount": 5000, "receipt_id": 7})
    assert out == {"bonus_amount": "250", "available": "300", "amount": "50", "receipt_id": 7}


def test_worker_render__approved_shows_rubles_not_kopecks() -> None:
    text = _render("receipt.approved", {"receipt_id": 7, "bonus_amount": 25000, "available": 25000})
    assert "+250 ₽" in text
    assert "Доступно к выплате: 250 ₽" in text
    assert "25000" not in text


def test_worker_render__payout_shows_rubles() -> None:
    text = _render("payout.sent", {"amount": 100000, "payout_masked": "+7•••99"})
    assert "1000 ₽" in text
    assert "100000" not in text


def test_worker_render__bonus_changed_shows_new_amount_in_rubles() -> None:
    text = _render("receipt.bonus_changed", {"receipt_id": 7, "bonus_amount": 12300})
    assert "чеку №7" in text
    assert "Новая сумма: <b>123 ₽</b>" in text
    assert "12300" not in text


def test_worker_render__non_money_template_unchanged() -> None:
    text = _render("receipt.rejected", {"receipt_id": 7, "reason": "плохой чек"})
    assert text == "❌ Чек №7 отклонён\nПричина: плохой чек"
