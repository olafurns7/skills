# feature-tasks skills

Cross-agent skill pack for planning and executing feature work with dependency-aware task graphs.

This repository uses the open `.agents/skills` layout so it works with Codex, Claude Code, and other agents supported by `skills.sh`.

## Included skills

- `feature-tasks`
  - Builds or updates strict `tasks.yaml` schema v3
  - Validates dependencies, references, and cycles
  - Generates deterministic `task.graph.json`
- `feature-tasks-work`
  - Runs orchestration from `SPEC.md` + planning artifacts
  - Uses `scripts/taskctl` (bundled from TypeScript) for status updates and prompt assembly
  - Delegates tasks to other agent/model worker instances with a required response contract
  - Maintains resumable execution state in `task.status.json`

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

Install all skills from this repo (with interactive agent selection):

```bash
npx skills@latest add olafurns7/skills --skill '*'
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

- `scripts/taskctl.mjs` (bundled CLI script)
- `scripts/taskctl` launcher wrapper

```bash
bun run build
```

Individual build commands:

```bash
bun run build:feature-tasks
bun run build:feature-tasks-work
bun run build:feature-tasks-work:script
```

## `feature-tasks`: strict planning schema

Planning artifacts are stored per feature under:

- `planning/<dd-mm-yyyy-title-slug>/SPEC.md`
- `planning/<dd-mm-yyyy-title-slug>/tasks.yaml`
- `planning/<dd-mm-yyyy-title-slug>/task.graph.json`

`tasks.yaml` uses strict schema v3. `version` must be `3`.

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
- `context` (array of strings)

Example `tasks.yaml`:

```yaml
version: 3
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
    context:
      - src/payments/login.ts
      - SPEC.md#login-flow
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

Installed-skill equivalent:

```bash
<path-to-skill>/scripts/generate-task-graph [title-slug] [output-graph-json]
```

Default behavior:

- input: `<git-root>/planning/<dd-mm-yyyy-title-slug>/tasks.yaml`
- output: `<git-root>/planning/<dd-mm-yyyy-title-slug>/task.graph.json`
- if `title-slug` is omitted, it is derived from branch name (common prefixes like `feat-`, `fix-` are stripped), then new folders are resolved as `dd-mm-yyyy-<slug>` (existing non-prefixed folders are reused)

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

Always call `"$TASKCTL" ...` and do not assume `taskctl` is on `PATH`.

Runtime behavior of `scripts/taskctl`:

- runs `node taskctl.mjs` when Node.js is available
- otherwise runs `bun taskctl.mjs` when Bun is available
- if neither is installed: exits with an install message

Core orchestration loop:

```bash
"$TASKCTL" init <title-slug>
"$TASKCTL" dispatch <title-slug> --owner <owner-id> --json
"$TASKCTL" complete <title-slug> <task-id> --result done --summary "..." --files a,b --tests c,d --next TASK-XYZ
"$TASKCTL" status <title-slug> --json
```

Execution flow:

1. Reset context (`/clear` or `/new` where available).
2. Resolve `title-slug` and work inside `planning/<dd-mm-yyyy-title-slug>/` for new folders (existing non-prefixed folders are reused).
3. Preflight: require readable `planning/<dd-mm-yyyy-title-slug>/SPEC.md` and `planning/<dd-mm-yyyy-title-slug>/tasks.yaml`; use `planning/<dd-mm-yyyy-title-slug>/task.graph.json` if present.
4. Initialize/load `planning/<dd-mm-yyyy-title-slug>/task.status.json`.
5. Dispatch only unblocked `todo` tasks.
6. Delegate each task to another agent/model worker instance.
7. Run independent tasks in parallel when safe.
8. Update `task.status.json` after every attempt.
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

Terminology note:
- In this repo, `collaborator`, `subagent`, and `teammate` mean a worker identity (agent/model/session id), not a filesystem path.

## `task.status.json` contract

Default path: `planning/<dd-mm-yyyy-title-slug>/task.status.json`.

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
