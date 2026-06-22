"""Unified application error contract.

All application-level errors should raise AppError with a code from USER_MESSAGES.
FastAPI exception handlers in main.py convert these to the envelope:
  { "code": "...", "user_message": "...", "debug_id": "<uuid>" }
"""

from __future__ import annotations

# Catalog of user-facing messages, keyed by stable machine code. The frontend keys
# off `code`/HTTP status — NOT this text. All messages are Russian and polite ("вы").
# Adding a new public error code REQUIRES adding it here (covered by a table test).
USER_MESSAGES: dict[str, str] = {
    # --- Receipt upload ---
    "RECEIPT_NO_FILES": "Приложите хотя бы один файл чека.",
    "RECEIPT_TOO_MANY_FILES": "Можно загрузить не более 5 файлов за одну отправку.",
    "RECEIPT_EMPTY_FILE": "Файл пустой. Выберите другой файл.",
    "RECEIPT_FILE_TOO_LARGE": "Файл слишком большой. Максимальный размер — 10 МБ.",
    "RECEIPT_UNSUPPORTED_TYPE": "Поддерживаются изображения JPG, PNG, WebP и документы PDF.",
    "RECEIPT_INVALID_PACKAGE": "Не удалось подготовить выбранные файлы. Удалите их и выберите заново.",
    "RECEIPT_UPLOAD_SESSION_INVALID": "Время загрузки истекло. Выберите файлы и отправьте чек ещё раз.",
    "RECEIPT_OBJECT_MISSING": "Не удалось найти загруженный файл. Загрузите его ещё раз.",
    "QR_ONLY_DEPRECATED": "QR-код можно отправить только вместе с фото или PDF чека.",
    "MULTIPLE_RECEIPTS_DETECTED": "В одной загрузке обнаружено несколько разных чеков. Загрузите каждый чек отдельно.",
    # --- Receipt (general / admin actions) ---
    "RECEIPT_NOT_FOUND": "Чек не найден или был удалён.",
    "RECEIPT_NOT_YOURS": "Этот чек принадлежит другому продавцу.",
    "RECEIPT_DUPLICATE": "Этот чек уже был загружен ранее.",
    "RECEIPT_INVALID_STATE_TRANSITION": "Это действие недоступно для текущего статуса чека. Обновите очередь.",
    "RECEIPT_REASON_REQUIRED": "Укажите причину отклонения.",
    "RECEIPT_INVALID_BONUS": "Укажите корректную сумму бонуса.",
    "RECEIPT_COMMENT_FAILED": "Не удалось сохранить комментарий. Попробуйте ещё раз.",
    # --- QR / OFD ---
    "QR_PARSE_FAILED": "Не удалось прочитать QR-код. Попробуйте ещё раз.",
    "QR_NOT_FOUND": "QR-код не найден.",
    "OFD_UPSTREAM_UNAVAILABLE": "Сервис проверки чеков временно недоступен. Попробуйте позже.",
    "OFD_RECEIPT_NOT_FOUND": "Чек не найден в базе налоговой.",
    # --- SKU ---
    "SKU_NOT_FOUND": "Товар не найден.",
    # --- Auth ---
    "AUTH_INVALID_INIT_DATA": "Сессия истекла. Откройте приложение заново из Telegram.",
    "AUTH_MISSING_TOKEN": "Сессия истекла. Откройте приложение заново из Telegram.",
    "AUTH_TOKEN_EXPIRED": "Сессия истекла. Откройте приложение заново из Telegram.",
    "AUTH_TOKEN_INVALID": "Сессия истекла. Откройте приложение заново из Telegram.",
    "AUTH_FORBIDDEN": "У вас нет доступа к этому действию.",
    "AUTH_REGISTRATION_REQUIRED": "Завершите регистрацию, чтобы продолжить.",
    # --- Seller ---
    "SELLER_BLOCKED": "Ваш аккаунт заблокирован. Обратитесь в поддержку: @nester256.",
    "SELLER_NOT_REGISTERED": "Завершите регистрацию, чтобы продолжить.",
    "SELLER_NOT_FOUND": "Продавец не найден.",
    "SELLER_PHONE_TAKEN": "Этот номер телефона уже зарегистрирован. Укажите другой.",
    "SELLER_CITY_INVALID": "Выберите город из списка.",
    # --- Payout ---
    "PAYOUT_NOT_FOUND": "Заявка на выплату не найдена.",
    "PAYOUT_DETAILS_REQUIRED": "Укажите номер телефона для выплаты.",
    "PAYOUT_INVALID_AMOUNT": "Укажите сумму больше нуля и не больше доступного баланса.",
    "PAYOUT_INSUFFICIENT_BALANCE": "Недостаточно средств для выплаты.",
    "PAYOUT_INVALID_STATE": "Заявка уже обработана. Обновите список.",
    # --- General ---
    "NOT_IMPLEMENTED": "Функция ещё не реализована.",
    "INTERNAL_ERROR": "Что-то пошло не так. Попробуйте ещё раз.",
    "VALIDATION_ERROR": "Проверьте введённые данные.",
}


class AppError(Exception):
    """Application-level error with a structured code and user-friendly message.

    Usage:
        raise AppError("SELLER_NOT_FOUND", status_code=404)
        raise AppError("RECEIPT_DUPLICATE", extra={"receipt_id": 42})
    """

    def __init__(
        self,
        code: str,
        user_message: str | None = None,
        status_code: int = 400,
        extra: dict | None = None,
    ) -> None:
        self.code = code
        self.user_message = user_message or USER_MESSAGES.get(code, USER_MESSAGES["INTERNAL_ERROR"])
        self.status_code = status_code
        self.extra = extra or {}
        super().__init__(self.user_message)
