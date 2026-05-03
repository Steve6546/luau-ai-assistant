import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth, TopNav } from "@/components/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, FileCode, Clock, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/projects/$id")({
  component: () => <RequireAuth><ProjectDetailPage /></RequireAuth>,
});

interface Project { id: string; name: string; description: string | null; }
interface Conv { id: string; title: string; updated_at: string; model: string; }
interface Task { id: string; title: string; tool: string; status: string; output: string | null; duration_ms: number | null; created_at: string; conversation_id: string; }

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
      if (!p) { navigate({ to: "/projects" }); return; }
      setProject(p as Project);
      const { data: c } = await supabase.from("conversations").select("*").eq("project_id", id).order("updated_at", { ascending: false });
      setConvs((c as Conv[]) || []);
      const convIds = (c || []).map((x: any) => x.id);
      if (convIds.length) {
        const { data: t } = await supabase.from("tasks").select("*").in("conversation_id", convIds).order("created_at", { ascending: false });
        setTasks((t as Task[]) || []);
      }
      setLoading(false);
    })();
  }, [id, navigate]);

  if (loading) return <div className="min-h-screen bg-background" />;
  if (!project) return null;

  const succeeded = tasks.filter((t) => t.status === "done").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 border-b border-border flex items-center px-4 gap-3">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="font-semibold text-sm truncate">{project.name}</div>
        <div className="flex-1" />
        <TopNav />
      </header>
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.description || "No description"}</p>
          <div className="flex gap-2 mt-3">
            <Badge variant="secondary">{convs.length} conversations</Badge>
            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" />{succeeded} done</Badge>
            <Badge variant="secondary" className="gap-1"><XCircle className="w-3 h-3 text-destructive" />{failed} failed</Badge>
          </div>
        </div>

        <Tabs defaultValue="history">
          <TabsList>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="space-y-4">
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Conversations</h3>
              {convs.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">No conversations yet.</Card>
              ) : (
                <div className="space-y-2">
                  {convs.map((c) => (
                    <Link key={c.id} to="/chat" className="block">
                      <Card className="p-3 hover:border-primary/40 transition-colors flex items-center gap-3">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{c.title}</div>
                          <div className="text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleString()}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{c.model.split("/").pop()}</Badge>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Task runs</h3>
              {tasks.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">No task runs yet.</Card>
              ) : (
                <div className="space-y-2">
                  {tasks.map((t) => <TaskRow key={t.id} t={t} />)}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="files">
            <Card className="p-10 text-center">
              <FileCode className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <div className="text-sm font-medium">No files yet</div>
              <p className="text-xs text-muted-foreground mt-1">Generated Luau scripts and exports will appear here.</p>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function TaskRow({ t }: { t: Task }) {
  const [open, setOpen] = useState(false);
  const statusColor = t.status === "done" ? "text-emerald-500" : t.status === "failed" ? "text-destructive" : "text-muted-foreground";
  return (
    <Card className="p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 text-left">
        <Clock className={`w-4 h-4 ${statusColor}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{t.title}</div>
          <div className="text-xs text-muted-foreground">{t.tool}{t.duration_ms ? ` · ${t.duration_ms}ms` : ""} · {new Date(t.created_at).toLocaleString()}</div>
        </div>
        <Badge variant="outline" className={`text-[10px] ${statusColor}`}>{t.status}</Badge>
      </button>
      {open && t.output && (
        <pre className="mt-3 text-[11px] bg-background/60 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap">{t.output}</pre>
      )}
    </Card>
  );
}