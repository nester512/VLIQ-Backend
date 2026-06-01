---
name: pro-dev-standards
description: Maps external development conventions onto Cursor without vendor-specific tooling. Use when porting team conventions to a repo, setting up .cursor/rules and commands, or improving project workflow standards.
disable-model-invocation: true
---

# Pro dev standards (Cursor port)

## Goal

Bring **structure and quality** from an external development template into Cursor: rules, optional slash commands, project memory — **without** private services, proprietary CLIs, custom hooks, or duplicating subagents that already live under `.cursor/agents/`.

## Do not copy as-is

| Source | Why skip / replace |
|--------|-------------------|
| `agents/*.md` | Уже есть универсальные субагенты в `.cursor/agents/`. Не копировать vendor-specific dev/test/repo-sync профили — это дублирование и привязка к чужой инфраструктуре. |
| Внешний orchestrator-файл | Запрет «никогда не пиши код сам» и обязательное делегирование только в агентов — специфика отдельных инструментов. В Cursor основной агент обычно **пишет код**; оркестрация — опционально для крупных задач. |
| Секции приватных MCP / порталов | Внутренние URL, gateway-имена и приватные docs/search-инструменты не переносить. |
| `settings.local.json` из примера | `permissions`, `additionalDirectories` с чужими `$HOME`, локальные hooks и приватные CLIs — не переносить. В Cursor: свои MCP и пути только под вашу машину. |
| Команды ревью/трекера/смены команды | Сценарии с закрытыми API, токенами, локальными базами ревью и служебными пользователями — выкинуть или упростить до «diff + checklist» без внешних API. |

## Целевое состояние в IDE (этот репозиторий)

Уже разложено под Cursor:

| Слой | Путь |
|------|------|
| Всегда включённые правила | `.cursor/rules/core-workflow.mdc` (`alwaysApply: true`) |
| Правила по glob | `rules-python-dev.mdc`, `rules-python-tests.mdc`, `rules-python-functional-tests.mdc`, `rules-frontend-dev.mdc`, `rules-frontend-tests.mdc` (формат **`.mdc`**, поля `description`, `globs`, `alwaysApply`) |
| Slash-команды | `.cursor/commands/*.md` — `branch`, `switch-branch`, `push`, `code-review`, `respond-to-review`, `work-item`, `sync-cursor-standards` |
| Память репо | корневой `AGENTS.md` |
| Черновики планов | `.cursor/plans/` (создаётся `/work-item`) |
| Субагенты | `.cursor/agents/*.md` (не дублировать из внешнего `agents/`) |

Синхронизация с локальным «эталоном» (без vendor-specific шаблона): переменная **`CURSOR_DEV_TEMPLATE`** → см. команду `/sync-cursor-standards`.

## What to adopt (из внешнего шаблона)

1. **Правила** — только универсальная семантика; в Cursor хранить как **`.mdc`** с `globs` / `alwaysApply` (см. таблицу выше). Не копировать приватные MCP и закрытые CLI.
2. **Память** — корневой `AGENTS.md`, без tool-specific project-memory каталогов.
3. **Команды** — переносить смысл (`branch`, `push`, ревью) в `.cursor/commands/*.md`, вырезая закрытые API, Co-Authored-By и приватные CLI.
4. **Практики**
   - Неуверенность → читать репо и доки, спросить пользователя.
   - После правок → линтер/тесты из README / `package.json` / `pyproject.toml`.
   - Требования от стейкхолдера менялись 2+ раза за сессию → сводка и пауза до финального подтверждения.

## Mapping: исходные `rules/*.md` → текущие `.mdc`

| Исходник (пример) | Файл в репо |
|-------------------|-------------|
| `rules_python_dev` | `rules-python-dev.mdc` |
| `rules_python_tests` | `rules-python-tests.mdc` |
| `rules_python_functional_tests` | `rules-python-functional-tests.mdc` |
| *(дополнение)* | `rules-frontend-dev.mdc`, `rules-frontend-tests.mdc` |

## When editing rules

- Формат Cursor: YAML с **`description`**, опционально **`globs`** (строка; несколько шаблонов через запятую, если поддерживает ваша версия), **`alwaysApply`**.
- Тело правила — коротко и проверяемо; детали стека — «как в проекте».

## Verification

Открой файлы `*.py`, `*.tsx`, `**/tests/**/*.py` — в UI правил должны подсветиться соответствующие `.mdc`. Если glob не срабатывает, разбей на два файла с одним шаблоном в каждом.
