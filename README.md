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
  - Delegates tasks to collaborators/subagents with a required response contract
  - Maintains resumable execution state in `task.status.json`

## Repository structure

```text
.agents/skills/
  feature-tasks/
    SKILL.md
    scripts/generate-task-graph.mjs
    agents/openai.yaml
  feature-tasks-work/
    SKILL.md
    agents/openai.yaml
```

## Install with skills.sh

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

## `feature-tasks`: strict planning schema

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
node .agents/skills/feature-tasks/scripts/generate-task-graph.mjs [input-tasks-yaml] [output-graph-json]
```

Defaults when args are omitted:

- input: `<git-root>/tasks.yaml` (or `<cwd>/tasks.yaml` outside git)
- output: `<git-root>/task.graph.json` (or `<cwd>/task.graph.json` outside git)

Validation failures include:

- Missing required fields
- Invalid enum values (`priority`, `owner_type`)
- Duplicate task IDs
- Missing dependency/path/window references
- Self-dependencies
- Dependency cycles

## `feature-tasks-work`: orchestration protocol

Execution flow:

1. Reset context (`/clear` or `/new` where available).
2. Preflight: require readable `SPEC.md` and `tasks.yaml`; use `task.graph.json` if present.
3. Initialize/load `task.status.json` at repo root.
4. Dispatch only unblocked `todo` tasks.
5. Delegate each task to collaborator/subagent.
6. Run independent tasks in parallel when safe.
7. Update `task.status.json` after every attempt.
8. Retry once for transient/protocol failures; then mark `blocked` and continue.
9. Finish when all tasks are `done` or terminal `blocked`.

Required delegation response fields:

- `task_id`
- `result` (`done|blocked|failed`)
- `result_summary`
- `files_changed` (array)
- `tests_run` (array)
- `blockers` (array)
- `next_unblocked_tasks` (array)

## `task.status.json` contract

Default path: `task.status.json` in repository root.

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
