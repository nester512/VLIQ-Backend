# /sync-cursor-standards

Проверить, что в репозитории разложены **универсальные** артефакты Cursor (без копирования из закрытых шаблонов, если переменная не задана).

## 1. Обязательный аудит в текущем репо

Убедись, что существуют:

- `.cursor/rules/core-workflow.mdc` с `alwaysApply: true`
- остальные `.mdc` с `globs` для Python/фронта/тестов
- `.cursor/commands/` с базовыми командами (`branch`, `push`, `code-review`, …)
- `.cursor/agents/` — профили команды
- корневой `AGENTS.md`

Если чего-то нет — предложи создать по образцу из `@pro-dev-standards` или восстановить из VCS.

## 2. Опционально: копирование из локального шаблона

Если пользователь задал переменную окружения **`CURSOR_DEV_TEMPLATE`** (абсолютный путь к каталогу с эталоном `.cursor/` и `AGENTS.md`):

```bash
TEMPLATE="${CURSOR_DEV_TEMPLATE:?}"
ROOT="$(git rev-parse --show-toplevel)"
rsync -a --exclude='.git' "$TEMPLATE/.cursor/" "$ROOT/.cursor/"
# при наличии шаблонного AGENTS.md — только по согласию, чтобы не затереть кастом:
# test -f "$TEMPLATE/AGENTS.md" && cp "$TEMPLATE/AGENTS.md" "$ROOT/AGENTS.md.example"
```

Перед перезаписью сравни diff и **не** затирай уникальное без подтверждения.

## 3. Отчёт

Список проверенных путей и что было создано/обновлено/пропущено.
