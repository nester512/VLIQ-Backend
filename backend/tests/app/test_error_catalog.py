"""Guardrails for the user-facing error catalog.

- Every AppError code raised in src/ has a localized message (no silent fallback to
  INTERNAL_ERROR for a known subject code).
- No public endpoint raises a raw English HTTPException.
- All catalog messages are Russian (Cyrillic) and free of obvious English/technical words.
"""

from __future__ import annotations

import re
from pathlib import Path

from src.app.errors import USER_MESSAGES

_SRC = Path(__file__).resolve().parents[2] / "src"
_CODE_RE = re.compile(r'AppError\(\s*["\']([A-Z0-9_]+)["\']')
_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
# Words that must never appear in a user-facing message.
_FORBIDDEN = (
    "error", "not found", "invalid", "failed", "exception", "traceback",
    "token", "hmac", "jwt", "sqlalchemy", "redis", "session", "null", "none",
)


def _iter_py() -> list[Path]:
    return [p for p in _SRC.rglob("*.py") if "__pycache__" not in p.parts]


def test_every_raised_apperror_code_is_in_catalog() -> None:
    missing: set[str] = set()
    for path in _iter_py():
        for code in _CODE_RE.findall(path.read_text(encoding="utf-8")):
            if code not in USER_MESSAGES:
                missing.add(code)
    assert not missing, f"AppError codes raised in src/ but missing from USER_MESSAGES: {sorted(missing)}"


def test_no_raw_httpexception_in_user_facing_handlers() -> None:
    """Public API handlers must use AppError, not raw HTTPException.

    The dev-only ``/auth/login`` prod-guard is the single allowed exception (a
    deliberate 404 that hides the endpoint, not a user-facing message)."""
    offenders: list[str] = []
    for path in _SRC.rglob("**/handlers/**/*.py"):
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"raise HTTPException", text):
            line = text[: m.start()].count("\n") + 1
            # Allow the intentional prod-guard 404 in the auth router.
            ctx = text[m.start() : m.start() + 120]
            if "intentional 404" in ctx:
                continue
            offenders.append(f"{path.relative_to(_SRC)}:{line}")
    assert not offenders, f"raw HTTPException in handlers (use AppError): {offenders}"


def test_all_messages_are_russian_and_clean() -> None:
    for code, msg in USER_MESSAGES.items():
        assert _CYRILLIC.search(msg), f"{code}: message is not Russian: {msg!r}"
        lowered = msg.lower()
        for word in _FORBIDDEN:
            assert word not in lowered, f"{code}: message contains forbidden term {word!r}: {msg!r}"
