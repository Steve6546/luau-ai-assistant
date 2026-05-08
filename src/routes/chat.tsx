import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { RequireAuth, TopNav } from "@/components/AppShell";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { MODELS, getStoredModel, setStoredModel, type ModelId } from "@/lib/models";
import { useBridge, type BridgeStatus } from "@/lib/bridge";
import { extractTaskPlan } from "@/lib/parse-tasks";
import { useTaskExecutor, type RuntimeTask } from "@/lib/use-task-executor";
import { ScriptDiffViewer } from "@/components/ScriptDiffViewer";
import { parseTaskPlan, stripTaskPlanBlocks } from "@/utils/parseTaskPlan";
import { PlanPreviewCard } from "@/components/PlanPreviewCard";
import { ModeSelector } from "@/components/ModeSelector";
import { useChatMode } from "@/contexts/ChatModeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Send,
  Sparkles,
  MessageSquare,
  Trash2,
  LogOut,
  ListChecks,
  Check,
  X,
  Loader2,
  ChevronDown,
  Play,
  History,
  RefreshCw,
  Undo2,
} from "lucide-react";

export const Route = createFileRoute("/chat")({
  component: () => (
    <RequireAuth>
      <ChatPage />
    </RequireAuth>
  ),
});

interface Conv {
  id: string;
  title: string;
  model: string;
  updated_at: string;
}
interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string | null;
  created_at: string;
}

function ChatPage() {
  const { user, signOut } = useAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelId>(getStoredModel());
  const [streaming, setStreaming] = useState(false);
  const [search, setSearch] = useState("");
  const [taskPanelOpen, setTaskPanelOpen] = useState(true);
  const [questions, setQuestions] = useState<string[]>([]);
  const [dismissedPlans, setDismissedPlans] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const bridge = useBridge();
  const { mode } = useChatMode();
  const executor = useTaskExecutor(activeId);
  const {
    tasks,
    setAll: setTasks,
    prepare: prepareTask,
    execute: executeTask,
    cancel: cancelTask,
    undo: undoTask,
    runAll: runAllTasks,
  } = executor;
  const autoRanRef = useRef<string | null>(null);

  useEffect(() => {
    setStoredModel(model);
  }, [model]);

  // Auto-execute pending tasks when a fresh plan is loaded and bridge is ready.
  useEffect(() => {
    if (!tasks.length) return;
    if (bridge.status !== "connected") return;
    const allPending = tasks.every((t) => t.status === "pending");
    if (!allPending) return;
    const sig = tasks.map((t) => t.title + t.tool).join("|");
    if (autoRanRef.current === sig) return;
    autoRanRef.current = sig;
    runAllTasks();
  }, [tasks, bridge.status, runAllTasks]);

  // load convs
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .order("updated_at", { ascending: false });
      if (data) {
        setConvs(data as Conv[]);
        if (!activeId && data.length) setActiveId(data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // load messages for active conv
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setTasks([]);
      setQuestions([]);
      setDismissedPlans(new Set());
      return;
    }
    setDismissedPlans(new Set());
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId)
        .order("created_at");
      if (data) {
        setMessages(data as Msg[]);
        const last = (data as Msg[]).filter((m) => m.role === "assistant").pop();
        if (last) {
          const plan = extractTaskPlan(last.content);
          if (plan) {
            setQuestions(plan.questions || []);
            setTasks(plan.tasks.map((t) => ({ ...t, status: "pending" })));
          } else {
            setTasks([]);
            setQuestions([]);
          }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function newConversation() {
    // Reuse existing empty conversation if present
    const empty = convs.find((c) => c.title === "New chat");
    if (empty) {
      // verify it has no messages
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", empty.id);
      if (!count) {
        setActiveId(empty.id);
        return;
      }
    }
    if (!user) return;
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New chat", model })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setConvs((p) => [data as Conv, ...p]);
    setActiveId((data as Conv).id);
  }

  async function deleteConversation(id: string) {
    await supabase.from("conversations").delete().eq("id", id);
    setConvs((p) => p.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;
    let convId = activeId;
    if (!convId) {
      if (!user) return;
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: text.slice(0, 60), model })
        .select()
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      convId = (data as Conv).id;
      setConvs((p) => [data as Conv, ...p]);
      setActiveId(convId);
    }

    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setStreaming(true);

    await supabase
      .from("messages")
      .insert({ conversation_id: convId, role: "user", content: text });

    // auto-title if "New chat"
    const conv = convs.find((c) => c.id === convId);
    if (!conv || conv.title === "New chat") {
      const newTitle = text.slice(0, 60);
      await supabase
        .from("conversations")
        .update({ title: newTitle, model, updated_at: new Date().toISOString() })
        .eq("id", convId);
      setConvs((p) => p.map((c) => (c.id === convId ? { ...c, title: newTitle, model } : c)));
    } else {
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString(), model })
        .eq("id", convId);
    }

    // Build history
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    let assistantSoFar = "";
    setMessages((p) => [
      ...p,
      { id: "streaming", role: "assistant", content: "", created_at: new Date().toISOString() },
    ]);

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: history, model }),
      });
      if (resp.status === 429) {
        toast.error("Rate limit. Try again shortly.");
        throw new Error("rate");
      }
      if (resp.status === 402) {
        toast.error("AI credits exhausted.");
        throw new Error("credits");
      }
      if (!resp.ok || !resp.body) throw new Error("Stream failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantSoFar += delta;
              setMessages((p) =>
                p.map((m) => (m.id === "streaming" ? { ...m, content: assistantSoFar } : m)),
              );
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Persist final assistant message
      const { data: saved } = await supabase
        .from("messages")
        .insert({
          conversation_id: convId,
          role: "assistant",
          content: assistantSoFar,
        })
        .select()
        .single();
      setMessages((p) => p.map((m) => (m.id === "streaming" ? { ...(saved as Msg) } : m)));

      // Detect task plan
      const plan = extractTaskPlan(assistantSoFar);
      if (plan) {
        setQuestions(plan.questions || []);
        setTasks(plan.tasks.map((t) => ({ ...t, status: "pending" })));
        setTaskPanelOpen(true);
        // Auto-execute: bridge does the work, user only approves multi_edit diffs
        autoRanRef.current = null;
      } else {
        setTasks([]);
        setQuestions([]);
      }
    } catch (e: unknown) {
      console.error(e);
      setMessages((p) => p.filter((m) => m.id !== "streaming"));
    } finally {
      setStreaming(false);
    }
  }

  const filteredConvs = useMemo(
    () => convs.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
    [convs, search],
  );

  const activeModel = MODELS.find((m) => m.id === model) || MODELS[0];

  const HistoryPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 h-8 px-2 text-xs">
          <History className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">History</span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            {convs.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="p-2 space-y-2 border-b border-border">
          <Button size="sm" className="w-full justify-start gap-2 h-8" onClick={newConversation}>
            <Plus className="w-4 h-4" /> New chat
          </Button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 h-8 bg-background/50"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="max-h-80">
          <div className="p-1">
            {filteredConvs.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm ${activeId === c.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}
                onClick={() => setActiveId(c.id)}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1">{c.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {!filteredConvs.length && (
              <div className="text-xs text-muted-foreground px-2 py-6 text-center">
                No conversations
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border flex items-center gap-2">
          <div className="flex-1 text-xs text-muted-foreground truncate">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-muted-foreground"
            onClick={() => signOut()}
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const TaskPanel = (
    <div className="flex flex-col h-full w-full md:w-[320px] bg-card border-l border-border">
      <div className="p-3 flex items-center gap-2 border-b border-border">
        <ListChecks className="w-4 h-4 text-primary" />
        <div className="text-sm font-semibold flex-1">
          Tasks{" "}
          {tasks.length > 0 && (
            <span className="text-muted-foreground font-normal">· {tasks.length}</span>
          )}
        </div>
        {tasks.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={runAllTasks}
            disabled={tasks.some(
              (t) => t.status === "running" || t.status === "testing" || t.status === "fixing",
            )}
            title="Runs as one batch when possible (batch_execute)"
          >
            <Play className="w-3 h-3 mr-1" /> Run all
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 p-3">
        {questions.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Questions</div>
            {questions.map((q, i) => (
              <div key={i} className="text-sm bg-background/40 border border-border rounded-md p-2">
                {q}
              </div>
            ))}
          </div>
        )}
        {tasks.length === 0 && questions.length === 0 && (
          <div className="text-xs text-muted-foreground text-center mt-12">
            No tasks yet.
            <br />
            Ask the AI to do something in Studio.
          </div>
        )}
        <div className="space-y-2">
          {tasks.map((t, i) => (
            <div key={i} className="border border-border rounded-md p-3 bg-background/40">
              <div className="flex items-start gap-2 mb-2">
                <StatusBadge status={t.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.tool}
                    {t.durationMs ? ` · ${t.durationMs}ms` : ""}
                    {t.retryCount && t.retryCount > 0
                      ? ` · 🔧 ${t.retryCount} fix${t.retryCount > 1 ? "es" : ""}`
                      : ""}
                  </div>
                </div>
                {t.snapshotId && t.status === "done" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    title="Undo to snapshot"
                    onClick={() => undoTask(i)}
                  >
                    <Undo2 className="w-3 h-3" />
                  </Button>
                )}
                {!t.snapshotId && t.status === "done" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 opacity-40"
                    title="No snapshot available"
                    disabled
                  >
                    <Undo2 className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => prepareTask(i)}
                  disabled={
                    t.status === "running" ||
                    t.status === "testing" ||
                    t.status === "fixing" ||
                    t.status === "awaiting_approval"
                  }
                >
                  {t.status === "running" || t.status === "testing" || t.status === "fixing" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </Button>
              </div>
              {t.status === "awaiting_approval" && t.scriptPath && t.diffNew !== undefined && (
                <div className="mt-2">
                  <div className="text-[10px] text-amber-400 mb-1 uppercase tracking-wide">
                    Awaiting approval — write tool blocked
                  </div>
                  <ScriptDiffViewer
                    scriptPath={t.scriptPath}
                    originalContent={t.diffOriginal ?? ""}
                    newContent={t.diffNew}
                    onApprove={() => executeTask(i)}
                    onCancel={() => cancelTask(i)}
                  />
                </div>
              )}
              {t.approved === true && t.status === "done" && (
                <div className="text-[10px] text-emerald-400 mb-1">✓ Approved diff applied</div>
              )}
              {t.approved === false && (
                <div className="text-[10px] text-red-400 mb-1">✗ Rejected — write skipped</div>
              )}
              {t.code && (
                <pre className="text-[11px] bg-[#1e1e1e] rounded p-2 max-h-32 overflow-auto font-mono">
                  {t.code}
                </pre>
              )}
              {t.output && (
                <div className="mt-2 text-[11px]">
                  <div className="text-muted-foreground mb-1">Output</div>
                  <pre className="bg-background/60 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">
                    {t.output}
                  </pre>
                </div>
              )}
              {t.logs && t.logs.length > 0 && (
                <div className="mt-2 text-[11px]">
                  <div className="text-muted-foreground mb-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot" /> Studio
                    logs ({t.logs.length})
                  </div>
                  <div className="bg-[#0b0b0b] rounded p-2 max-h-40 overflow-auto font-mono space-y-0.5">
                    {t.logs.map((l, k) => (
                      <div
                        key={k}
                        className={
                          l.level === "error"
                            ? "text-red-400"
                            : l.level === "warn"
                              ? "text-amber-400"
                              : l.level === "output"
                                ? "text-sky-300"
                                : "text-muted-foreground"
                        }
                      >
                        <span className="opacity-50 mr-1">
                          {new Date(l.ts).toLocaleTimeString()}
                        </span>
                        {l.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-border flex items-center px-3 gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-md bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm font-semibold hidden sm:inline">Roblox AI</span>
          </div>
          {HistoryPopover}
          <BridgeIndicator
            status={bridge.status}
            latency={bridge.latency}
            onReconnect={bridge.reconnect}
          />
          <div className="flex-1" />
          <TopNav />
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden gap-1 h-8"
            onClick={() => setTaskPanelOpen((v) => !v)}
          >
            <ListChecks className="w-4 h-4" />
          </Button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.length === 0 && (
              <div className="text-center mt-20">
                <div className="w-12 h-12 rounded-2xl bg-primary/15 mx-auto flex items-center justify-center mb-4">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold mb-1">Roblox Studio AI</h2>
                <p className="text-sm text-muted-foreground">
                  Ask me to scaffold scripts, inspect the DataModel, or run Luau in Studio.
                </p>
              </div>
            )}
            {messages.map((m) => {
              const isAssistant = m.role === "assistant";
              const plan = isAssistant && m.id !== "streaming" ? parseTaskPlan(m.content) : null;
              const visibleContent = plan ? stripTaskPlanBlocks(m.content) : m.content;
              const showPreview = !!plan && !dismissedPlans.has(m.id);
              return (
                <div key={m.id} className="space-y-2">
                  <div className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}
                    >
                      {m.role === "user" ? user?.email?.[0]?.toUpperCase() || "U" : "AI"}
                    </div>
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-2.5 ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"} ${isAssistant && !visibleContent ? "hidden" : ""}`}
                    >
                      {m.id === "streaming" && !m.content ? (
                        <div className="flex gap-1 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground pulse-dot" />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-muted-foreground pulse-dot"
                            style={{ animationDelay: "0.2s" }}
                          />
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-muted-foreground pulse-dot"
                            style={{ animationDelay: "0.4s" }}
                          />
                        </div>
                      ) : (
                        <MarkdownMessage content={visibleContent} />
                      )}
                    </div>
                  </div>
                  {showPreview && plan && (
                    <div className="flex gap-3">
                      <div className="w-7 shrink-0" />
                      <div className="max-w-[85%] flex-1">
                        <PlanPreviewCard
                          plan={plan}
                          mode={mode}
                          onApprove={() => {
                            // Phase 2 placeholder: actual execution wiring
                            // (executor.executePlan) lands in Phase 4. The legacy
                            // task-panel flow keeps running on the old envelope
                            // emitted via `extractTaskPlan` and is unaffected.
                            console.log("[PlanPreviewCard] approved", plan);
                            toast.success("Plan approved — execution coming in next phase");
                          }}
                          onCancel={() => {
                            setDismissedPlans((prev) => {
                              const next = new Set(prev);
                              next.add(m.id);
                              return next;
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border bg-background/80 backdrop-blur p-3">
          <div className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-border bg-card focus-within:border-primary/60 transition-colors p-2 flex items-end gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs shrink-0">
                    <GoogleIcon /> {activeModel.label} <ChevronDown className="w-3 h-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-1">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={`w-full text-left px-3 py-2 rounded-md hover:bg-accent flex items-start gap-2 ${m.id === model ? "bg-accent" : ""}`}
                    >
                      <GoogleIcon />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.label}</div>
                        <div className="text-xs text-muted-foreground">{m.description}</div>
                      </div>
                      {m.id === model && <Check className="w-4 h-4 text-primary mt-0.5" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask anything about Roblox Studio…"
                rows={1}
                dir={/[\u0600-\u06FF]/.test(input) ? "rtl" : "ltr"}
                className="flex-1 min-h-[36px] max-h-40 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm"
              />
              <ModeSelector className="shrink-0" />
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
              >
                {streaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex">{TaskPanel}</div>
      {taskPanelOpen && (
        <div className="lg:hidden fixed inset-y-0 right-0 z-40 w-[340px] shadow-2xl">
          {TaskPanel}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RuntimeTask["status"] }) {
  const map: Record<RuntimeTask["status"], { color: string; label: string; icon: ReactNode }> = {
    pending: { color: "bg-muted text-muted-foreground", label: "Pending", icon: null },
    awaiting_approval: {
      color: "bg-amber-500/20 text-amber-400",
      label: "Awaiting approval",
      icon: null,
    },
    running: {
      color: "bg-primary/20 text-primary",
      label: "Running",
      icon: <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot inline-block" />,
    },
    testing: {
      color: "bg-sky-500/20 text-sky-400",
      label: "Testing",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    fixing: {
      color: "bg-amber-500/20 text-amber-400",
      label: "Fixing",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    done: {
      color: "bg-emerald-500/20 text-emerald-400",
      label: "Done",
      icon: <Check className="w-3 h-3" />,
    },
    failed: {
      color: "bg-destructive/20 text-destructive",
      label: "Failed",
      icon: <X className="w-3 h-3" />,
    },
    cancelled: {
      color: "bg-red-500/15 text-red-400",
      label: "Rejected",
      icon: <X className="w-3 h-3" />,
    },
  };
  const m = map[status];
  return (
    <Badge className={`gap-1 ${m.color} border-0 font-normal text-[10px] px-1.5 py-0.5`}>
      {m.icon}
      {m.label}
    </Badge>
  );
}

function BridgeIndicator({
  status,
  latency,
  onReconnect,
}: {
  status: BridgeStatus;
  latency: number | null;
  onReconnect: () => void;
}) {
  const map = {
    connected: { dot: "bg-emerald-500", label: "Connected" },
    reconnecting: { dot: "bg-amber-500 animate-pulse", label: "Reconnecting" },
    disconnected: { dot: "bg-red-500", label: "Disconnected" },
  } as const;
  const m = map[status];
  return (
    <button
      onClick={onReconnect}
      title="Click to reconnect"
      className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 rounded-md bg-card/60 border border-border hover:border-primary/40 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${m.dot}`} />
      <span>
        {m.label}
        {latency != null && status === "connected" ? ` · ${latency}ms` : ""}
      </span>
      {status !== "connected" && <RefreshCw className="w-3 h-3" />}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
      <path
        fill="#EA4335"
        d="M12 11v3.2h5.3c-.2 1.4-1.6 4-5.3 4-3.2 0-5.8-2.7-5.8-5.9s2.6-5.9 5.8-5.9c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.7 4 14.6 3 12 3 7 3 3 7 3 12s4 9 9 9c5.2 0 8.6-3.7 8.6-8.8 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
