import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { RequireAuth, TopNav } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Folder, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/projects")({
  component: () => <RequireAuth><ProjectsPage /></RequireAuth>,
});

interface Project { id: string; name: string; description: string | null; created_at: string; }

function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (data) setProjects(data as Project[]);
      const { data: convData } = await supabase.from("conversations").select("id, project_id");
      const map: Record<string, number> = {};
      (convData || []).forEach((c: any) => { if (c.project_id) map[c.project_id] = (map[c.project_id] || 0) + 1; });
      setCounts(map);
    })();
  }, [user]);

  async function create() {
    if (!name.trim() || !user) return;
    const { data, error } = await supabase.from("projects").insert({ user_id: user.id, name, description: desc }).select().single();
    if (error) { toast.error(error.message); return; }
    setProjects((p) => [data as Project, ...p]);
    setOpen(false); setName(""); setDesc("");
  }

  async function remove(id: string) {
    await supabase.from("projects").delete().eq("id", id);
    setProjects((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 border-b border-border flex items-center px-4 gap-3">
        <div className="font-semibold text-sm">Projects</div>
        <div className="flex-1" />
        <TopNav />
      </header>
      <main className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Your projects</h1>
            <p className="text-sm text-muted-foreground">Group conversations and tasks per Roblox project.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> New project</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
                <Textarea placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">No projects yet. Create one to get started.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Card key={p.id} className="p-4 bg-card border-border hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Folder className="w-5 h-5 text-primary" />
                  </div>
                  <Link to="/projects/$id" params={{ id: p.id }} className="flex-1 min-w-0">
                    <div className="font-medium truncate hover:text-primary">{p.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description || "No description"}</div>
                    <div className="text-xs text-muted-foreground mt-2">{counts[p.id] || 0} conversations</div>
                  </Link>
                  <button onClick={() => remove(p.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}