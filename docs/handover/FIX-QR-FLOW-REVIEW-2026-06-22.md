# Review ветки `fix/qr-flow` (2026-06-22)

Проверенный HEAD: `7f48f13`. Источник продуктовых требований:
`docs/VLIQ PRD+BRD/Use cases VLIQ.md` и зафиксированный контракт
`docs/handover/MULTI-UPLOAD-DESIGN-FREEZE-2026-06-22.md`.

## Итог

Исправлена основная причина ошибки SQLAlchemy `A transaction is already begun`, добавлена
модель пакета из 1–5 вложений и существенно расширены тесты. Однако ветка пока не готова целиком
к переводу в Test: остаются блокеры в enqueue/retry, обработке всех страниц PDF и доступности
вложений администратору с удалённого Telegram-клиента.

## Подтверждено

- Изменения опубликованы в `origin/fix/qr-flow`; рабочее дерево не содержит незакоммиченных
  изменений проекта (корневой `AGENTS.md` — отдельный untracked-файл окружения).
- Реальные PostgreSQL/migration-тесты: `26 passed`.
- Backend без integration/migration: `271 passed, 1 skipped` в intended local-storage env.
- В compose/S3 env: `270 passed, 1 failed, 1 skipped`; красный
  `test_upload_urls__not_s3_backend__returns_501` зависит от env и не является герметичным.
- Чистая Docker-сборка frontend прошла TypeScript и Vite build.
- Реализованы: один Receipt с 1–5 вложениями, сценарий `A+A -> on_review`, системный отказ
  `A+B`, поле `rejection_code`, админский viewer с финальной информационной карточкой,
  безопасный API-конверт ошибок.

## Блокеры до Test

### P0

1. **KAN-16 закрыт не полностью.** Идемпотентный повтор загрузки вызывает enqueue, но игнорирует
   `False`; Receipt может остаться в `pending`. Admin retry аналогично фиксирует
   `ocr_in_progress`, игнорирует неуспешный enqueue и может оставить чек в этом статусе.
   Проверить `backend/src/receipt/handlers/api/v1/router.py` около строк 200 и 765.

2. **PDF обрабатывается не полностью.** В `backend/src/receipt_ocr/pdf.py` установлен
   `MAX_PDF_PAGES = 10`, тогда как PRD требует анализировать все страницы документа.

3. **Вложения не готовы для удалённого Telegram-клиента.** URL строится через
   `S3_PUBLIC_ENDPOINT`; dev-конфигурация использует `http://localhost:9000`, а без public endpoint
   возможен внутренний hostname MinIO. Для TMA нужен доступный извне HTTPS URL: reverse proxy или
   короткоживущий presigned GET.

### P1

4. **Idempotency key переживает изменение пакета после ошибки.** Пользователь может заменить файлы
   или QR, но повтор отправит прежний ключ. Нужен reset ключа при изменении payload либо серверная
   сверка ключа с fingerprint пакета.

5. **Админские duplicate/warning-сигналы локализованы не полностью.** Frontend не знает реальные
   коды `qr_raw_duplicate`, `fn_fd_fp_duplicate`, `file_hash_duplicate`; `fraud_details` и warning
   codes могут отображаться как raw slug/JSON. Проверить также поиск дублей по всем историческим
   `ReceiptAttachment`, а не только по legacy `Receipt.file_hash`.

6. **Лимит 10 MiB не memory-safe.** Multipart сначала целиком читается в память; presigned POST не
   ограничивает `content-length-range`; finalize скачивает объект целиком до проверки размера.

7. **Каталог ошибок покрыт не полностью.** Остались пользовательские English/default messages,
   а catalog-test проверяет преимущественно `USER_MESSAGES`, но не все custom overrides.

## Рекомендуемое движение Jira

- В Test можно передать отдельные пункты про исправление transaction boundary и добавление
  `rejection_code`, если они заведены самостоятельными задачами.
- KAN-16, полную обработку PDF, показ вложений администратору, duplicate UX и локализацию оставить
  In Progress до устранения пунктов выше и повторного зелёного прогона.

## Неподтверждённое из отчёта исполнителя

Полный frontend-набор `tsc + vitest (104) + eslint` независимо не прогонялся в этой сессии;
подтверждена только чистая frontend Docker-сборка. Это нужно повторить перед переводом ветки в Test.
