/**
 * Extracts a `task_plan` JSON block from an assistant message.
 *
 * The Phase 2 task-plan envelope is richer than the legacy parser in
 * `src/lib/parse-tasks.ts` — it carries scaffold metadata, per-task
 * approval/snapshot flags, category classification, and a `suggested_next`
 * follow-up list. We keep this parser isolated so the existing chat flow
 * (which still uses the legacy parser) is not affected.
 *
 * Returns `null` if no valid block is found.
 */

export type TaskCategory = "read" | "write" | "runtime" | "destructive";

export interface ScaffoldEntry {
  path: string;
  type: string;
}

export interface TaskItem {
  id: string;
  title: string;
  tool: string;
  category: TaskCategory;
  requiresApproval: boolean;
  requiresSnapshot: boolean;
  arguments: Record<string, unknown>;
}

export interface TaskPlan {
  type: "task_plan";
  title: string;
  summary: string;
  mode?: string;
  requiresApproval: boolean;
  scaffold?: ScaffoldEntry[];
  tasks: TaskItem[];
  suggested_next?: string[];
}

const VALID_CATEGORIES: readonly TaskCategory[] = ["read", "write", "runtime", "destructive"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function asScaffold(value: unknown): ScaffoldEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ScaffoldEntry[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const path = asString(item.path);
    const type = asString(item.type);
    if (path && type) out.push({ path, type });
  }
  return out.length > 0 ? out : undefined;
}

function asCategory(value: unknown): TaskCategory | null {
  if (typeof value !== "string") return null;
  return (VALID_CATEGORIES as readonly string[]).includes(value) ? (value as TaskCategory) : null;
}

function asArguments(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function asTask(raw: unknown): TaskItem | null {
  if (!isObject(raw)) return null;
  const id = asString(raw.id);
  const title = asString(raw.title);
  const tool = asString(raw.tool);
  const category = asCategory(raw.category);
  if (!id || !title || !tool || !category) return null;
  return {
    id,
    title,
    tool,
    category,
    requiresApproval: asBool(raw.requiresApproval, false),
    requiresSnapshot: asBool(raw.requiresSnapshot, false),
    arguments: asArguments(raw.arguments),
  };
}

function tryParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Pull every plausible JSON candidate out of `content`:
 *   1. Fenced ```json ... ``` (or bare ``` ... ```) blocks.
 *   2. Raw object containing the literal `"task_plan"` key, bounded by
 *      its nearest surrounding braces.
 */
function collectCandidates(content: string): string[] {
  const candidates: string[] = [];

  // Match every fenced block, not just the first one — the assistant
  // may emit a code sample before the actual plan.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(content)) !== null) {
    candidates.push(match[1].trim());
  }

  // Raw, unfenced object containing "task_plan".
  const rawIdx = content.indexOf('"task_plan"');
  if (rawIdx >= 0) {
    const start = content.lastIndexOf("{", rawIdx);
    const end = content.indexOf("}", rawIdx);
    if (start >= 0 && end > start) {
      candidates.push(content.slice(start, end + 1));
    }
  }

  return candidates;
}

export function parseTaskPlan(content: string): TaskPlan | null {
  if (typeof content !== "string" || content.length === 0) return null;

  for (const candidate of collectCandidates(content)) {
    const parsed = tryParse(candidate);
    if (!isObject(parsed)) continue;
    if (parsed.type !== "task_plan") continue;

    const title = asString(parsed.title);
    const summary = asString(parsed.summary);
    if (!title || !summary) continue;

    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasks: TaskItem[] = [];
    for (const t of rawTasks) {
      const task = asTask(t);
      if (task) tasks.push(task);
    }
    if (tasks.length === 0) continue;

    const plan: TaskPlan = {
      type: "task_plan",
      title,
      summary,
      requiresApproval: asBool(parsed.requiresApproval, false),
      tasks,
    };

    const mode = asString(parsed.mode);
    if (mode) plan.mode = mode;

    const scaffold = asScaffold(parsed.scaffold);
    if (scaffold) plan.scaffold = scaffold;

    const suggested = asStringArray(parsed.suggested_next);
    if (suggested) plan.suggested_next = suggested;

    return plan;
  }

  return null;
}
