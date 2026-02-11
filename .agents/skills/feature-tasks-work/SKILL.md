---
name: feature-tasks-work
description: Orchestrate execution from feature task plans. Use when work should start from SPEC.md and tasks.yaml, optionally using task.graph.json, by delegating implementation tasks to collaborators or subagents.
---

# Feature Tasks Work

Execute planned work as an orchestrator with deterministic delegation and status tracking.

## Protocol

1. Start orchestration with minimal prior context. If your agent supports
   session or conversation reset, use it before beginning.
2. Resolve `title-slug` for the feature (for example `add-new-payment-method`) and use that folder under `planning/`.
3. Run preflight checks:
   - Read `planning/<title-slug>/SPEC.md` if present. If missing, log a warning
     but continue — delegation prompts will omit the spec excerpt.
   - `planning/<title-slug>/tasks.yaml` must exist and be readable.
   - Read `planning/<title-slug>/task.graph.json` if present; otherwise derive dependency order from `tasks.yaml`.
4. Initialize or load `planning/<title-slug>/task.status.json`. If the file
   exists (resuming), reset any `in_progress` tasks to `todo` (previous session
   may have died mid-dispatch). Preserve `done` and `blocked` states.
5. Dispatch only unblocked tasks where every dependency in `blocked_by` is `done`.
6. Delegate each dispatched task using the delegation prompt contract below.
7. Allow parallel dispatch for independent unblocked tasks.
8. After every task attempt, update `task.status.json` immediately.
9. Retry policy:
   - **Protocol failure** (missing response fields): retry once with a format reminder appended.
   - **Transient failure** (timeout, rate limit): retry once after a pause.
   - **Task failure** (`result=failed` with blockers listed): mark `blocked`, do NOT retry.
   - **Persistent failure** (second attempt fails for any reason): mark `blocked`, continue with other tasks.
10. Complete when all tasks are `done` or terminal `blocked`.
11. Emit a final orchestration summary with done/blocked counts and unresolved blockers.

## Delegation prompt contract (outbound)

When delegating a task, assemble the following prompt and send it to the subagent:

| Field | Source | Required |
|-------|--------|----------|
| `task_id` | Graph node `.id` | Yes |
| `title` | Graph node `.title` | Yes |
| `acceptance` | Graph node `.acceptance` | Yes |
| `deliverables` | Graph node `.deliverables` | Yes |
| `context` | Graph node `.context` (if present) | No |
| `project` | Graph root `.project` | Yes |
| `dependency_results` | For each `done` blocker: `{ task_id, result_summary, files_changed }` from `task.status.json` | Yes (empty array if none) |
| `spec_excerpt` | See below | No |
| Response format | The delegation response contract fields (listed in the next section) | Yes |

**spec_excerpt rules:**
- If `SPEC.md` exists and is under 200 lines, include it in full.
- If `SPEC.md` is over 200 lines, include only sections referenced by `context` entries starting with `SPEC.md#` (e.g. `SPEC.md#payment-flow` → include the `## payment-flow` section).
- If `SPEC.md` does not exist, omit entirely.

**Example delegation prompt:**

```
Project: my-project

## Task
- ID: TASK-003
- Title: Implement order validation endpoint

## Acceptance criteria
- POST /api/orders/validate returns 200 for valid payloads
- Returns 422 with field-level errors for invalid payloads
- Integration test covers both cases

## Deliverables
- src/api/orders/validate.ts
- tests/api/orders/validate.test.ts

## Context hints
- src/api/orders.ts (existing order routes)
- SPEC.md#order-validation (see spec excerpt below)
- Uses Repository pattern from src/lib/repo.ts

## Completed dependencies
- TASK-001: "Set up order schema" — files: src/models/order.ts, src/db/migrations/001_orders.sql
- TASK-002: "Create base API router" — files: src/api/router.ts

## Spec excerpt
[contents of the order-validation section from SPEC.md]

## Response format
Return ALL of these fields:
- task_id
- result (done|blocked|failed)
- result_summary
- files_changed (array)
- tests_run (array)
- blockers (array)
- next_unblocked_tasks (array of task IDs)
```

Adapt formatting to your agent framework.

## Delegation mechanics

- **Multi-agent systems**: spawn a new agent with the assembled delegation prompt.
- **Single-agent systems**: execute sequentially, self-report the response fields.
- **Tool-based delegation**: format the delegation prompt as tool input.
- The orchestrator must NOT assume the subagent has prior context or has read SPEC.md.

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

## Resumption

When `task.status.json` already exists:

1. Load the file and validate its `schema_version`.
2. Reset all `in_progress` tasks to `todo`.
3. Keep all `done` tasks and their `result_summary` / `files_changed`.
4. Re-evaluate `blocked` tasks: if their blockers are now `done`, reset to `todo`.
5. Rebuild the dispatch queue from the graph using current status.
6. Log: "Resumed: X done, Y todo, Z blocked".

## Context management

- **Keep per completed task**: task_id, one-line result_summary, files_changed.
- **Discard after completion**: full delegation prompt, full response body, acceptance, deliverables, context hints.
- **Always retain**: dispatch queue (unblocked todo tasks), task.status.json summary counts.
- **When context pressure is high** (>60% tasks done): summarize all completed tasks into a single block and discard individual results.
- **Never discard**: blocked task details and their blockers.

## task.status.json schema

Default path: `planning/<title-slug>/task.status.json`.

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
