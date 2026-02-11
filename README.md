# feature-tasks skills

Cross-agent skill pack for planning and executing feature work with dependency-aware task graphs.

This repository uses the open `.agents/skills` layout so it works with Codex, Claude Code, and other agents supported by `skills.sh`.

## Included skills

- `feature-tasks`
  - Build or update `tasks.yaml`
  - Validate dependencies and graph parity
  - Generate `task.graph.json` using the bundled script
- `feature-tasks-work`
  - Reset context before execution (`/clear` or `/new` when supported)
  - Read `SPEC.md`, `tasks.yaml`, optionally `task.graph.json`
  - Orchestrate and delegate tasks to collaborators/subagents in dependency order

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

## How `feature-tasks` works

1. Create `tasks.yaml` at the target repo root.
2. Run the graph generator script.
3. Resolve any validation errors (missing IDs, duplicates, cycles, invalid references).
4. Use `task.graph.json` as the execution plan.

Example generator command:

```bash
node .agents/skills/feature-tasks/scripts/generate-task-graph.mjs [input-tasks-yaml] [output-graph-json]
```

Defaults when args are omitted:

- input: `<git-root>/tasks.yaml` (or `<cwd>/tasks.yaml` outside git)
- output: `<git-root>/task.graph.json` (or `<cwd>/task.graph.json` outside git)

Minimal `tasks.yaml`:

```yaml
version: 1
project: my-project
tasks:
  - id: TASK-001
    phase: planning
    priority: high
    title: Define acceptance criteria
    blocked_by: []
critical_paths:
  - id: cp-main
    tasks: [TASK-001]
parallel_windows:
  - id: pw-1
    tasks: [TASK-001]
```

## How `feature-tasks-work` works

`feature-tasks-work` is the execution/orchestration companion skill.

Expected flow:

1. Reset context (`/clear` or `/new` where available).
2. Read `SPEC.md`.
3. Read `tasks.yaml`.
4. Optionally read `task.graph.json`.
5. Dispatch unblocked tasks to collaborators/subagents.
6. Run independent tasks in parallel.
7. Report progress and blockers continuously.

## Compatibility notes

- Canonical source is `.agents/skills` for maximum portability.
- `agents/openai.yaml` is optional UI metadata for OpenAI/Codex surfaces.
- Claude Code uses `SKILL.md` frontmatter/body directly.
