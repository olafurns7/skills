---
name: feature-tasks-work
description: Orchestrate execution from feature task plans. Use when work should start from SPEC.md and tasks.yaml, optionally using task.graph.json, by delegating implementation tasks to collaborators or subagents.
---

# Feature Tasks Work

1. Reset context before orchestration. If your agent supports session reset commands, use `/clear` or `/new`.
2. Read `SPEC.md`.
3. Read `tasks.yaml`.
4. Optionally read `task.graph.json` as dependency support.
5. Act as orchestrator, not single-thread implementer.
6. Start execution of the planned tasks.
7. Delegate each task to a teammate, collaborator, or subagent.
8. Track dependency order and only dispatch unblocked tasks.
9. Run independent tasks in parallel when safe.
10. Aggregate updates and surface blockers immediately.
