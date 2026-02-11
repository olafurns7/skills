---
name: feature-tasks
description: Break a feature request into dependency-aware implementation tasks and generate a machine-readable task graph. Use when planning or executing feature work that needs task IDs, blockers, critical paths, or parallel work windows.
---

# Feature Tasks

Create or update a `tasks.yaml` plan (schema v2) and generate `task.graph.json`.

## Workflow

1. Clarify feature scope, constraints, and acceptance criteria.
2. Author `tasks.yaml` at repository root using the strict schema below.
3. Run the bundled script to validate and generate `task.graph.json`.
4. Fix all schema and parity errors until generation succeeds.
5. Use `task.graph.json` to drive execution order.

## tasks.yaml schema (strict)

`version` must be `2`.

```yaml
version: 2
project: <project-name>
tasks:
  - id: TASK-001
    phase: planning
    priority: high # low | medium | high | critical
    title: Define acceptance criteria and scope
    blocked_by: []
    acceptance:
      - Acceptance criteria reviewed by stakeholders
    deliverables:
      - docs/spec.md updated with final scope
    owner_type: docs # frontend | backend | infra | docs | qa | fullstack
    estimate: M
    notes: Optional context
critical_paths:
  - id: cp-main
    tasks: [TASK-001]
parallel_windows:
  - id: pw-initial
    tasks: [TASK-001]
```

## Required task fields

Every task must include:

- `id` (unique string)
- `phase` (string)
- `priority` (`low|medium|high|critical`)
- `title` (string)
- `blocked_by` (array of task IDs; empty allowed)
- `acceptance` (non-empty array of strings)
- `deliverables` (non-empty array of strings)
- `owner_type` (`frontend|backend|infra|docs|qa|fullstack`)
- `estimate` (string)

Optional:

- `notes` (string)

## Execution

Run from the target repository:

```bash
node <path-to-skill>/scripts/generate-task-graph.mjs [input-tasks-yaml] [output-graph-json]
```

Defaults when arguments are omitted:

- Input: `<git-root>/tasks.yaml` (or `<cwd>/tasks.yaml` outside git)
- Output: `<git-root>/task.graph.json` (or `<cwd>/task.graph.json` outside git)

## Validation and parity checks

The script fails with actionable errors when:

- Required fields are missing
- `version` is not `2`
- `priority` or `owner_type` enum values are invalid
- Task IDs are duplicated
- `blocked_by` references unknown IDs
- `critical_paths[*].tasks` or `parallel_windows[*].tasks` reference unknown IDs
- A task depends on itself
- Dependency cycles exist

## Companion Skill

Use `feature-tasks-work` for orchestration mode after planning is complete.
