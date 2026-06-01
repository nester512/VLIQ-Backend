# _project-specific

Артефакты, заточенные под конкретный стек проекта **A-LAB-test** (MSSQL терминалы
FSR, FuncWeb* TVF, multi-market stocks+futures).

**Не копировать as-is в другой проект.** Используй как:
- референс структуры (system prompt, чеклисты, формат отчёта)
- пример того, как описывать domain-specific QA-агента
- источник идей для своего стека (Postgres-only, Clickhouse, ML-pipelines, etc.)

## Что внутри

| Файл | Что описывает | Что переписать под себя |
|------|---------------|--------------------------|
| `agents/fsr-mssql-integration-qa.md` | Интеграционные тесты с реальным MSSQL | Заменить connection-string шаблоны, TVF-имена, схему таблиц |
| `agents/fsr-mssql-read-side-reviewer.md` | Ревью read-side кода против MSSQL | Сменить контракты функций, dedup-правила |
| `agents/fsr-mssql-workstream-coordinator.md` | Координация задач между фронтом и MSSQL | Сменить названия стеков |
| `agents/mssql-catalog-qa.md` | Проверка каталога MSSQL TVF | Целиком переписать для своей БД |

## Если делаешь похожий проект

Скопируй файл целиком и используй как rewrite-source:

```bash
cp ~/dev-standards/_project-specific/agents/fsr-mssql-integration-qa.md \
   /path/to/new-project/.cursor/agents/my-db-integration-qa.md
# затем открой и перепиши под свою БД
```
