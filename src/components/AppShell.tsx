import { ReactNode, useEffect } from "react";
import { useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);
  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  return <>{children}</>;
}

export function TopNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = [
    { to: "/chat", label: "Chat" },
    { to: "/projects", label: "Projects" },
    { to: "/settings", label: "Settings" },
  ] as const;
  return (
    <nav className="flex items-center gap-1">
      {items.map((it) => (
        <Link key={it.to} to={it.to}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${path.startsWith(it.to) ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-card/60"}`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}