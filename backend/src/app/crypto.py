"""Fernet symmetric encryption for payout account details (H4).

Key must be provided via Settings.PAYOUT_ENCRYPTION_KEY — a URL-safe base64-encoded
32-byte key. Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

No default is set intentionally; startup fails with ValidationError if missing.
"""

from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)


class PayoutCrypto:
    """Thin Fernet wrapper for encrypting/decrypting payout account data."""

    def __init__(self, key: str) -> None:
        # Fernet accepts both str (URL-safe base64) and bytes.
        self._fernet = Fernet(key.encode() if isinstance(key, str) else key)

    def encrypt(self, plaintext: str) -> str:
        """Encrypt plaintext payout data and return URL-safe base64 ciphertext."""
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt ciphertext. Raises ValueError on bad token / wrong key."""
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as exc:
            logger.warning("crypto.decrypt.invalid_token")
            raise ValueError("Unable to decrypt payout data: invalid token or wrong key") from exc
