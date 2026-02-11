---
name: feature-tasks
description: Break a feature request into dependency-aware implementation tasks and generate a machine-readable task graph. Use when planning or executing feature work that needs task IDs, blockers, critical paths, or parallel work windows.
---

# Feature Tasks

Create or update a `tasks.yaml` plan and generate `task.graph.json` from it.

## Workflow

1. Clarify feature scope, constraints, and acceptance criteria.
2. Author `tasks.yaml` at the target repository root using this schema.
3. Validate graph parity by running the bundled script.
4. Fix any reported ID/dependency/path/window errors.
5. Use `task.graph.json` to drive implementation order.

## tasks.yaml schema

```yaml
version: 1
project: <project-name>
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
  - id: pw-backend-frontend
    tasks: [TASK-010, TASK-020]
```

## Execution

Run from the target repository:

```bash
node <path-to-skill>/scripts/generate-task-graph.mjs [input-tasks-yaml] [output-graph-json]
```

Defaults when arguments are omitted:

- Input: `<git-root>/tasks.yaml` (or `<cwd>/tasks.yaml` outside git)
- Output: `<git-root>/task.graph.json` (or `<cwd>/task.graph.json` outside git)

## Output requirements

- Keep all task IDs unique and stable.
- Ensure every `blocked_by` dependency references an existing task.
- Ensure `critical_paths[*].tasks` and `parallel_windows[*].tasks` only reference existing task IDs.
- Avoid dependency cycles.
- Include actionable, implementation-ready task titles.

## Companion Skill

- Use `feature-tasks-work` for orchestration mode after planning is complete.
