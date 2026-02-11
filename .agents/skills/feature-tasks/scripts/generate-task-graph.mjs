#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

function coerceString(value, label, { allowEmpty = true } = {}) {
  if (value === undefined || value === null) {
    if (allowEmpty) return "";
    throw new Error(`${label} is required`);
  }

  const text = String(value).trim();
  if (!text && !allowEmpty) {
    throw new Error(`${label} is required`);
  }

  return text;
}

function coerceIdentifier(value, label) {
  return coerceString(value, label, { allowEmpty: false });
}

function coerceTaskList(value, label) {
  if (value === undefined || value === null) return [];

  const items = Array.isArray(value) ? value : [value];
  const deduped = [];
  const seen = new Set();

  for (const item of items) {
    const id = coerceIdentifier(item, label);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
  }

  return deduped;
}

function assertUniqueIds(items, key, label) {
  const seen = new Set();
  const duplicates = new Set();

  for (const item of items) {
    const id = item[key];
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  if (duplicates.size > 0) {
    throw new Error(`${label} contains duplicate IDs: ${Array.from(duplicates).join(", ")}`);
  }
}

function parseTasksYaml(content) {
  let document;
  try {
    document = parseYaml(content.replace(/^\uFEFF/, "")) ?? {};
  } catch (error) {
    throw new Error(`Failed to parse tasks.yaml: ${error.message}`);
  }

  if (typeof document !== "object" || document === null) {
    throw new Error("tasks.yaml must define an object root");
  }

  const rawVersion = Number(document.version ?? 1);
  const meta = {
    version: Number.isFinite(rawVersion) && rawVersion > 0 ? Math.floor(rawVersion) : 1,
    project: coerceString(document.project ?? "unknown", "project"),
  };

  const rawTasks = Array.isArray(document.tasks) ? document.tasks : [];
  const tasks = rawTasks.map((task, index) => {
    if (typeof task !== "object" || task === null) {
      throw new Error(`tasks[${index}] must be an object`);
    }

    return {
      id: coerceIdentifier(task.id, `tasks[${index}].id`),
      phase: coerceString(task.phase ?? "", `tasks[${index}].phase`),
      priority: coerceString(task.priority ?? "", `tasks[${index}].priority`),
      title: coerceString(task.title ?? "", `tasks[${index}].title`),
      blocked_by: coerceTaskList(task.blocked_by, `tasks[${index}].blocked_by`),
    };
  });

  const rawCriticalPaths = Array.isArray(document.critical_paths)
    ? document.critical_paths
    : [];
  const criticalPaths = rawCriticalPaths.map((criticalPath, index) => {
    if (typeof criticalPath !== "object" || criticalPath === null) {
      throw new Error(`critical_paths[${index}] must be an object`);
    }

    return {
      id: coerceIdentifier(criticalPath.id, `critical_paths[${index}].id`),
      tasks: coerceTaskList(criticalPath.tasks, `critical_paths[${index}].tasks`),
    };
  });

  const rawParallelWindows = Array.isArray(document.parallel_windows)
    ? document.parallel_windows
    : [];
  const parallelWindows = rawParallelWindows.map((parallelWindow, index) => {
    if (typeof parallelWindow !== "object" || parallelWindow === null) {
      throw new Error(`parallel_windows[${index}] must be an object`);
    }

    return {
      id: coerceIdentifier(parallelWindow.id, `parallel_windows[${index}].id`),
      tasks: coerceTaskList(parallelWindow.tasks, `parallel_windows[${index}].tasks`),
    };
  });

  assertUniqueIds(tasks, "id", "tasks");
  assertUniqueIds(criticalPaths, "id", "critical_paths");
  assertUniqueIds(parallelWindows, "id", "parallel_windows");

  return { meta, tasks, criticalPaths, parallelWindows };
}

function detectDependencyCycles(tasks) {
  const depsByTask = new Map(tasks.map((task) => [task.id, task.blocked_by]));
  const state = new Map();
  const errors = [];

  function dfs(taskId, stack) {
    const nodeState = state.get(taskId) ?? 0;
    if (nodeState === 1) {
      const cycleStart = stack.indexOf(taskId);
      const cyclePath = [...stack.slice(cycleStart), taskId];
      errors.push(`Dependency cycle detected: ${cyclePath.join(" -> ")}`);
      return;
    }
    if (nodeState === 2) return;

    state.set(taskId, 1);
    stack.push(taskId);

    const deps = depsByTask.get(taskId) ?? [];
    for (const dependency of deps) {
      dfs(dependency, stack);
    }

    stack.pop();
    state.set(taskId, 2);
  }

  for (const task of tasks) {
    if ((state.get(task.id) ?? 0) === 0) {
      dfs(task.id, []);
    }
  }

  return errors;
}

function validateGraphParity(parsed) {
  const taskIds = new Set(parsed.tasks.map((task) => task.id));
  const missingBlockedBy = new Set();
  const selfDependencyErrors = [];

  for (const task of parsed.tasks) {
    for (const dependency of task.blocked_by) {
      if (dependency === task.id) {
        selfDependencyErrors.push(`Task ${task.id} cannot depend on itself`);
      }
      if (!taskIds.has(dependency)) {
        missingBlockedBy.add(dependency);
      }
    }
  }

  const pathErrors = [];
  for (const criticalPath of parsed.criticalPaths) {
    for (const taskId of criticalPath.tasks) {
      if (!taskIds.has(taskId)) {
        pathErrors.push(`critical_paths.${criticalPath.id} references missing task ${taskId}`);
      }
    }
  }

  const windowErrors = [];
  for (const parallelWindow of parsed.parallelWindows) {
    for (const taskId of parallelWindow.tasks) {
      if (!taskIds.has(taskId)) {
        windowErrors.push(`parallel_windows.${parallelWindow.id} references missing task ${taskId}`);
      }
    }
  }

  const cycleErrors = detectDependencyCycles(parsed.tasks);

  const errors = [
    ...Array.from(missingBlockedBy).map((dependency) => `Unresolved dependency: ${dependency}`),
    ...selfDependencyErrors,
    ...pathErrors,
    ...windowErrors,
    ...cycleErrors,
  ];

  if (errors.length > 0) {
    throw new Error(`Invalid tasks.yaml - graph parity failed:\n${errors.join("\n")}`);
  }
}

function buildGraph(parsed) {
  validateGraphParity(parsed);

  const nodes = parsed.tasks.map((task) => ({
    id: task.id,
    phase: task.phase,
    priority: task.priority,
    title: task.title,
  }));

  const edges = [];
  const edgeSet = new Set();

  for (const task of parsed.tasks) {
    for (const dependency of task.blocked_by) {
      const edgeKey = `${dependency}->${task.id}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);
      edges.push({ from: dependency, to: task.id, type: "blocks" });
    }
  }

  return {
    version: parsed.meta.version,
    project: parsed.meta.project,
    generated_from: "tasks.yaml",
    generated_at: new Date().toISOString(),
    nodes,
    edges,
    critical_paths: parsed.criticalPaths,
    parallel_windows: parsed.parallelWindows,
  };
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
    // Outside a git repository.
  }

  return cwd;
}

function main() {
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const inputArg = process.argv[2];
  const outputArg = process.argv[3];

  const inputPath = inputArg
    ? path.resolve(cwd, inputArg)
    : path.resolve(workspaceRoot, "tasks.yaml");
  const outputPath = outputArg
    ? path.resolve(cwd, outputArg)
    : path.resolve(workspaceRoot, "task.graph.json");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, "utf8");
  const parsed = parseTasksYaml(content);

  if (parsed.tasks.length === 0) {
    console.error("No tasks found in tasks.yaml");
    process.exit(1);
  }

  const graph = buildGraph(parsed);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);

  console.info(
    `Generated ${path.relative(cwd, outputPath)} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
  );
}

main();
