# feature-tasks skills

Cross-agent skill pack for planning and executing feature work with dependency-aware task graphs.

This repository uses the open `.agents/skills` layout so it works with Codex, Claude Code, and other agents supported by `skills.sh`.

## Included skills

- `feature-tasks`
  - Builds or updates strict `tasks.yaml` schema v2
  - Validates dependencies, references, and cycles
  - Generates deterministic `task.graph.json`
- `feature-tasks-work`
  - Runs orchestration from `SPEC.md` + planning artifacts
  - Uses `scripts/taskctl` (bundled from TypeScript) for status updates and prompt assembly
  - Delegates tasks to collaborators/subagents with a required response contract
  - Maintains resumable execution state in `task.db` and exports `task.status.json` snapshots

## Repository structure

```text
.agents/skills/
  feature-tasks/
    SKILL.md
    scripts/generate-task-graph
    scripts/generate-task-graph.mjs
    agents/openai.yaml
  feature-tasks-work/
    SKILL.md
    scripts/taskctl
    scripts/taskctl.mjs
    agents/openai.yaml
src/
  generate-task-graph.ts
  index.ts
```

## Install with skills.sh

Install all skills from this repo:

```bash
npx skills add olafurns7/skills --all
```

List available skills from this repo:

```bash
npx skills@latest add olafurns7/skills --list
```

Install both skills for Codex and Claude Code:

```bash
npx skills@latest add olafurns7/skills \
  --skill feature-tasks \
  --skill feature-tasks-work \
  --agent codex \
  --agent claude-code \
  -y
```

Install from local checkout:

```bash
npx skills@latest add . --skill feature-tasks --skill feature-tasks-work -y
```

## Build scripts

TypeScript sources live in `src/` and are bundled with Bun into committed artifacts under `.agents/skills/*/scripts/`.

For `feature-tasks-work`, build produces:

- `scripts/taskctl.mjs` (bundled Bun runtime script)
- `scripts/taskctl` launcher wrapper

```bash
npm run build
```

Individual build commands:

```bash
npm run build:feature-tasks
npm run build:feature-tasks-work
npm run build:feature-tasks-work:script
```

## `feature-tasks`: strict planning schema

Planning artifacts are stored per feature under:

- `planning/<title-slug>/SPEC.md`
- `planning/<title-slug>/tasks.yaml`
- `planning/<title-slug>/task.graph.json`
- `planning/<title-slug>/task.db`
- `planning/<title-slug>/task.status.json` (exported snapshot)

`tasks.yaml` uses strict schema v2. `version` must be `2`.

Required task fields:

- `id` (unique string)
- `phase` (string)
- `priority` (`low|medium|high|critical`)
- `title` (string)
- `blocked_by` (array of task IDs; empty allowed)
- `acceptance` (non-empty array of strings)
- `deliverables` (non-empty array of strings)
- `owner_type` (`frontend|backend|infra|docs|qa|fullstack`)
- `estimate` (string)

Optional task field:

- `notes` (string)

Example `tasks.yaml`:

```yaml
version: 2
project: my-project
tasks:
  - id: TASK-001
    phase: planning
    priority: high
    title: Define acceptance criteria
    blocked_by: []
    acceptance:
      - Stakeholders approve scope
    deliverables:
      - docs/spec.md updated
    owner_type: docs
    estimate: M
    notes: Optional context
critical_paths:
  - id: cp-main
    tasks: [TASK-001]
parallel_windows:
  - id: pw-1
    tasks: [TASK-001]
```

Generate graph:

```bash
.agents/skills/feature-tasks/scripts/generate-task-graph [title-slug] [output-graph-json]
```

Default behavior:

- input: `<git-root>/planning/<title-slug>/tasks.yaml`
- output: `<git-root>/planning/<title-slug>/task.graph.json`
- if `title-slug` is omitted, it is derived from branch name (common prefixes like `feat-`, `fix-` are stripped)

Validation failures include:

- Missing required fields
- Invalid enum values (`priority`, `owner_type`)
- Duplicate task IDs
- Missing dependency/path/window references
- Self-dependencies
- Dependency cycles

## `feature-tasks-work`: orchestration protocol

Prefer a CLI-first workflow (instead of manual edits to state artifacts):

```bash
TASKCTL=".agents/skills/feature-tasks-work/scripts/taskctl"
```

Runtime selection in `scripts/taskctl`:

- runs `bun taskctl.mjs`
- if Bun is not installed: exits with an install message

Core orchestration loop:

```bash
"$TASKCTL" init <title-slug>
"$TASKCTL" dispatch <title-slug> --owner <owner-id> --json
"$TASKCTL" complete <title-slug> <task-id> --result done --summary "..." --files a,b --tests c,d --next TASK-XYZ
"$TASKCTL" status <title-slug> --json
```

Execution flow:

1. Reset context (`/clear` or `/new` where available).
2. Resolve `title-slug` and work inside `planning/<title-slug>/`.
3. Preflight: require readable `planning/<title-slug>/SPEC.md` and `planning/<title-slug>/tasks.yaml`; use `planning/<title-slug>/task.graph.json` if present.
4. Initialize/load `planning/<title-slug>/task.db` and export `planning/<title-slug>/task.status.json`.
5. Dispatch only unblocked `todo` tasks.
6. Delegate each task to collaborator/subagent.
7. Run independent tasks in parallel when safe.
8. Update `task.db` after every attempt and export `task.status.json`.
9. Retry once for transient/protocol failures; then mark `blocked` and continue.
10. Finish when all tasks are `done` or terminal `blocked`.

Required delegation response fields:

- `task_id`
- `result` (`done|blocked|failed`)
- `result_summary`
- `files_changed` (array)
- `tests_run` (array)
- `blockers` (array)
- `next_unblocked_tasks` (array)

## `task.status.json` contract

Default path: `planning/<title-slug>/task.status.json` (exported compatibility snapshot from `task.db`).

Top-level fields:

- `project`
- `schema_version`
- `updated_at`
- `summary` (`todo`, `in_progress`, `done`, `blocked`)
- `tasks` (object keyed by task ID)

Per-task status fields:

- `state` (`todo|in_progress|done|blocked`)
- `owner`
- `attempts`
- `started_at`
- `finished_at`
- `blockers`
- `files_changed`
- `tests_run`
- `result_summary`
- `next_unblocked_tasks`

## Compatibility notes

- Canonical source is `.agents/skills` for maximum portability.
- `agents/openai.yaml` is optional UI metadata for OpenAI/Codex surfaces.
- Claude Code uses `SKILL.md` frontmatter/body directly.
