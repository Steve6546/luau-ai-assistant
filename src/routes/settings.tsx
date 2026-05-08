import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, Server, Wifi, XCircle } from "lucide-react";
import { toast } from "sonner";

import { RequireAuth, TopNav } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setBridgeUrl } from "@/lib/bridge";
import { bridgeClient, mapBridgeError, type BridgeEnvelope } from "@/services/bridgeClient";

export const Route = createFileRoute("/settings")({
  component: () => (
    <RequireAuth>
      <SettingsPage />
    </RequireAuth>
  ),
});

const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8765";
const POLICY_OPTIONS = ["permissive", "guided", "strict"] as const;
type Policy = (typeof POLICY_OPTIONS)[number];
const DEFAULT_POLICY: Policy = "guided";

function readLocal(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable (private mode, quota); non-fatal */
  }
}

function isPolicy(value: string): value is Policy {
  return (POLICY_OPTIONS as readonly string[]).includes(value);
}

interface DeepHealth {
  bridge?: string;
  mcp?: string;
  studio?: string;
  studio_name?: string;
  tools?: number | unknown[];
  latency_ms?: number;
  status?: "ok" | "degraded" | "down" | string;
}

interface ToolRow {
  name: string;
  source?: string;
  category?: string;
  approval?: boolean;
  snapshot?: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseDeepHealth(env: BridgeEnvelope<unknown>): DeepHealth {
  const out = isObject(env.output) ? env.output : {};
  return {
    bridge: typeof out.bridge === "string" ? out.bridge : undefined,
    mcp: typeof out.mcp === "string" ? out.mcp : undefined,
    studio: typeof out.studio === "string" ? out.studio : undefined,
    studio_name: typeof out.studio_name === "string" ? out.studio_name : undefined,
    tools:
      typeof out.tools === "number" || Array.isArray(out.tools)
        ? (out.tools as number | unknown[])
        : undefined,
    latency_ms: typeof out.latency_ms === "number" ? out.latency_ms : env.durationMs,
    status: typeof out.status === "string" ? (out.status as DeepHealth["status"]) : undefined,
  };
}

function parseToolRows(env: BridgeEnvelope<unknown>): ToolRow[] {
  const raw: unknown =
    isObject(env.output) && Array.isArray(env.output.tools) ? env.output.tools : env.output;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((t) => ({
      name: typeof t.name === "string" ? t.name : "",
      source: typeof t.source === "string" ? t.source : undefined,
      category: typeof t.category === "string" ? t.category : undefined,
      approval: typeof t.approval === "boolean" ? t.approval : undefined,
      snapshot: typeof t.snapshot === "boolean" ? t.snapshot : undefined,
    }))
    .filter((t) => t.name.length > 0);
}

function toolsCountLabel(tools: DeepHealth["tools"]): string {
  if (typeof tools === "number") return `Loaded (${tools})`;
  if (Array.isArray(tools)) return `Loaded (${tools.length})`;
  return "Unknown";
}

function statusOk(value: string | undefined, okSet: readonly string[]): boolean {
  if (!value) return false;
  return okSet.includes(value.toLowerCase());
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
  ) : (
    <XCircle className="w-4 h-4 text-red-500" />
  );
}

function OverallStatusBadge({ status }: { status: DeepHealth["status"] }) {
  const value = (status ?? "").toLowerCase();
  if (value === "ok") {
    return <Badge className="bg-emerald-500/15 text-emerald-500">ok</Badge>;
  }
  if (value === "degraded") {
    return <Badge className="bg-amber-500/15 text-amber-500">degraded</Badge>;
  }
  if (value === "down") {
    return <Badge className="bg-red-500/15 text-red-500">down</Badge>;
  }
  return <Badge variant="secondary">unknown</Badge>;
}

function HealthRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {icon}
        <span>{value}</span>
      </span>
    </div>
  );
}

function HealthCard({ data }: { data: DeepHealth }) {
  const bridgeOk = statusOk(data.bridge, ["online", "ok", "ready"]);
  const mcpOk = statusOk(data.mcp, ["ready", "ok", "online"]);
  const studioOk = statusOk(data.studio, ["connected", "ok", "online"]);
  const toolsLoaded =
    typeof data.tools === "number"
      ? data.tools > 0
      : Array.isArray(data.tools)
        ? data.tools.length > 0
        : false;
  const studioName = data.studio_name ?? "—";
  const latency = typeof data.latency_ms === "number" ? `${data.latency_ms}ms` : "—";

  return (
    <Card className="p-4 bg-card border-border font-mono text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Status</span>
        <OverallStatusBadge status={data.status} />
      </div>
      <HealthRow label="Bridge" value={data.bridge ?? "—"} icon={<StatusIcon ok={bridgeOk} />} />
      <HealthRow label="MCP" value={data.mcp ?? "—"} icon={<StatusIcon ok={mcpOk} />} />
      <HealthRow label="Studio" value={data.studio ?? "—"} icon={<StatusIcon ok={studioOk} />} />
      <HealthRow
        label="Tools"
        value={toolsCountLabel(data.tools)}
        icon={<StatusIcon ok={toolsLoaded} />}
      />
      <HealthRow label="Latency" value={latency} />
      <HealthRow label="Studio Name" value={studioName} />
    </Card>
  );
}

function SettingsPage() {
  const [url, setUrl] = useState(() => readLocal("bridge_url", DEFAULT_BRIDGE_URL));
  const [token, setToken] = useState(() => readLocal("bridge_token"));
  const [policy, setPolicy] = useState<Policy>(() => {
    const stored = readLocal("bridge_policy", DEFAULT_POLICY);
    return isPolicy(stored) ? stored : DEFAULT_POLICY;
  });

  const [pingResult, setPingResult] = useState<string | null>(null);
  const [healthResult, setHealthResult] = useState<DeepHealth | null>(null);
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<number | null>(null);
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [busy, setBusy] = useState<"" | "ping" | "health" | "registry">("");

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bridgeClient.connect().catch(() => {
      /* surfaced via lifecycle; no UI noise on mount */
    });
    refreshTimer.current = setInterval(() => {
      void runDeepHealth(true);
    }, 30_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  function applyConnectionChange(nextUrl: string) {
    // Keep the legacy bridge in sync so chat / projects / sidebar continue
    // to work until they are migrated to bridgeClient in a later phase.
    try {
      setBridgeUrl(nextUrl);
    } catch {
      /* legacy bridge will retry via its own auto-reconnect */
    }
    try {
      bridgeClient.disconnect();
      bridgeClient.connect().catch(() => {
        /* auto-reconnect will retry */
      });
    } catch {
      /* defensive: never throw from settings actions */
    }
  }

  function save() {
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      toast.error("URL must start with ws:// or wss://");
      return;
    }
    writeLocal("bridge_url", url);
    writeLocal("bridge_token", token);
    writeLocal("bridge_policy", policy);
    applyConnectionChange(url);
    toast.success("Settings saved. Reconnecting…");
  }

  function reset() {
    setUrl(DEFAULT_BRIDGE_URL);
    setToken("");
    setPolicy(DEFAULT_POLICY);
    writeLocal("bridge_url", DEFAULT_BRIDGE_URL);
    writeLocal("bridge_token", "");
    writeLocal("bridge_policy", DEFAULT_POLICY);
    applyConnectionChange(DEFAULT_BRIDGE_URL);
    toast.message("Reset to defaults");
  }

  async function runPing() {
    setBusy("ping");
    setPingResult(null);
    try {
      if (!bridgeClient.isConnected()) await bridgeClient.connect();
      const env = await bridgeClient.ping();
      if (env.status === "success") {
        setPingResult(`✅ Bridge online — ${env.durationMs}ms`);
      } else {
        setPingResult(`❌ ${mapBridgeError(env)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bridge offline";
      setPingResult(`❌ ${msg}`);
    } finally {
      setBusy("");
    }
  }

  async function runDeepHealth(silent = false) {
    if (!silent) setBusy("health");
    try {
      if (!bridgeClient.isConnected()) await bridgeClient.connect();
      const env = await bridgeClient.healthDeep();
      if (env.status !== "success") {
        if (!silent) toast.error(mapBridgeError(env));
        return;
      }
      setHealthResult(parseDeepHealth(env));
      setHealthUpdatedAt(Date.now());
    } catch (e) {
      if (!silent) {
        toast.error(e instanceof Error ? e.message : "Health check failed");
      }
    } finally {
      if (!silent) setBusy("");
    }
  }

  async function runRegistry() {
    setBusy("registry");
    try {
      if (!bridgeClient.isConnected()) await bridgeClient.connect();
      const env = await bridgeClient.getToolRegistry();
      if (env.status !== "success") {
        toast.error(mapBridgeError(env));
        setTools([]);
        return;
      }
      setTools(parseToolRows(env));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tool registry failed");
    } finally {
      setBusy("");
    }
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
          <p className="text-sm text-muted-foreground">
            Configure the Roblox MCP bridge connection and run live diagnostics.
          </p>
        </div>

        {/* SECTION 1 — Bridge Connection */}
        <Card className="p-5 space-y-4 bg-card border-border">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Bridge Connection</h2>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="bridge-url">
              Bridge URL
            </label>
            <Input
              id="bridge-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={DEFAULT_BRIDGE_URL}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="bridge-token">
              Bridge Token
            </label>
            <Input
              id="bridge-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="••••••••"
              autoComplete="off"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="bridge-policy">
              Policy Mode
            </label>
            <Select
              value={policy}
              onValueChange={(v) => {
                if (isPolicy(v)) setPolicy(v);
              }}
            >
              <SelectTrigger id="bridge-policy" className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save}>Save Settings</Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Reset to Default
            </Button>
          </div>
        </Card>

        {/* SECTION 2 — Connection Tests */}
        <Card className="p-5 space-y-4 bg-card border-border">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Connection Tests</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runPing} disabled={busy === "ping"} variant="outline">
              {busy === "ping" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Test Ping
            </Button>
            <Button
              onClick={() => runDeepHealth(false)}
              disabled={busy === "health"}
              variant="outline"
            >
              {busy === "health" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Test Deep Health
            </Button>
            <Button onClick={runRegistry} disabled={busy === "registry"} variant="outline">
              {busy === "registry" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Test Tool Registry
            </Button>
          </div>

          {pingResult && (
            <div className="text-xs font-mono text-muted-foreground">{pingResult}</div>
          )}

          {healthResult && <HealthCard data={healthResult} />}

          {tools && (
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Snapshot</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No tools returned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    tools.map((t) => (
                      <TableRow key={t.name}>
                        <TableCell className="font-mono text-xs">{t.name}</TableCell>
                        <TableCell className="text-xs">{t.source ?? "—"}</TableCell>
                        <TableCell className="text-xs">{t.category ?? "—"}</TableCell>
                        <TableCell>
                          {t.approval == null ? "—" : <StatusIcon ok={t.approval} />}
                        </TableCell>
                        <TableCell>
                          {t.snapshot == null ? "—" : <StatusIcon ok={t.snapshot} />}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* SECTION 3 — Last Health Status */}
        <Card className="p-5 space-y-3 bg-card border-border">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h2 className="font-medium">Last Health Status</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">
              Auto-refresh every 30s
            </span>
          </div>
          {healthResult ? (
            <>
              <HealthCard data={healthResult} />
              <p className="text-[11px] text-muted-foreground">
                Updated {healthUpdatedAt ? new Date(healthUpdatedAt).toLocaleTimeString() : "—"}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No health data yet. Run “Test Deep Health” to populate this section.
            </p>
          )}
        </Card>
      </main>
    </div>
  );
}
