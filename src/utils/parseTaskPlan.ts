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
 * Find the index of the brace that closes the JSON object opened at
 * `start`. Walks the string while tracking brace depth and skipping
 * over string literals (so braces inside `"…{…}…"` don't disturb the
 * count). Backslash escapes inside strings are honoured.
 *
 * Returns `-1` if no balanced match is found before EOF.
 */
export function findMatchingBrace(content: string, start: number): number {
  if (content[start] !== "{") return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Pull every plausible JSON candidate out of `content`:
 *   1. Fenced ```json ... ``` (or bare ``` ... ```) blocks.
 *   2. Raw object(s) containing the literal `"task_plan"` key. We walk
 *      from the brace nearest to each `"task_plan"` occurrence and use
 *      depth tracking to find its matching close brace, so nested
 *      objects inside `tasks[*]`, `arguments`, etc. don't truncate the
 *      slice.
 */
function collectCandidates(content: string): string[] {
  const candidates: string[] = [];

  // Match every fenced block, not just the first one — the assistant
  // may emit a code sample before the actual plan.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(content)) !== null) {
    candidates.push(fenceMatch[1].trim());
  }

  // Raw, unfenced object(s) containing "task_plan". Use a global search
  // so we don't miss a later occurrence if the first one belonged to an
  // unrelated object (e.g. an example in prose).
  //
  // For each occurrence we walk backwards through every `{` to its left
  // and pick the *first* one whose matching close brace lands past the
  // occurrence — that's the smallest enclosing object. The simpler
  // `lastIndexOf("{", …)` shortcut breaks when `"task_plan"` is not the
  // first key in the object: e.g. `{"title": "P", "tasks": [{"id": "1"}],
  // "type": "task_plan"}` — `lastIndexOf` would land inside the task
  // item, not on the outer brace.
  const seenStarts = new Set<number>();
  const rawRe = /"task_plan"/g;
  let rawMatch: RegExpExecArray | null;
  while ((rawMatch = rawRe.exec(content)) !== null) {
    const occ = rawMatch.index;
    let cursor = content.lastIndexOf("{", occ);
    while (cursor >= 0) {
      if (!seenStarts.has(cursor)) {
        seenStarts.add(cursor);
        const end = findMatchingBrace(content, cursor);
        if (end > occ) {
          candidates.push(content.slice(cursor, end + 1));
          break;
        }
      }
      cursor = content.lastIndexOf("{", cursor - 1);
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

/**
 * Remove every `task_plan` JSON block from `content` so the chat can
 * render the surrounding prose without dumping the raw envelope.
 *
 * Strips:
 *   1. Fenced ```json … ``` (or bare ``` … ```) blocks whose payload
 *      parses to an object with `"type": "task_plan"`.
 *   2. Unfenced raw objects containing `"type": "task_plan"` — located
 *      with the same brace-balanced walk as `parseTaskPlan` so nested
 *      objects don't truncate the slice.
 *
 * Anything that doesn't parse to a task plan is left alone (e.g. a JSON
 * code sample the assistant happens to include unrelated to a plan).
 */
export function stripTaskPlanBlocks(content: string): string {
  if (typeof content !== "string" || content.length === 0) return content;
  const ranges: Array<[number, number]> = [];

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(content)) !== null) {
    const parsed = tryParse(fenceMatch[1].trim());
    if (isObject(parsed) && parsed.type === "task_plan") {
      ranges.push([fenceMatch.index, fenceMatch.index + fenceMatch[0].length]);
    }
  }

  const seenStarts = new Set<number>();
  const rawRe = /"task_plan"/g;
  let rawMatch: RegExpExecArray | null;
  while ((rawMatch = rawRe.exec(content)) !== null) {
    const occ = rawMatch.index;
    let cursor = content.lastIndexOf("{", occ);
    while (cursor >= 0) {
      if (!seenStarts.has(cursor)) {
        seenStarts.add(cursor);
        const end = findMatchingBrace(content, cursor);
        if (end > occ) {
          const slice = content.slice(cursor, end + 1);
          const parsed = tryParse(slice);
          if (isObject(parsed) && parsed.type === "task_plan") {
            ranges.push([cursor, end + 1]);
          }
          break;
        }
      }
      cursor = content.lastIndexOf("{", cursor - 1);
    }
  }

  if (ranges.length === 0) return content;

  // Merge overlapping ranges (a fenced block contains its inner raw
  // object — we want a single deletion, not a double-strip).
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  let out = "";
  let pos = 0;
  for (const [s, e] of merged) {
    out += content.slice(pos, s);
    pos = e;
  }
  out += content.slice(pos);

  // Collapse the blank lines left behind so the bubble doesn't grow
  // a tall empty gap where the JSON block used to live.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
