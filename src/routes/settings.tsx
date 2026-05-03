import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RequireAuth, TopNav } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBridge, getBridgeUrl, setBridgeUrl, DEFAULT_BRIDGE_URL, MCP_TOOL_ALLOWLIST } from "@/lib/bridge";
import { toast } from "sonner";
import { RefreshCw, Wifi } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: () => <RequireAuth><SettingsPage /></RequireAuth>,
});

function SettingsPage() {
  const bridge = useBridge();
  const [url, setUrl] = useState(getBridgeUrl());

  const statusColor = bridge.status === "connected" ? "bg-emerald-500" : bridge.status === "reconnecting" ? "bg-amber-500" : "bg-red-500";

  function save() {
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      toast.error("URL must start with ws:// or wss://");
      return;
    }
    setBridgeUrl(url);
    toast.success("Bridge URL saved. Reconnecting…");
  }

  function reset() {
    setUrl(DEFAULT_BRIDGE_URL);
    setBridgeUrl(DEFAULT_BRIDGE_URL);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 border-b border-border flex items-center px-4 gap-3">
        <div className="font-semibold text-sm">Settings</div>
        <div className="flex-1" />
        <TopNav />
      </header>
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure the Roblox MCP bridge connection.</p>
        </div>

        <Card className="p-5 space-y-4 bg-card border-border">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            <h2 className="font-medium">MCP Bridge</h2>
            <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              {bridge.status}{bridge.latency != null && bridge.status === "connected" ? ` · ${bridge.latency}ms` : ""}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">WebSocket URL</label>
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="wss://…" className="font-mono text-xs" />
              <Button onClick={save}>Save</Button>
              <Button variant="outline" onClick={reset}>Reset</Button>
              <Button variant="outline" size="icon" onClick={() => bridge.reconnect()} title="Reconnect">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Run the MCP bridge locally and tunnel via Cloudflare. The app sends a heartbeat ping every 5s and auto-reconnects with exponential backoff.
            </p>
          </div>
        </Card>

        <Card className="p-5 space-y-3 bg-card border-border">
          <h2 className="font-medium">Allowed MCP tools</h2>
          <p className="text-xs text-muted-foreground">Only these tools may be invoked through <code>call_tool</code>. Plans referencing other tools are rejected before execution.</p>
          <div className="flex flex-wrap gap-2">
            {MCP_TOOL_ALLOWLIST.map((t) => (
              <Badge key={t} variant="secondary" className="font-mono text-[11px]">{t}</Badge>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}