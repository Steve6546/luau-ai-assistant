import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { bridge, isAllowedTool, MCP_TOOL_ALLOWLIST, type BridgePushEvent } from "./bridge";
import type { PlannedTask } from "./parse-tasks";
import { toast } from "sonner";

export type TaskStatus = "pending" | "awaiting_approval" | "running" | "testing" | "fixing" | "done" | "failed" | "cancelled";

export interface StudioLogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "output";
  message: string;
}

export interface RuntimeTask extends PlannedTask {
  status: TaskStatus;
  output?: string;
  durationMs?: number;
  retryCount?: number;
  snapshotId?: string;
  taskRowId?: string;
  /** original on-disk script content (for diff) */
  diffOriginal?: string;
  diffNew?: string;
  scriptPath?: string;
  approved?: boolean | null;
  logs?: StudioLogEntry[];
}

const WRITE_TOOLS = new Set(["multi_edit", "set_property", "run_code", "execute_luau"]);
const TEST_TOOLS = new Set(["run_code", "execute_luau", "multi_edit"]);
const MAX_FIX_ATTEMPTS = 3;

function uuid() { return crypto.randomUUID(); }

/** Try to read original script content for diff preview. */
async function readScript(path: string): Promise<string> {
  try {
    const res = await bridge.send({
      requestId: uuid(),
      tool: "call_tool",
      name: "script_read",
      arguments: { path },
    });
    const out = res.output ?? res.result;
    if (typeof out === "string") return out;
    if (out && typeof (out as any).content === "string") return (out as any).content;
    return "";
  } catch { return ""; }
}

/** Pull a script path + new content out of a multi_edit task's arguments. */
function extractEdit(t: PlannedTask): { path: string; newContent: string } | null {
  const args: any = t.arguments || {};
  const path = args.path || args.scriptPath || args.script_path || args.file || "";
  const content = args.content || args.new_content || args.newContent || t.code || "";
  if (!path || !content) return null;
  return { path, newContent: content };
}

export function useTaskExecutor(conversationId: string | null) {
  const [tasks, setTasks] = useState<RuntimeTask[]>([]);
  /** Index of the currently-running task; used to route live studio logs. */
  const activeIdxRef = useRef<number | null>(null);

  const update = useCallback((idx: number, patch: Partial<RuntimeTask>) => {
    setTasks((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }, []);

  const setAll = useCallback((next: RuntimeTask[]) => setTasks(next), []);

  const appendLog = useCallback((idx: number, entry: StudioLogEntry) => {
    setTasks((p) => p.map((x, i) => i === idx
      ? { ...x, logs: [...(x.logs || []), entry].slice(-200) }
      : x));
  }, []);

  // Pipe live studio_log push events to the active task.
  useEffect(() => {
    const unsub = bridge.onPush((ev: BridgePushEvent) => {
      const idx = activeIdxRef.current;
      if (idx == null) return;
      const type = String(ev.type || ev.event || "").toLowerCase();
      if (!type.includes("log") && !type.includes("console") && !type.includes("output")) return;
      const message = String(ev.message ?? ev.text ?? JSON.stringify(ev));
      const lvl = String(ev.level || "info").toLowerCase();
      const level: StudioLogEntry["level"] =
        lvl.includes("err") ? "error" : lvl.includes("warn") ? "warn" : lvl.includes("out") ? "output" : "info";
      appendLog(idx, { ts: Date.now(), level, message });
    });
    return () => { unsub(); };
  }, [appendLog]);

  /** Take a snapshot before a write task. */
  const takeSnapshot = useCallback(async (label: string): Promise<string | null> => {
    if (!conversationId) return null;
    try {
      const res = await bridge.send({
        requestId: uuid(),
        tool: "call_tool",
        name: "snapshot",
        arguments: {},
      }, 20000);
      const data = res.output ?? res.result ?? {};
      const { data: row } = await supabase.from("snapshots")
        .insert({ conversation_id: conversationId, snapshot_data: data as any, label })
        .select().single();
      return (row as any)?.id ?? null;
    } catch (e: any) {
      console.warn("snapshot failed", e?.message);
      return null;
    }
  }, [conversationId]);

  /** Watch console after a write/exec task; returns error string or null. */
  const watchConsole = useCallback(async (): Promise<string | null> => {
    try {
      const res = await bridge.send({
        requestId: uuid(),
        tool: "call_tool",
        name: "watch_console",
        arguments: { duration_ms: 2000, start_play: false },
      }, 5000);
      const out: any = res.output ?? res.result ?? {};
      if (out.has_errors) {
        if (Array.isArray(out.errors)) return out.errors.join("\n");
        return out.error || out.message || "Unknown error";
      }
      return null;
    } catch (e: any) {
      return null;
    }
  }, []);

  /** Ask AI to fix the error. */
  const requestFix = useCallback(async (error: string, code: string): Promise<string | null> => {
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `Fix this Luau error and return ONLY the corrected Luau code (no markdown, no explanation):\n\nError: ${error}\n\nCode:\n${code}`,
          }],
          model: "google/gemini-3-flash-preview",
        }),
      });
      if (!resp.ok || !resp.body) return null;
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "", out = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") return out.replace(/^```\w*\n?|\n?```$/g, "").trim();
          try {
            const d = JSON.parse(j);
            const delta = d.choices?.[0]?.delta?.content;
            if (delta) out += delta;
          } catch {}
        }
      }
      return out.replace(/^```\w*\n?|\n?```$/g, "").trim() || null;
    } catch { return null; }
  }, []);

  /** Send the actual MCP call_tool and return response. */
  const sendTool = useCallback(async (t: RuntimeTask) => {
    if (!isAllowedTool(t.tool)) {
      throw new Error(`Tool '${t.tool}' is not in the MCP allowlist (${MCP_TOOL_ALLOWLIST.join(", ")})`);
    }
    return bridge.send({
      requestId: uuid(),
      tool: "call_tool",
      name: t.tool,
      arguments: t.code ? { code: t.code, ...t.arguments } : (t.arguments || {}),
    });
  }, []);

  /** Prepare a task: for write tools, fetch original content and switch to awaiting_approval. */
  const prepare = useCallback(async (idx: number) => {
    const t = tasks[idx];
    if (!t) return;
    if (bridge.getSnapshot().status !== "connected") {
      toast.error("Bridge not connected. Connect Roblox Studio first.");
      return;
    }
    if (t.tool === "multi_edit") {
      const edit = extractEdit(t);
      if (edit) {
        update(idx, { status: "awaiting_approval", scriptPath: edit.path, diffNew: edit.newContent });
        const original = await readScript(edit.path);
        update(idx, { diffOriginal: original });
        return;
      }
    }
    // No diff preview required → run directly
    await execute(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  /** Execute a task end-to-end: snapshot → run → self-test → auto-fix loop. */
  const execute = useCallback(async (idx: number) => {
    const t = tasks[idx];
    if (!t || !conversationId) return;
    if (bridge.getSnapshot().status !== "connected") {
      toast.error("Bridge not connected.");
      return;
    }

    let snapshotId: string | undefined;
    if (WRITE_TOOLS.has(t.tool)) {
      update(idx, { status: "running", output: "📸 Taking snapshot…" });
      const sid = await takeSnapshot(`Before: ${t.title}`);
      if (sid) snapshotId = sid;
    }
    update(idx, { status: "running", output: undefined, snapshotId, logs: [] });
    activeIdxRef.current = idx;

    let attempt = 0;
    let currentTask: RuntimeTask = { ...t, snapshotId };
    let lastDuration = 0;

    while (true) {
      try {
        const res = await sendTool(currentTask);
        const ok = !res.error && res.status !== "error";
        const output = res.output ?? res.result ?? res.error ?? "";
        const outStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
        lastDuration = res.durationMs ?? 0;

        if (!ok) {
          throw new Error(outStr || "Tool returned error");
        }

        // Self-test
        if (TEST_TOOLS.has(currentTask.tool)) {
          update(idx, { status: "testing", output: "🔎 Watching console…" });
          const err = await watchConsole();
          if (err) {
            if (attempt >= MAX_FIX_ATTEMPTS) {
              throw new Error(`❌ Failed after ${attempt}/${MAX_FIX_ATTEMPTS} fix attempts.\n\nLast error:\n${err}`);
            }
            attempt++;
            update(idx, {
              status: "fixing",
              output: `⚠️ Console error detected.\nFix attempt ${attempt} of ${MAX_FIX_ATTEMPTS}…\n\n${err}`,
            });
            const codeToFix = currentTask.code || (currentTask.arguments as any)?.content || "";
            const fixed = await requestFix(err, codeToFix);
            if (!fixed) throw new Error(`❌ AI could not generate a fix on attempt ${attempt}/${MAX_FIX_ATTEMPTS}.\n\n${err}`);
            currentTask = {
              ...currentTask,
              tool: "multi_edit",
              arguments: currentTask.scriptPath
                ? { path: currentTask.scriptPath, content: fixed }
                : { ...(currentTask.arguments || {}), content: fixed },
              code: currentTask.scriptPath ? undefined : fixed,
            };
            continue; // retry
          }
        }

        // Success
        const finalOutput = attempt > 0
          ? `✅ Fixed automatically on attempt ${attempt}/${MAX_FIX_ATTEMPTS}.\n\n${outStr}`
          : `✅ ${outStr || "Done"}`;
        update(idx, {
          status: "done",
          output: finalOutput,
          durationMs: lastDuration,
          retryCount: attempt,
          snapshotId,
          approved: t.tool === "multi_edit" ? true : t.approved ?? null,
        });

        const { data: row } = await supabase.from("tasks").insert({
          conversation_id: conversationId,
          title: t.title,
          tool: t.tool,
          code: t.code,
          status: "done",
          output: finalOutput,
          duration_ms: lastDuration,
          snapshot_id: snapshotId ?? null,
          retry_count: attempt,
          approved: t.status === "awaiting_approval" ? true : null,
          script_path: currentTask.scriptPath ?? null,
          diff_original: currentTask.diffOriginal ?? null,
          diff_new: currentTask.diffNew ?? null,
        }).select().single();
        update(idx, { taskRowId: (row as any)?.id });
        return;
      } catch (e: any) {
        activeIdxRef.current = null;
        update(idx, {
          status: "failed",
          output: e?.message || "Task failed",
          retryCount: attempt,
          snapshotId,
        });
        await supabase.from("tasks").insert({
          conversation_id: conversationId,
          title: t.title,
          tool: t.tool,
          code: t.code,
          status: "failed",
          output: e?.message || "Task failed",
          duration_ms: lastDuration,
          snapshot_id: snapshotId ?? null,
          retry_count: attempt,
        });
        return;
      }
    }
  }, [tasks, conversationId, sendTool, takeSnapshot, watchConsole, requestFix, update]);

  const cancel = useCallback(async (idx: number) => {
    const t = tasks[idx];
    update(idx, { status: "cancelled", output: "❌ Rejected — write tool not executed", approved: false });
    if (conversationId) {
      await supabase.from("tasks").insert({
        conversation_id: conversationId,
        title: t?.title ?? "Cancelled task",
        tool: t?.tool ?? "unknown",
        status: "cancelled",
        approved: false,
        script_path: t?.scriptPath ?? null,
        diff_original: t?.diffOriginal ?? null,
        diff_new: t?.diffNew ?? null,
      });
    }
  }, [tasks, conversationId, update]);

  const undo = useCallback(async (idx: number) => {
    const t = tasks[idx];
    if (!t?.snapshotId) { toast.error("No snapshot available for this task"); return; }
    if (bridge.getSnapshot().status !== "connected") { toast.error("Bridge not connected."); return; }
    const { data: snap } = await supabase.from("snapshots").select("snapshot_data").eq("id", t.snapshotId).maybeSingle();
    if (!snap || !snap.snapshot_data) { toast.error("Snapshot data missing — cannot undo"); return; }
    update(idx, { status: "running", output: "↩ Restoring previous Studio state…" });
    try {
      await bridge.send({
        requestId: uuid(),
        tool: "call_tool",
        name: "run_code",
        arguments: { restore_snapshot_id: t.snapshotId, snapshot: snap.snapshot_data },
      }, 30000);
      update(idx, { status: "done", output: "✅ Restored to previous state from snapshot" });
      toast.success("Studio state restored");
    } catch (e: any) {
      update(idx, { status: "failed", output: `↩ Restore failed: ${e.message}` });
      toast.error("Restore failed");
    }
  }, [tasks, update]);

  const runAll = useCallback(async () => {
    // If tasks are all simple write/exec actions, group into one batch_execute
    if (
      tasks.length > 1 &&
      tasks.every((t) => ["execute_luau", "run_code", "set_property", "insert_instance"].includes(t.tool))
    ) {
      if (bridge.getSnapshot().status !== "connected") {
        toast.error("Bridge not connected.");
        return;
      }
      // mark all as running
      tasks.forEach((_, i) => update(i, { status: "running", output: "🧩 Batched…" }));
      const sid = await takeSnapshot(`Before batch (${tasks.length})`);
      try {
        const res = await bridge.send({
          requestId: uuid(),
          tool: "call_tool",
          name: "batch_execute",
          arguments: {
            steps: tasks.map((t) => ({
              tool: t.tool,
              code: t.code,
              arguments: t.arguments || {},
            })),
          },
        }, 60000);
        const out: any = res.output ?? res.result ?? {};
        const results: any[] = Array.isArray(out.results) ? out.results : [];
        for (let i = 0; i < tasks.length; i++) {
          const r = results[i] ?? {};
          const ok = !r.error && r.status !== "error";
          const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? r.error ?? "Done", null, 2);
          update(i, {
            status: ok ? "done" : "failed",
            output: ok ? `✅ ${text}` : `❌ ${text}`,
            snapshotId: sid ?? undefined,
            durationMs: r.durationMs ?? 0,
          });
          if (conversationId) {
            await supabase.from("tasks").insert({
              conversation_id: conversationId,
              title: tasks[i].title,
              tool: tasks[i].tool,
              code: tasks[i].code,
              status: ok ? "done" : "failed",
              output: text,
              snapshot_id: sid ?? null,
              duration_ms: r.durationMs ?? 0,
            });
          }
        }
        toast.success(`Batch complete (${results.filter((r) => !r.error).length}/${tasks.length})`);
        return;
      } catch (e: any) {
        toast.error(`Batch failed: ${e.message}`);
        tasks.forEach((_, i) => update(i, { status: "failed", output: e.message }));
        return;
      }
    }
    for (let i = 0; i < tasks.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await prepare(i);
    }
  }, [tasks, prepare, takeSnapshot, conversationId, update]);

  return { tasks, setAll, prepare, execute, cancel, undo, runAll, update };
}