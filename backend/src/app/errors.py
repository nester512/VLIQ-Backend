"""Unified application error contract.

All application-level errors should raise AppError with a code from USER_MESSAGES.
FastAPI exception handlers in main.py convert these to the envelope:
  { "code": "...", "user_message": "...", "debug_id": "<uuid>" }
"""

from __future__ import annotations

USER_MESSAGES: dict[str, str] = {
    # Receipt errors
    "RECEIPT_EMPTY_FILE": "Файл пуст. Попробуй ещё раз.",
    "RECEIPT_UNSUPPORTED_TYPE": "Неподдерживаемый формат файла. Загрузи JPG, PNG или PDF.",
    "RECEIPT_NOT_FOUND": "Чек не найден.",
    "RECEIPT_NOT_YOURS": "Этот чек принадлежит другому продавцу.",
    "RECEIPT_DUPLICATE": "Этот чек уже был загружен ранее.",
    # QR errors
    "QR_PARSE_FAILED": "Не удалось прочитать QR-код. Попробуй ещё раз.",
    "QR_NOT_FOUND": "QR-код не найден.",
    # OFD errors
    "OFD_UPSTREAM_UNAVAILABLE": "Сервис проверки чеков временно недоступен. Попробуй позже.",
    "OFD_RECEIPT_NOT_FOUND": "Чек не найден в базе налоговой.",
    # Auth errors
    "AUTH_INVALID_INIT_DATA": "Ошибка авторизации. Попробуй перезапустить приложение.",
    "AUTH_MISSING_TOKEN": "Сессия истекла. Перезапусти приложение.",
    "AUTH_TOKEN_EXPIRED": "Сессия истекла. Войди снова.",
    "AUTH_TOKEN_INVALID": "Токен недействителен. Войди снова.",
    "AUTH_FORBIDDEN": "Недостаточно прав для выполнения этого действия.",
    # Seller errors
    "SELLER_BLOCKED": "Ваш аккаунт заблокирован. Обратитесь в поддержку.",
    "SELLER_NOT_REGISTERED": "Продавец не зарегистрирован.",
    "SELLER_NOT_FOUND": "Продавец не найден.",
    "SELLER_PHONE_TAKEN": "Этот номер телефона уже зарегистрирован. Укажите другой.",
    "SELLER_CITY_INVALID": "Выберите город из списка.",
    # Payout errors
    "PAYOUT_INVALID_AMOUNT": "Неверная сумма выплаты.",
    "PAYOUT_INSUFFICIENT_BALANCE": "Недостаточно бонусов для выплаты.",
    # Receipt state errors
    "RECEIPT_INVALID_STATE_TRANSITION": "Этот чек уже обработан. Обнови список.",
    # General errors
    "NOT_IMPLEMENTED": "Функция ещё не реализована.",
    "INTERNAL_ERROR": "Что-то пошло не так. Попробуй ещё раз.",
    "VALIDATION_ERROR": "Проверь введённые данные.",
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
