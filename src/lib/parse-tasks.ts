export interface PlannedTask {
  id: string;
  title: string;
  tool: string;
  code?: string;
  arguments?: Record<string, unknown>;
}

export interface TaskPlan {
  type: "task_plan";
  questions?: string[];
  tasks: PlannedTask[];
}

/** Extract a JSON task_plan block from an assistant message. */
export function extractTaskPlan(content: string): TaskPlan | null {
  // try fenced ```json ... ``` first
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenceMatch) candidates.push(fenceMatch[1]);
  // also raw JSON object containing "task_plan"
  const rawIdx = content.indexOf('"task_plan"');
  if (rawIdx >= 0) {
    // find surrounding braces
    const start = content.lastIndexOf("{", rawIdx);
    const end = content.indexOf("}", rawIdx);
    if (start >= 0 && end > start) candidates.push(content.slice(start, end + 1));
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && parsed.type === "task_plan" && Array.isArray(parsed.tasks)) {
        return parsed as TaskPlan;
      }
    } catch {}
  }
  return null;
}