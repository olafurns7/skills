---
name: feature-tasks-work
description: Orchestrate execution from feature task plans. Use when work should start from SPEC.md and tasks.yaml, optionally using task.graph.json, by delegating implementation tasks to collaborators or subagents.
---

# Feature Tasks Work

Execute planned work as an orchestrator with deterministic delegation and status tracking.

## Protocol

1. Reset context before orchestration. If your agent supports session reset commands, use `/clear` or `/new`.
2. Run preflight checks:
   - `SPEC.md` must exist and be readable.
   - `tasks.yaml` must exist and be readable.
   - Read `task.graph.json` if present; otherwise derive dependency order from `tasks.yaml`.
3. Initialize or load `task.status.json` at repository root.
4. Dispatch only unblocked tasks where every dependency in `blocked_by` is `done`.
5. Delegate each dispatched task to a teammate/collaborator/subagent.
6. Allow parallel dispatch for independent unblocked tasks.
7. After every task attempt, update `task.status.json` immediately.
8. Retry policy:
   - Retry once for transient or protocol-shape failures.
   - If still failing, mark task `blocked`, record blockers, continue with other unblocked tasks.
9. Complete when all tasks are `done` or terminal `blocked`.
10. Emit a final orchestration summary with done/blocked counts and unresolved blockers.

## Delegation response contract (required)

Every delegated task must return all fields below:

- `task_id`
- `result` (`done|blocked|failed`)
- `result_summary`
- `files_changed` (array)
- `tests_run` (array)
- `blockers` (array)
- `next_unblocked_tasks` (array of task IDs)

Treat missing required fields as protocol failure and apply retry policy.

## task.status.json schema

Default path: `task.status.json` in repository root.

```json
{
  "project": "my-project",
  "schema_version": 2,
  "updated_at": "2026-02-11T12:00:00.000Z",
  "summary": {
    "todo": 2,
    "in_progress": 1,
    "done": 3,
    "blocked": 1
  },
  "tasks": {
    "TASK-001": {
      "state": "done",
      "owner": "subagent-backend-1",
      "attempts": 1,
      "started_at": "2026-02-11T11:40:00.000Z",
      "finished_at": "2026-02-11T11:55:00.000Z",
      "blockers": [],
      "files_changed": ["src/api/orders.ts"],
      "tests_run": ["npm test -- orders"],
      "result_summary": "Implemented order endpoint and tests.",
      "next_unblocked_tasks": ["TASK-002"]
    }
  }
}
```

## State semantics

- `todo`: not started.
- `in_progress`: delegated and awaiting result.
- `done`: completed and accepted.
- `blocked`: cannot proceed after retry policy or hard dependency blockage.

Only dispatch tasks in `todo` state that are currently unblocked.
