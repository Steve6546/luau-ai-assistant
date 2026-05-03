import { z } from "zod";
import { isAllowedTool } from "./bridge";

export const PlannedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  tool: z.string().min(1).max(64),
  code: z.string().max(50_000).optional(),
  arguments: z.record(z.unknown()).optional(),
});
export const TaskPlanSchema = z.object({
  type: z.literal("task_plan"),
  questions: z.array(z.string().max(1000)).max(20).optional(),
  tasks: z.array(PlannedTaskSchema).max(50),
});

export type PlannedTask = z.infer<typeof PlannedTaskSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export function isTaskAllowed(tool: string): boolean {
  // permit non-MCP tools like ping; allowlist only enforced for MCP call_tool dispatches
  return isAllowedTool(tool) || tool === "ping";
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
      const result = TaskPlanSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {}
  }
  return null;
}