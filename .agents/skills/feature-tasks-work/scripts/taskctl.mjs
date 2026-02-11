#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const STATUS_SCHEMA_VERSION = 2;
const CONVENTIONAL_BRANCH_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert",
]);
const VALID_STATES = new Set(["todo", "in_progress", "done", "blocked"]);
const VALID_RESULTS = new Set(["done", "blocked", "failed"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    let key;
    let value;

    if (equalsIndex >= 0) {
      key = token.slice(2, equalsIndex);
      value = token.slice(equalsIndex + 1);
    } else {
      key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }

    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(value);
    } else {
      flags[key] = [flags[key], value];
    }
  }

  return { positionals, flags };
}

function isJsonFlag(flags) {
  return flags.json === true || normalizeString(flags.json).toLowerCase() === "true";
}

function toStringArray(value) {
  if (value === undefined || value === null || value === true) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRequiredStringFlag(flags, key, label) {
  const value = normalizeString(flags[key]);
  if (!value) fail(`${label} is required (--${key})`);
  return value;
}

function parseOptionalStringFlag(flags, key) {
  const value = normalizeString(flags[key]);
  return value || "";
}

function resolveWorkspaceRoot(cwd) {
  try {
    const topLevel = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (topLevel) return topLevel;
  } catch {
    // Outside git repository.
  }
  return cwd;
}

function resolveGitBranchName(cwd) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {
    // Fall through.
  }
  fail("Unable to infer planning slug from branch. Pass <title-slug> explicitly.");
}

function toPlanningSlug(rawValue) {
  const normalized = normalizeString(rawValue).toLowerCase();
  if (!normalized) fail("Planning slug is required");

  const branchParts = normalized.split("/").filter(Boolean);
  let candidate = normalized;

  if (branchParts.length > 1 && CONVENTIONAL_BRANCH_TYPES.has(branchParts[0])) {
    candidate = branchParts.slice(1).join("-");
  } else if (branchParts.length > 1) {
    candidate = branchParts.join("-");
  }

  for (const type of CONVENTIONAL_BRANCH_TYPES) {
    if (candidate.startsWith(`${type}-`)) {
      candidate = candidate.slice(type.length + 1);
      break;
    }
  }

  const slug = candidate
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) fail(`Unable to derive valid slug from "${rawValue}"`);
  return slug;
}

function resolvePlanningPaths(cwd, slugArg) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const slugSource = slugArg ? slugArg : resolveGitBranchName(cwd);
  const slug = toPlanningSlug(slugSource);
  const planningDir = path.resolve(workspaceRoot, "planning", slug);

  return {
    workspaceRoot,
    slug,
    planningDir,
    specPath: path.resolve(planningDir, "SPEC.md"),
    tasksPath: path.resolve(planningDir, "tasks.yaml"),
    graphPath: path.resolve(planningDir, "task.graph.json"),
    statusPath: path.resolve(planningDir, "task.status.json"),
  };
}

function parseRequiredString(value, label) {
  const text = normalizeString(value);
  if (!text) fail(`${label} is required`);
  return text;
}

function parseRequiredStringArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array of non-empty strings`);
  const items = value.map((item) => normalizeString(item)).filter(Boolean);
  if (items.length === 0) fail(`${label} must contain at least one item`);
  return items;
}

function parseIdentifierArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array of task IDs`);
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function readTasksFromYaml(tasksPath) {
  if (!fs.existsSync(tasksPath)) {
    fail(`Missing planning file: ${tasksPath}`);
  }

  let document;
  try {
    document = parseYaml(fs.readFileSync(tasksPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`Failed to parse tasks.yaml: ${error.message}`);
  }

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    fail("tasks.yaml must define an object root");
  }

  const project = parseRequiredString(document.project, "tasks.yaml project");
  const rawTasks = document.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    fail("tasks.yaml must contain a non-empty tasks array");
  }

  const taskOrder = [];
  const tasksById = {};

  for (let i = 0; i < rawTasks.length; i += 1) {
    const task = rawTasks[i];
    if (typeof task !== "object" || task === null || Array.isArray(task)) {
      fail(`tasks.yaml tasks[${i}] must be an object`);
    }

    const id = parseRequiredString(task.id, `tasks.yaml tasks[${i}].id`);
    if (tasksById[id]) fail(`tasks.yaml contains duplicate task id: ${id}`);

    const blockedBy = parseIdentifierArray(task.blocked_by, `tasks.yaml ${id}.blocked_by`);
    const acceptance = parseRequiredStringArray(task.acceptance, `tasks.yaml ${id}.acceptance`);
    const deliverables = parseRequiredStringArray(task.deliverables, `tasks.yaml ${id}.deliverables`);
    const context = Array.isArray(task.context)
      ? task.context.map((item) => normalizeString(item)).filter(Boolean)
      : [];

    tasksById[id] = {
      id,
      title: parseRequiredString(task.title, `tasks.yaml ${id}.title`),
      blocked_by: blockedBy,
      acceptance,
      deliverables,
      context,
    };
    taskOrder.push(id);
  }

  return { project, taskOrder, tasksById, source: "tasks.yaml" };
}

function readTasksFromGraph(graphPath) {
  if (!fs.existsSync(graphPath)) return null;

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  } catch (error) {
    fail(`Failed to parse task.graph.json: ${error.message}`);
  }

  const project = parseRequiredString(graph.project, "task.graph.json project");
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    fail("task.graph.json must contain a non-empty nodes array");
  }

  const taskOrder = [];
  const tasksById = {};

  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i];
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      fail(`task.graph.json nodes[${i}] must be an object`);
    }
    const id = parseRequiredString(node.id, `task.graph.json nodes[${i}].id`);
    if (tasksById[id]) fail(`task.graph.json contains duplicate node id: ${id}`);

    tasksById[id] = {
      id,
      title: parseRequiredString(node.title, `task.graph.json ${id}.title`),
      blocked_by: parseIdentifierArray(node.blocked_by, `task.graph.json ${id}.blocked_by`),
      acceptance: parseRequiredStringArray(node.acceptance, `task.graph.json ${id}.acceptance`),
      deliverables: parseRequiredStringArray(node.deliverables, `task.graph.json ${id}.deliverables`),
      context: Array.isArray(node.context)
        ? node.context.map((item) => normalizeString(item)).filter(Boolean)
        : [],
    };
    taskOrder.push(id);
  }

  return { project, taskOrder, tasksById, source: "task.graph.json" };
}

function validateDependencies(plan) {
  const knownTaskIds = new Set(plan.taskOrder);
  for (const taskId of plan.taskOrder) {
    const task = plan.tasksById[taskId];
    for (const dependency of task.blocked_by) {
      if (!knownTaskIds.has(dependency)) {
        fail(`Task ${taskId} references unknown dependency ${dependency}`);
      }
      if (dependency === taskId) {
        fail(`Task ${taskId} cannot depend on itself`);
      }
    }
  }
}

function loadPlan(paths) {
  const warnings = [];
  const graphPlan = readTasksFromGraph(paths.graphPath);
  const plan = graphPlan || readTasksFromYaml(paths.tasksPath);
  validateDependencies(plan);

  if (!fs.existsSync(paths.specPath)) {
    warnings.push(`Missing spec file: ${paths.specPath}`);
  }
  if (!graphPlan) {
    warnings.push("task.graph.json not found; using tasks.yaml dependency order.");
  }

  return {
    ...plan,
    warnings,
  };
}

function defaultTaskStatus() {
  return {
    state: "todo",
    owner: "",
    attempts: 0,
    started_at: null,
    finished_at: null,
    blockers: [],
    files_changed: [],
    tests_run: [],
    result_summary: "",
    next_unblocked_tasks: [],
  };
}

function normalizeState(value) {
  return VALID_STATES.has(value) ? value : "todo";
}

function normalizeTaskStatusRecord(value) {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const normalized = defaultTaskStatus();
  normalized.state = normalizeState(record.state);
  normalized.owner = normalizeString(record.owner);
  normalized.attempts = Number.isInteger(record.attempts) && record.attempts > 0 ? record.attempts : 0;
  normalized.started_at = normalizeString(record.started_at) || null;
  normalized.finished_at = normalizeString(record.finished_at) || null;
  normalized.blockers = Array.isArray(record.blockers)
    ? record.blockers.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  normalized.files_changed = Array.isArray(record.files_changed)
    ? record.files_changed.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  normalized.tests_run = Array.isArray(record.tests_run)
    ? record.tests_run.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  normalized.result_summary = normalizeString(record.result_summary);
  normalized.next_unblocked_tasks = Array.isArray(record.next_unblocked_tasks)
    ? record.next_unblocked_tasks.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  return normalized;
}

function summarizeTasks(tasks, taskOrder) {
  const summary = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const taskId of taskOrder) {
    const state = tasks[taskId].state;
    summary[state] += 1;
  }
  return summary;
}

function canUnblockFromDependencies(blockers, tasks, knownTaskIds) {
  if (!Array.isArray(blockers) || blockers.length === 0) return false;
  if (blockers.some((blocker) => !knownTaskIds.has(blocker))) return false;
  return blockers.every((blocker) => tasks[blocker]?.state === "done");
}

function loadStatus(paths, plan, { resetInProgress, reevaluateBlocked }) {
  let rawStatus = {};
  const warnings = [];

  if (fs.existsSync(paths.statusPath)) {
    try {
      rawStatus = JSON.parse(fs.readFileSync(paths.statusPath, "utf8"));
    } catch (error) {
      fail(`Failed to parse task.status.json: ${error.message}`);
    }
  }

  const rawTasks = rawStatus.tasks && typeof rawStatus.tasks === "object" ? rawStatus.tasks : {};
  const tasks = {};
  const knownTaskIds = new Set(plan.taskOrder);

  for (const taskId of plan.taskOrder) {
    const record = normalizeTaskStatusRecord(rawTasks[taskId]);
    if (resetInProgress && record.state === "in_progress") {
      record.state = "todo";
      record.owner = "";
    }
    tasks[taskId] = record;
  }

  if (reevaluateBlocked) {
    for (const taskId of plan.taskOrder) {
      const record = tasks[taskId];
      if (record.state !== "blocked") continue;
      if (canUnblockFromDependencies(record.blockers, tasks, knownTaskIds)) {
        record.state = "todo";
        record.blockers = [];
      }
    }
  }

  if (normalizeString(rawStatus.project) && rawStatus.project !== plan.project) {
    warnings.push(
      `Status project "${rawStatus.project}" does not match plan project "${plan.project}". Using plan project.`,
    );
  }

  return {
    project: plan.project,
    schema_version: STATUS_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    summary: summarizeTasks(tasks, plan.taskOrder),
    tasks,
    warnings,
  };
}

function writeStatus(paths, status) {
  fs.mkdirSync(path.dirname(paths.statusPath), { recursive: true });
  fs.writeFileSync(paths.statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

function taskIsUnblocked(task, status) {
  return task.blocked_by.every((dependencyId) => status.tasks[dependencyId]?.state === "done");
}

function getReadyTaskIds(plan, status) {
  return plan.taskOrder.filter((taskId) => {
    const taskStatus = status.tasks[taskId];
    if (!taskStatus || taskStatus.state !== "todo") return false;
    return taskIsUnblocked(plan.tasksById[taskId], status);
  });
}

function headingSlug(text) {
  return normalizeString(text)
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractSpecAnchors(context) {
  const anchors = new Set();
  for (const entry of context || []) {
    const matches = String(entry).match(/\bSPEC\.md#([A-Za-z0-9._-]+)/i);
    if (!matches) continue;
    const anchor = headingSlug(matches[1].replace(/_/g, "-"));
    if (anchor) anchors.add(anchor);
  }
  return anchors;
}

function extractMarkdownSections(content, targetAnchors) {
  const lines = content.split(/\r?\n/);
  const headings = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    headings.push({
      line: i,
      level: match[1].length,
      slug: headingSlug(match[2]),
    });
  }

  const sections = [];
  const usedStarts = new Set();

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    if (!targetAnchors.has(current.slug)) continue;
    if (usedStarts.has(current.line)) continue;
    usedStarts.add(current.line);

    let endLine = lines.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= current.level) {
        endLine = headings[j].line;
        break;
      }
    }

    const section = lines.slice(current.line, endLine).join("\n").trimEnd();
    if (section) sections.push(section);
  }

  return sections;
}

function resolveSpecExcerpt(specPath, context) {
  if (!fs.existsSync(specPath)) {
    return { excerpt: "", mode: "missing" };
  }

  const content = fs.readFileSync(specPath, "utf8");
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount <= 200) {
    return { excerpt: content.trimEnd(), mode: "full" };
  }

  const anchors = extractSpecAnchors(context);
  if (anchors.size === 0) {
    return { excerpt: "", mode: "no_references" };
  }

  const sections = extractMarkdownSections(content, anchors);
  if (sections.length === 0) {
    return { excerpt: "", mode: "no_matching_sections" };
  }

  return { excerpt: sections.join("\n\n").trimEnd(), mode: "sections" };
}

function buildDelegationPayload(plan, status, paths, taskId) {
  const task = plan.tasksById[taskId];
  if (!task) fail(`Unknown task: ${taskId}`);
  const taskStatus = status.tasks[taskId];
  if (taskStatus?.state !== "todo") {
    fail(`Task ${taskId} is not dispatchable (state=${taskStatus?.state || "unknown"})`);
  }

  const unresolved = task.blocked_by.filter((dependencyId) => status.tasks[dependencyId]?.state !== "done");
  if (unresolved.length > 0) {
    fail(`Task ${taskId} is blocked by: ${unresolved.join(", ")}`);
  }

  const dependencyResults = task.blocked_by.map((dependencyId) => {
    const dependencyStatus = status.tasks[dependencyId];
    return {
      task_id: dependencyId,
      result_summary: dependencyStatus?.result_summary || "",
      files_changed: dependencyStatus?.files_changed || [],
    };
  });

  const specInfo = resolveSpecExcerpt(paths.specPath, task.context);
  const payload = {
    task_id: task.id,
    title: task.title,
    acceptance: task.acceptance,
    deliverables: task.deliverables,
    context: task.context,
    project: plan.project,
    dependency_results: dependencyResults,
    response_format: [
      "task_id",
      "result (done|blocked|failed)",
      "result_summary",
      "files_changed (array)",
      "tests_run (array)",
      "blockers (array)",
      "next_unblocked_tasks (array of task IDs)",
    ],
  };

  const warnings = [];
  if (specInfo.excerpt) {
    payload.spec_excerpt = specInfo.excerpt;
  } else if (specInfo.mode === "missing") {
    warnings.push("SPEC.md is missing; spec_excerpt omitted.");
  } else if (specInfo.mode === "no_references") {
    warnings.push("SPEC.md is >200 lines and task context has no SPEC.md# references; spec_excerpt omitted.");
  } else if (specInfo.mode === "no_matching_sections") {
    warnings.push("SPEC.md# context references did not match headings; spec_excerpt omitted.");
  }

  return { payload, warnings };
}

function formatDependencyResultsForPrompt(dependencyResults) {
  if (dependencyResults.length === 0) {
    return "- (none)";
  }
  return dependencyResults
    .map((item) => {
      const files = item.files_changed.length > 0 ? item.files_changed.join(", ") : "(none)";
      const summary = item.result_summary || "(no summary)";
      return `- ${item.task_id}: "${summary}" - files: ${files}`;
    })
    .join("\n");
}

function buildDelegationPrompt(payload) {
  const lines = [];
  lines.push(`Project: ${payload.project}`, "");
  lines.push("## Task");
  lines.push(`- ID: ${payload.task_id}`);
  lines.push(`- Title: ${payload.title}`, "");

  lines.push("## Acceptance criteria");
  for (const criterion of payload.acceptance) {
    lines.push(`- ${criterion}`);
  }
  lines.push("");

  lines.push("## Deliverables");
  for (const deliverable of payload.deliverables) {
    lines.push(`- ${deliverable}`);
  }
  lines.push("");

  if (payload.context.length > 0) {
    lines.push("## Context hints");
    for (const hint of payload.context) {
      lines.push(`- ${hint}`);
    }
    lines.push("");
  }

  lines.push("## Completed dependencies");
  lines.push(formatDependencyResultsForPrompt(payload.dependency_results));
  lines.push("");

  if (payload.spec_excerpt) {
    lines.push("## Spec excerpt");
    lines.push(payload.spec_excerpt);
    lines.push("");
  }

  lines.push("## Response format");
  lines.push("Return ALL of these fields:");
  for (const field of payload.response_format) {
    lines.push(`- ${field}`);
  }

  return lines.join("\n");
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  const help = `
taskctl - orchestration CLI for feature-tasks-work

Usage:
  taskctl <command> [args] [--json]

Commands:
  init [title-slug]
    Initialize/resume task.status.json and reset stale in_progress entries.

  ready [title-slug]
    List unblocked todo tasks ready for dispatch.

  prompt [title-slug] [task-id]
    Build delegation prompt payload for a ready task.
    If task-id is omitted, uses the first ready task.
    If title-slug is omitted and task-id is explicit, pass --task <task-id>.

  dispatch [title-slug] [task-id] --owner <owner-name>
    Atomically select/build prompt/start for a dispatchable task.
    If task-id is omitted, uses the first ready task.
    If title-slug is omitted and task-id is explicit, pass --task <task-id>.

  start [title-slug] <task-id> --owner <owner-name>
    Mark a task as in_progress and increment attempts.

  complete [title-slug] <task-id> --result <done|blocked|failed> --summary <text>
      [--files a,b] [--tests a,b] [--blockers a,b] [--next a,b]
    Record task result and persist status.

  status [title-slug]
    Show current summary and per-task states.

Notes:
  - If title-slug is omitted, it is derived from the current git branch.
  - Planning files are read from planning/<title-slug>/.
`.trim();
  process.stdout.write(`${help}\n`);
}

function splitSlugAndTask(positionals) {
  if (positionals.length === 0) {
    return { slugArg: undefined, taskId: "" };
  }
  if (positionals.length === 1) {
    return { slugArg: undefined, taskId: positionals[0] };
  }
  return { slugArg: positionals[0], taskId: positionals[1] };
}

function commandInit(paths, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: true, reevaluateBlocked: true });
  writeStatus(paths, status);

  const output = {
    slug: paths.slug,
    plan_source: plan.source,
    status_path: paths.statusPath,
    summary: status.summary,
    warnings: [...plan.warnings, ...status.warnings],
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(
    `Resumed: ${status.summary.done} done, ${status.summary.todo} todo, ${status.summary.blocked} blocked\n`,
  );
  for (const warning of output.warnings) {
    process.stdout.write(`Warning: ${warning}\n`);
  }
}

function commandReady(paths, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  writeStatus(paths, status);
  const ready = getReadyTaskIds(plan, status);

  const output = {
    slug: paths.slug,
    summary: status.summary,
    ready,
    warnings: [...plan.warnings, ...status.warnings],
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(`Ready tasks (${ready.length}): ${ready.join(", ") || "(none)"}\n`);
}

function resolveTaskForPrompt(plan, status, explicitTaskId) {
  if (explicitTaskId) {
    if (!plan.tasksById[explicitTaskId]) fail(`Unknown task: ${explicitTaskId}`);
    return explicitTaskId;
  }

  const ready = getReadyTaskIds(plan, status);
  if (ready.length === 0) fail("No ready tasks available");
  return ready[0];
}

function commandPrompt(paths, taskId, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  writeStatus(paths, status);

  const resolvedTaskId = resolveTaskForPrompt(plan, status, taskId);
  const delegation = buildDelegationPayload(plan, status, paths, resolvedTaskId);
  const prompt = buildDelegationPrompt(delegation.payload);

  const output = {
    slug: paths.slug,
    task_id: resolvedTaskId,
    payload: delegation.payload,
    prompt,
    warnings: [...plan.warnings, ...status.warnings, ...delegation.warnings],
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(`${prompt}\n`);
  for (const warning of output.warnings) {
    process.stdout.write(`\nWarning: ${warning}\n`);
  }
}

function markTaskStarted(plan, status, taskId, owner) {
  const task = plan.tasksById[taskId];
  if (!task) fail(`Unknown task: ${taskId}`);

  if (!taskIsUnblocked(task, status)) {
    const blockers = task.blocked_by.filter((dependencyId) => status.tasks[dependencyId]?.state !== "done");
    fail(`Task ${taskId} is blocked by: ${blockers.join(", ")}`);
  }

  const record = status.tasks[taskId];
  if (record.state !== "todo") {
    fail(`Task ${taskId} must be in todo state to start (current: ${record.state})`);
  }

  record.state = "in_progress";
  record.owner = owner;
  record.attempts += 1;
  record.started_at = new Date().toISOString();
  record.finished_at = null;
  record.blockers = [];
  record.files_changed = [];
  record.tests_run = [];
  record.result_summary = "";
  record.next_unblocked_tasks = [];

  return record;
}

function commandStart(paths, taskId, owner, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  const record = markTaskStarted(plan, status, taskId, owner);

  status.updated_at = new Date().toISOString();
  status.summary = summarizeTasks(status.tasks, plan.taskOrder);
  writeStatus(paths, status);

  const output = {
    slug: paths.slug,
    task_id: taskId,
    state: record.state,
    owner: record.owner,
    attempts: record.attempts,
    summary: status.summary,
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(
    `Started ${taskId} (owner=${record.owner}, attempts=${record.attempts}). In-progress: ${status.summary.in_progress}\n`,
  );
}

function commandDispatch(paths, taskId, owner, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  const resolvedTaskId = resolveTaskForPrompt(plan, status, taskId);
  const delegation = buildDelegationPayload(plan, status, paths, resolvedTaskId);
  const prompt = buildDelegationPrompt(delegation.payload);
  const record = markTaskStarted(plan, status, resolvedTaskId, owner);

  status.updated_at = new Date().toISOString();
  status.summary = summarizeTasks(status.tasks, plan.taskOrder);
  writeStatus(paths, status);

  const output = {
    slug: paths.slug,
    task_id: resolvedTaskId,
    state: record.state,
    owner: record.owner,
    attempts: record.attempts,
    summary: status.summary,
    payload: delegation.payload,
    prompt,
    warnings: [...plan.warnings, ...status.warnings, ...delegation.warnings],
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(
    `Dispatched ${resolvedTaskId} (owner=${record.owner}, attempts=${record.attempts}). In-progress: ${status.summary.in_progress}\n`,
  );
}

function commandComplete(paths, taskId, flags, jsonMode) {
  const result = normalizeString(flags.result).toLowerCase();
  if (!VALID_RESULTS.has(result)) {
    fail(`--result must be one of: ${Array.from(VALID_RESULTS).join(", ")}`);
  }

  const summaryText = parseRequiredStringFlag(flags, "summary", "Task result summary");
  const filesChanged = toStringArray(flags.files);
  const testsRun = toStringArray(flags.tests);
  const blockers = toStringArray(flags.blockers);
  const nextUnblocked = toStringArray(flags.next);
  const owner = parseOptionalStringFlag(flags, "owner");

  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  const task = plan.tasksById[taskId];
  if (!task) fail(`Unknown task: ${taskId}`);

  const record = status.tasks[taskId];
  if (record.state !== "in_progress" && record.state !== "todo") {
    fail(`Task ${taskId} cannot be completed from state ${record.state}`);
  }

  if (!record.started_at) {
    record.started_at = new Date().toISOString();
  }

  if (owner) record.owner = owner;
  record.result_summary = summaryText;
  record.files_changed = filesChanged;
  record.tests_run = testsRun;
  record.next_unblocked_tasks = nextUnblocked;
  record.finished_at = new Date().toISOString();

  if (result === "done") {
    record.state = "done";
    record.blockers = [];
  } else {
    record.state = "blocked";
    record.blockers = blockers.length > 0 ? blockers : [`task reported ${result}`];
  }

  status.updated_at = new Date().toISOString();
  status.summary = summarizeTasks(status.tasks, plan.taskOrder);
  writeStatus(paths, status);

  const ready = getReadyTaskIds(plan, status);
  const output = {
    slug: paths.slug,
    task_id: taskId,
    result,
    state: record.state,
    summary: status.summary,
    ready,
  };

  if (jsonMode) {
    printJson(output);
    return;
  }

  process.stdout.write(
    `Completed ${taskId} as ${record.state}. Ready tasks (${ready.length}): ${ready.join(", ") || "(none)"}\n`,
  );
}

function commandStatus(paths, jsonMode) {
  const plan = loadPlan(paths);
  const status = loadStatus(paths, plan, { resetInProgress: false, reevaluateBlocked: true });
  writeStatus(paths, status);
  const ready = getReadyTaskIds(plan, status);

  if (jsonMode) {
    printJson({
      slug: paths.slug,
      summary: status.summary,
      ready,
      tasks: status.tasks,
      warnings: [...plan.warnings, ...status.warnings],
    });
    return;
  }

  process.stdout.write(
    `Summary: todo=${status.summary.todo} in_progress=${status.summary.in_progress} done=${status.summary.done} blocked=${status.summary.blocked}\n`,
  );
  process.stdout.write(`Ready: ${ready.join(", ") || "(none)"}\n`);
  for (const taskId of plan.taskOrder) {
    process.stdout.write(`- ${taskId}: ${status.tasks[taskId].state}\n`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "help";
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const { positionals, flags } = parseCliArgs(argv.slice(1));
  const jsonMode = isJsonFlag(flags);
  const cwd = process.cwd();

  if (command === "init") {
    const paths = resolvePlanningPaths(cwd, positionals[0]);
    commandInit(paths, jsonMode);
    return;
  }

  if (command === "ready") {
    const paths = resolvePlanningPaths(cwd, positionals[0]);
    commandReady(paths, jsonMode);
    return;
  }

  if (command === "prompt") {
    const taskIdFlag = normalizeString(flags.task);
    const taskIdPositional = normalizeString(positionals[1]);
    const taskId = taskIdFlag || taskIdPositional;
    const paths = resolvePlanningPaths(cwd, positionals[0]);
    commandPrompt(paths, taskId || null, jsonMode);
    return;
  }

  if (command === "start") {
    const { slugArg, taskId } = splitSlugAndTask(positionals);
    const normalizedTaskId = normalizeString(taskId);
    if (!normalizedTaskId) fail("Usage: taskctl start [title-slug] <task-id> --owner <owner-name>");
    const paths = resolvePlanningPaths(cwd, slugArg);
    const owner = parseRequiredStringFlag(flags, "owner", "Task owner");
    commandStart(paths, normalizedTaskId, owner, jsonMode);
    return;
  }

  if (command === "dispatch") {
    const slugArg = positionals[0];
    const taskIdFlag = normalizeString(flags.task);
    const taskIdPositional = normalizeString(positionals[1]);
    const taskId = taskIdFlag || taskIdPositional;
    const owner = parseRequiredStringFlag(flags, "owner", "Task owner");
    const paths = resolvePlanningPaths(cwd, slugArg);
    commandDispatch(paths, taskId || null, owner, jsonMode);
    return;
  }

  if (command === "complete") {
    const { slugArg, taskId } = splitSlugAndTask(positionals);
    const normalizedTaskId = normalizeString(taskId);
    if (!normalizedTaskId) {
      fail(
        "Usage: taskctl complete [title-slug] <task-id> --result <done|blocked|failed> --summary <text>",
      );
    }
    const paths = resolvePlanningPaths(cwd, slugArg);
    commandComplete(paths, normalizedTaskId, flags, jsonMode);
    return;
  }

  if (command === "status") {
    const paths = resolvePlanningPaths(cwd, positionals[0]);
    commandStatus(paths, jsonMode);
    return;
  }

  fail(`Unknown command: ${command}\nRun: taskctl help`);
}

main();
