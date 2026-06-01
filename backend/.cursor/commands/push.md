# /push

Закоммитить изменения, подтянуть базовую ветку с rebase и запушить текущую ветку.

**Опциональный аргумент:** полный текст сообщения коммита. Если нет — сформируй из `git diff` кратко и по-человечески.

## Определить базовую ветку

Выполни и возьми первое непустое:

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

Если пусто — проверь поочерёдно существование `origin/main`, затем `origin/master`; используй то, что есть.

Назови результат `BASE` (например `main`).

## Шаги

1. `git branch --show-current` → `CURRENT`.
2. `git status` — если нечего коммитить, перейди сразу к pull (шаг 5).
3. Сообщение коммита: из аргумента пользователя или из анализа диффа (conventional commits по желанию команды: `feat:`, `fix:` и т.д.).
4. `git add -A` и `git commit -m "<message>"`. Если pre-commit hook упал — исправь и повтори; не используй `--no-verify` без явного указания пользователя.
5. `git fetch origin` и `git pull --rebase origin "$BASE"`.
6. При конфликтах rebase: покажи файлы, помоги разрешить, `git add` и `git rebase --continue` до конца.
7. `git push -u origin "$CURRENT"` (первый push) или `git push origin "$CURRENT"`.

## Итог

Сообщи ветку, хеш коммита (если был новый коммит) и что push прошёл.

## Не делать

- Не добавляй Co-Authored-By и не пушь на дополнительные зеркала без запроса.
- Не делай `git push --force` без явного согласия пользователя.
