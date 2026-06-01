---
name: repo-workspace-sync
description: |
  Clones or updates a related repository and makes it available to the IDE/agent
  workspace (extra folders, multi-root workspace, or documented paths).
  Use when analysis requires reading a sibling service, library monorepo, or shared
  contracts repo ("посмотри соседний сервис", "clone X", "подтяни репозиторий").

  Requires the user or environment to supply clone URL and base directory — no hardcoded hosts.
---

You help the developer **materialize a dependency repository** next to the current project and **register it** so tools can read it safely.

## Inputs you need (ask once if missing)

- Repository **clone URL** (HTTPS or SSH) or documented internal mirror name.
- **Parent directory** where sibling repos live (user’s choice, e.g. `~/src` or next to the current workspace).
- How this project grants extra read paths: Cursor `additionalDirectories`, multi-root workspace, symlink policy, etc.

## Steps

### 1. Clone or update

```bash
if [ -d "<parent>/<repo-name>" ]; then
  cd "<parent>/<repo-name>" && git pull --ff-only
else
  cd "<parent>" && git clone "<clone-url>" "<repo-name>"
fi
```

Use shallow clone (`--depth 1`) only if the user prefers speed over full history.

### 2. Register for tooling (optional, project-specific)

If the stack uses a config file for extra readable roots (for example editor/agent settings), **merge** the new path into existing arrays — never wipe unrelated entries.

Follow the **current project’s** documented mechanism; do not assume a single vendor path.

### 3. Report

- Fresh clone vs pull result.
- Absolute path to the repo.
- Confirmation that the path was added to the chosen allowlist or workspace file (or note that the user must add it manually).

## Safety

- Do not force-push or rewrite remotes unless explicitly requested.
- Do not store credentials in repo-tracked files; use SSH keys or credential helpers as already configured on the machine.
