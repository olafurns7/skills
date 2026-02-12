import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const GRAPH_SCHEMA_VERSION = 3;
const SUPPORTED_INPUT_VERSIONS = new Set([3]);
const PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const OWNER_TYPES = new Set(["frontend", "backend", "infra", "docs", "qa", "fullstack"]);
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

function fail(message) {
  throw new Error(message);
}

function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseRequiredString(value, label, errors) {
  const text = normalizeString(value);
  if (!text) {
    errors.push(`${label} is required`);
    return "";
  }
  return text;
}

function parseOptionalString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseOptionalStringList(value, label, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return [];
  }

  const items = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = normalizeString(value[i]);
    if (!item) {
      errors.push(`${label}[${i}] must be a non-empty string`);
      continue;
    }
    items.push(item);
  }
  return items;
}

function parseRequiredStringList(value, label, errors, { minItems = 1 } = {}) {
  if (value === undefined || value === null) {
    errors.push(`${label} is required`);
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of non-empty strings`);
    return [];
  }

  const items = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = normalizeString(value[i]);
    if (!item) {
      errors.push(`${label}[${i}] must be a non-empty string`);
      continue;
    }
    items.push(item);
  }

  if (items.length < minItems) {
    errors.push(`${label} must contain at least ${minItems} item(s)`);
  }

  return items;
}

function parseIdentifierList(value, label, errors, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      errors.push(`${label} is required`);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of task IDs`);
    return [];
  }

  const deduped = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const taskId = normalizeString(value[i]);
    if (!taskId) {
      errors.push(`${label}[${i}] must be a non-empty task ID`);
      continue;
    }
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    deduped.push(taskId);
  }
  return deduped;
}

function assertUniqueIds(items, key, label, errors) {
  const seen = new Set();
  const duplicates = new Set();

  for (const item of items) {
    const id = item[key];
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  if (duplicates.size > 0) {
    errors.push(`${label} contains duplicate IDs: ${Array.from(duplicates).sort().join(", ")}`);
  }
}

function parseTasksYaml(content) {
  let document;
  try {
    document = parseYaml(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`Failed to parse tasks.yaml: ${error.message}`);
  }

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    fail("tasks.yaml must define an object root");
  }

  const errors = [];

  const rawVersion = Number(document.version);
  const version = Number.isInteger(rawVersion) ? rawVersion : NaN;
  if (!SUPPORTED_INPUT_VERSIONS.has(version)) {
    errors.push("version must be 3");
  }

  const project = parseRequiredString(document.project, "project", errors);

  const rawTasks = document.tasks;
  if (!Array.isArray(rawTasks)) {
    errors.push("tasks is required and must be an array");
  } else if (rawTasks.length === 0) {
    errors.push("tasks must contain at least one task");
  }

  const tasks = Array.isArray(rawTasks)
    ? rawTasks.map((task, index) => {
        const fieldErrors = [];
        if (typeof task !== "object" || task === null || Array.isArray(task)) {
          errors.push(`tasks[${index}] must be an object`);
          return {
            id: `tasks[${index}]`,
            phase: "",
            priority: "",
            title: "",
            blocked_by: [],
            acceptance: [],
            deliverables: [],
            owner_type: "",
            estimate: "",
            notes: "",
            context: [],
          };
        }

        const id = parseRequiredString(task.id, `tasks[${index}].id`, fieldErrors);
        const phase = parseRequiredString(task.phase, `tasks[${index}].phase`, fieldErrors);
        const priority = parseRequiredString(task.priority, `tasks[${index}].priority`, fieldErrors);
        if (priority && !PRIORITIES.has(priority)) {
          fieldErrors.push(
            `tasks[${index}].priority must be one of: ${Array.from(PRIORITIES).join(", ")}`,
          );
        }

        const title = parseRequiredString(task.title, `tasks[${index}].title`, fieldErrors);
        const blockedBy = parseIdentifierList(task.blocked_by, `tasks[${index}].blocked_by`, fieldErrors, {
          required: true,
        });
        const acceptance = parseRequiredStringList(task.acceptance, `tasks[${index}].acceptance`, fieldErrors, {
          minItems: 1,
        });
        const deliverables = parseRequiredStringList(
          task.deliverables,
          `tasks[${index}].deliverables`,
          fieldErrors,
          { minItems: 1 },
        );

        const ownerType = parseRequiredString(task.owner_type, `tasks[${index}].owner_type`, fieldErrors);
        if (ownerType && !OWNER_TYPES.has(ownerType)) {
          fieldErrors.push(
            `tasks[${index}].owner_type must be one of: ${Array.from(OWNER_TYPES).join(", ")}`,
          );
        }

        const estimate = parseRequiredString(task.estimate, `tasks[${index}].estimate`, fieldErrors);
        const notes = parseOptionalString(task.notes);
        const context = parseOptionalStringList(task.context, `tasks[${index}].context`, fieldErrors);

        if (fieldErrors.length > 0) {
          const taskKey = id || `tasks[${index}]`;
          errors.push(`[${taskKey}] ${fieldErrors.join("; ")}`);
        }

        return {
          id,
          phase,
          priority,
          title,
          blocked_by: blockedBy,
          acceptance,
          deliverables,
          owner_type: ownerType,
          estimate,
          notes,
          context,
        };
      })
    : [];

  const parseGroup = (key, label) => {
    const raw = document[key];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      errors.push(`${key} must be an array when provided`);
      return [];
    }

    return raw.map((entry, index) => {
      const fieldErrors = [];
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push(`${key}[${index}] must be an object`);
        return { id: `${label}[${index}]`, tasks: [] };
      }

      const id = parseRequiredString(entry.id, `${key}[${index}].id`, fieldErrors);
      const taskIds = parseIdentifierList(entry.tasks, `${key}[${index}].tasks`, fieldErrors, {
        required: true,
      });

      if (fieldErrors.length > 0) {
        errors.push(`[${id || `${label}[${index}]`}] ${fieldErrors.join("; ")}`);
      }

      return { id, tasks: taskIds };
    });
  };

  const criticalPaths = parseGroup("critical_paths", "critical_paths");
  const parallelWindows = parseGroup("parallel_windows", "parallel_windows");

  assertUniqueIds(tasks, "id", "tasks", errors);
  assertUniqueIds(criticalPaths, "id", "critical_paths", errors);
  assertUniqueIds(parallelWindows, "id", "parallel_windows", errors);

  if (errors.length > 0) {
    fail(`Invalid tasks.yaml:\n- ${errors.join("\n- ")}`);
  }

  return {
    meta: { version, project },
    tasks,
    criticalPaths,
    parallelWindows,
  };
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
  const errors = [];

  for (const task of parsed.tasks) {
    const taskErrors = [];

    for (const dependency of task.blocked_by) {
      if (dependency === task.id) {
        taskErrors.push("cannot depend on itself");
      } else if (!taskIds.has(dependency)) {
        taskErrors.push(`references missing dependency ${dependency}`);
      }
    }

    if (taskErrors.length > 0) {
      errors.push(`[${task.id}] ${taskErrors.join("; ")}`);
    }
  }

  for (const criticalPath of parsed.criticalPaths) {
    for (const taskId of criticalPath.tasks) {
      if (!taskIds.has(taskId)) {
        errors.push(`[critical_paths.${criticalPath.id}] references missing task ${taskId}`);
      }
    }
  }

  for (const parallelWindow of parsed.parallelWindows) {
    for (const taskId of parallelWindow.tasks) {
      if (!taskIds.has(taskId)) {
        errors.push(`[parallel_windows.${parallelWindow.id}] references missing task ${taskId}`);
      }
    }
  }

  errors.push(...detectDependencyCycles(parsed.tasks));

  if (errors.length > 0) {
    fail(`Invalid tasks.yaml - graph parity failed:\n- ${errors.join("\n- ")}`);
  }
}

function buildGraph(parsed) {
  validateGraphParity(parsed);

  const nodes = parsed.tasks.map((task) => {
    const node = {
      id: task.id,
      phase: task.phase,
      priority: task.priority,
      title: task.title,
      blocked_by: task.blocked_by,
      acceptance: task.acceptance,
      deliverables: task.deliverables,
      owner_type: task.owner_type,
      estimate: task.estimate,
    };
    if (task.context.length > 0) node.context = task.context;
    if (task.notes) node.notes = task.notes;
    return node;
  });

  const edgeSet = new Set();
  const edges = [];

  for (const task of parsed.tasks) {
    for (const dependency of task.blocked_by) {
      const edgeKey = `${dependency}->${task.id}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);
      edges.push({ from: dependency, to: task.id, type: "blocks" });
    }
  }

  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    return a.to.localeCompare(b.to);
  });

  return {
    schema_version: GRAPH_SCHEMA_VERSION,
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

function resolveGitBranchName(cwd) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();

    if (!branch || branch === "HEAD") {
      fail("Unable to infer planning slug from git branch. Pass an explicit slug argument.");
    }

    return branch;
  } catch {
    fail("Unable to read git branch. Pass an explicit slug argument.");
  }
}

function toPlanningSlug(rawValue) {
  const normalized = normalizeString(rawValue).toLowerCase();
  if (!normalized) {
    fail("Planning slug is required");
  }

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

  if (!slug) {
    fail(`Unable to derive a valid planning slug from "${rawValue}"`);
  }

  return slug;
}

function formatDatePrefix(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}-${month}-${year}`;
}

function hasDatePrefix(slug) {
  return /^\d{2}-\d{2}-\d{4}-/.test(slug);
}

function toDatedPlanningSlug(slug) {
  if (hasDatePrefix(slug)) return slug;
  return `${formatDatePrefix(new Date())}-${slug}`;
}

function resolvePlanningDirectory(workspaceRoot, slug) {
  const datedSlug = toDatedPlanningSlug(slug);
  const datedPlanningDir = path.resolve(workspaceRoot, "planning", datedSlug);
  if (fs.existsSync(datedPlanningDir)) {
    return { slug: datedSlug, planningDir: datedPlanningDir };
  }

  const legacyPlanningDir = path.resolve(workspaceRoot, "planning", slug);
  if (!hasDatePrefix(slug) && fs.existsSync(legacyPlanningDir)) {
    return { slug, planningDir: legacyPlanningDir };
  }

  return { slug: datedSlug, planningDir: datedPlanningDir };
}

function resolveArtifactPaths(cwd, workspaceRoot, slugArg, outputArg) {
  const slugSource = slugArg ? slugArg : resolveGitBranchName(cwd);
  const normalizedSlug = toPlanningSlug(slugSource);
  const { slug, planningDir } = resolvePlanningDirectory(workspaceRoot, normalizedSlug);

  const inputPath = path.resolve(planningDir, "tasks.yaml");
  const outputPath = outputArg
    ? path.resolve(cwd, outputArg)
    : path.resolve(planningDir, "task.graph.json");

  return { slug, planningDir, inputPath, outputPath };
}

function main() {
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const slugArg = process.argv[2];
  const outputArg = process.argv[3];
  const { slug, inputPath, outputPath } = resolveArtifactPaths(cwd, workspaceRoot, slugArg, outputArg);

  if (!fs.existsSync(inputPath)) {
    console.error(
      `Input file not found: ${inputPath}\nCreate planning artifacts at planning/${slug}/tasks.yaml first.`,
    );
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(inputPath, "utf8");
    const parsed = parseTasksYaml(content);
    const graph = buildGraph(parsed);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);

    console.info(
      `Generated ${path.relative(cwd, outputPath)} for planning/${slug} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
