# Документация VLIQ

| Папка / файл | Что там | Для кого |
|---|---|---|
| [use-cases/](use-cases/00-overview.md) | **Источник правды по продукту**: роли, правила, use cases по интерфейсам, out of scope, решения | все |
| [procedures/ACCOUNT-RECOVERY.md](procedures/ACCOUNT-RECOVERY.md) | Восстановление доступа продавца при потере Telegram | поддержка, super admin |
| [procedures/PROD-MIGRATION.md](procedures/PROD-MIGRATION.md) | Переезд прода: защита базы, ночная репетиция на копии, выкатка, откат | владелец, эксплуатация |
| [testing/](testing/REGRESSION.md) | Регресс-план, история запросов владельца, ручная проверка на стенде, тестовые QR | тестирование |
| [design/](design/PAYOUTS.md) | Техническое устройство выплат и проверки чеков | разработка |
| [CI-CD.md](CI-CD.md) | Стенд и прод, выкатка, резервные копии, восстановление | разработка, эксплуатация |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Метрики, логи, Grafana | эксплуатация |
| [handover/JIRA-COMMENTS.md](handover/JIRA-COMMENTS.md) | Тексты комментариев к задачам Jira — вставить вручную, после этого файл удалить | владелец |

Устаревшие документы удалены. Их история — в git.

## Правило изменений
Каждый баг и каждое улучшение: поведение записывается в `use-cases/`, на него пишется тест, который
падает без правки, и строка в `testing/REGRESSION.md` + `testing/REQUEST-HISTORY.md`. Подробно —
`CLAUDE.md`, раздел «Каждый баг и каждое улучшение»; чек-лист — `.github/pull_request_template.md`.
