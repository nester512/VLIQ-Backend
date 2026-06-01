# dev-standards

Личная библиотека Cursor-артефактов: правила, slash-команды, профили субагентов,
скилы. Собрано из проекта `A-LAB-test` (2026-05). Используется как **шаблон**
при бутстрапе новых репозиториев.

## Структура

```
~/dev-standards/
├── cursor-rules/             # .mdc — auto-attach по globs (alwaysApply / by path)
├── cursor-commands/          # /slash-команды (.md в .cursor/commands/)
├── cursor-agents/            # профили субагентов (.md в .cursor/agents/)
├── cursor-skills/            # навыки (skill folder), grouped by name
├── templates/                # AGENTS.md.example и прочие корневые шаблоны
└── _project-specific/        # НЕ универсальные — взято как пример, переписать под себя
```

### Что лежит и зачем

| Файл | Зачем |
|------|-------|
| `cursor-rules/core-workflow.mdc` | Всегда включено: честность с user, не выдумывать API, проверять линт/тесты после правок |
| `cursor-rules/rules-python-dev.mdc` | Python-код: типизация, error-handling, чистые границы слоёв |
| `cursor-rules/rules-python-tests.mdc` | Юнит-тесты Python: моки только на границах, фикстуры |
| `cursor-rules/rules-python-functional-tests.mdc` | Функциональные/integration: real DB, не моки |
| `cursor-rules/rules-frontend-dev.mdc` | React/TS: memoization, AbortController, типы из API |
| `cursor-rules/rules-frontend-tests.mdc` | Frontend tests: RTL patterns, мок только сети |
| `cursor-rules/rules-analytics.mdc` | NET vs GROSS, multi-market max-not-sum, TZ, finres semantics |
| `cursor-rules/rules-devops.mdc` | Docker, TLS-renewal, секреты в `.env`, не в репо |
| `cursor-rules/rules-performance.mdc` | useMemo для polling, кэш с TTL, dedup ключи |
| `cursor-commands/branch.md` | Создать ветку по правилам именования |
| `cursor-commands/switch-branch.md` | Переключение с git stash safety-check |
| `cursor-commands/push.md` | Pre-push: тесты + линт, коммит сообщение |
| `cursor-commands/code-review.md` | Локальное ревью diff'а перед PR |
| `cursor-commands/respond-to-review.md` | Ответы на PR comments |
| `cursor-commands/work-item.md` | Создать черновик плана в `.cursor/plans/` |
| `cursor-commands/sync-cursor-standards.md` | Подтянуть стандарты из `$CURSOR_DEV_TEMPLATE` (этой папки) |
| `cursor-agents/code-reviewer.md` | Diff review subagent |
| `cursor-agents/python-service-dev.md` | Реализация Python-сервисов |
| `cursor-agents/python-test-qa.md` | Покрытие тестами Python |
| `cursor-agents/frontend-dev.md` | React/TS реализация |
| `cursor-agents/functional-test-async-refactor.md` | Перевод sync→async тестов |
| `cursor-agents/repo-workspace-sync.md` | Синхронизация workspace state |
| `cursor-skills/pro-dev-standards/SKILL.md` | Skill: маппинг внешних соглашений в Cursor (используется при онбординге репо) |
| `templates/AGENTS.md.example` | Каркас корневого AGENTS.md для нового репо |

### `_project-specific/`

Артефакты, привязанные к стеку A-LAB (MSSQL FuncWeb*, FSR-аккаунты). Полезны как
**референс** при создании аналогичных профилей для другого проекта — структуру и
системные промпты можно скопировать, конкретику переписать.

## Bootstrap нового репо

### Вариант 1 — вручную (быстро, прицельно)

```bash
cd /path/to/new-repo
mkdir -p .cursor/{rules,commands,agents,skills}

# Минимум для любого проекта:
cp ~/dev-standards/cursor-rules/core-workflow.mdc .cursor/rules/
cp ~/dev-standards/cursor-commands/{branch,push,code-review,work-item}.md .cursor/commands/
cp ~/dev-standards/cursor-agents/code-reviewer.md .cursor/agents/
cp ~/dev-standards/templates/AGENTS.md.example AGENTS.md

# Доп. для Python-проекта:
cp ~/dev-standards/cursor-rules/rules-python-{dev,tests,functional-tests}.mdc .cursor/rules/
cp ~/dev-standards/cursor-agents/python-{service-dev,test-qa}.md .cursor/agents/

# Доп. для React/фронта:
cp ~/dev-standards/cursor-rules/rules-frontend-{dev,tests}.mdc .cursor/rules/
cp ~/dev-standards/cursor-agents/frontend-dev.md .cursor/agents/

# Если есть аналитика/полли финансовая семантика:
cp ~/dev-standards/cursor-rules/rules-{analytics,performance}.mdc .cursor/rules/
```

После копирования отредактируй `AGENTS.md` под структуру конкретного репо.

### Вариант 2 — через slash-команду

В новом репо:

```bash
export CURSOR_DEV_TEMPLATE=~/dev-standards
```

(добавь в `~/.zshrc` чтобы было постоянно)

Затем в Cursor открой проект и вызови `/sync-cursor-standards` — команда читает
`$CURSOR_DEV_TEMPLATE`, делает `rsync` `.cursor/` и предлагает сравнить
`AGENTS.md.example` с твоим.

**Важно:** команда rsync'ит ВСЕ файлы из `$CURSOR_DEV_TEMPLATE/.cursor/`, поэтому
если хочешь шаблонировать не всё — держи отдельную «эталонную» подпапку с только
нужным набором и указывай её через переменную.

## Обновление шаблонов

Когда в новом проекте улучшил правило/команду — занеси изменения обратно:

```bash
# Сравнить и скопировать вручную:
diff ~/dev-standards/cursor-rules/rules-python-dev.mdc \
     /path/to/project/.cursor/rules/rules-python-dev.mdc

# Если в проекте лучше — переписать в шаблон:
cp /path/to/project/.cursor/rules/rules-python-dev.mdc \
   ~/dev-standards/cursor-rules/
```

Опционально завести в этой папке git:

```bash
cd ~/dev-standards
git init && git add -A && git commit -m "snapshot 2026-05-20"
# и push в личный приватный repo для бэкапа между машинами
```

## Что НЕ перенесено

- `.claude/settings.local.json` — содержит локальные permissions, чужому проекту
  не подходит; настраивай через UI каждого проекта.
- Memory-файлы (`~/.claude/projects/*/memory/`) — это per-project, не шаблон.
- Конкретные конфиги (docker-compose, .env, .gitignore проекта) — не наша
  территория, копируются вместе с шаблоном репозитория, не отдельно.
