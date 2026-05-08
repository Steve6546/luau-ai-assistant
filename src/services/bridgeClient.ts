/**
 * Central Bridge Client (Protocol 0.3)
 *
 * Single shared service for ALL communication with the Roblox Studio MCP bridge.
 * No other module should open a WebSocket to the bridge directly.
 *
 * Storage keys:
 *   - bridge_url   (default: ws://127.0.0.1:8765)
 *   - bridge_token (appended as ?token=… query param)
 *
 * Envelope (every response):
 *   { protocolVersion, bridgeVersion, requestId, status, output,
 *     error_code, error, durationMs, timestamp }
 *
 * Push events (no requestId): { type: "studio_log" | "heartbeat", ... }
 */

export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8765";
export const REQUEST_TIMEOUT_MS = 30_000;
export const RECONNECT_INTERVAL_MS = 5_000;

export interface BridgeEnvelope<T = unknown> {
  protocolVersion: string;
  bridgeVersion: string;
  requestId: string;
  status: "success" | "error";
  output: T;
  error_code: string | null;
  error: string | null;
  durationMs: number;
  timestamp: number;
}

export interface StudioLogEvent {
  type: "studio_log";
  level?: "info" | "warn" | "error" | "output" | string;
  message?: string;
  source?: string;
  timestamp?: number;
  [k: string]: unknown;
}

export interface HeartbeatEvent {
  type: "heartbeat";
  studio?: string;
  mcp?: string;
  timestamp?: number;
  [k: string]: unknown;
}

export type BridgeLifecycleEvent =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "reconnected";

type LifecycleListener = (ev: BridgeLifecycleEvent) => void;
type StudioLogListener = (ev: StudioLogEvent) => void;
type HeartbeatListener = (ev: HeartbeatEvent) => void;

interface PendingRequest {
  resolve: (env: BridgeEnvelope) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Bridge token invalid. Update in Settings.",
  studio_unavailable:
    "Roblox Studio not connected. Open Studio and enable MCP.",
  mcp_unavailable: "Bridge running but MCP not ready.",
  approval_required: "This action needs approval.",
  tool_not_found: "Tool not available in current Studio session.",
  timeout: "Request timed out after 30 seconds.",
};

/** Translate an envelope's `error_code` (or fallback `error`) into a user-facing message. */
export function mapBridgeError(env: Partial<BridgeEnvelope>): string {
  const code = env.error_code ?? "";
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return env.error || "Unknown bridge error";
}

function getStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function buildUrl(): string {
  const base = getStorage("bridge_url") || DEFAULT_BRIDGE_URL;
  const token = getStorage("bridge_token");
  if (!token) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

function genRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

class BridgeClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private studioLogListeners = new Set<StudioLogListener>();
  private heartbeatListeners = new Set<HeartbeatListener>();
  private lifecycleListeners = new Set<LifecycleListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private manualClose = false;
  private hasConnectedOnce = false;

  /** Connect (or return the in-flight connection promise). */
  connect(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.manualClose = false;
    this.emitLifecycle(this.hasConnectedOnce ? "reconnecting" : "connecting");

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(buildUrl());
      } catch (e) {
        this.connectPromise = null;
        this.scheduleReconnect();
        reject(e as Error);
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.connectPromise = null;
        if (this.hasConnectedOnce) this.emitLifecycle("reconnected");
        else this.emitLifecycle("connected");
        this.hasConnectedOnce = true;
        resolve();
      };

      ws.onmessage = (msg) => this.handleMessage(msg.data);

      ws.onerror = () => {
        // surfaced via onclose
      };

      ws.onclose = () => {
        this.connectPromise = null;
        this.failAllPending(new Error("Bridge connection closed"));
        this.ws = null;
        this.emitLifecycle("disconnected");
        if (!this.manualClose) this.scheduleReconnect();
      };
    });

    return this.connectPromise;
  }

  /** Close and stop auto-reconnecting. */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.failAllPending(new Error("Bridge disconnected"));
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Low-level send. Resolves with the matching envelope. */
  send<T = unknown>(
    tool: string,
    extraFields: Record<string, unknown> = {},
  ): Promise<BridgeEnvelope<T>> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected() || !this.ws) {
        reject(new Error("Bridge not connected"));
        return;
      }
      const requestId = genRequestId();
      const payload = { requestId, tool, ...extraFields };

      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(ERROR_MESSAGES.timeout));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: resolve as (env: BridgeEnvelope) => void,
        reject,
        timer,
      });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(e as Error);
      }
    });
  }

  callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<BridgeEnvelope<T>> {
    return this.send<T>("call_tool", { name, arguments: args });
  }

  ping<T = unknown>(): Promise<BridgeEnvelope<T>> {
    return this.send<T>("ping");
  }

  healthDeep<T = unknown>(): Promise<BridgeEnvelope<T>> {
    return this.send<T>("health_deep");
  }

  getToolRegistry<T = unknown>(): Promise<BridgeEnvelope<T>> {
    return this.send<T>("get_tool_registry");
  }

  subscribeStudioLog(cb: StudioLogListener): () => void {
    this.studioLogListeners.add(cb);
    return () => this.studioLogListeners.delete(cb);
  }

  subscribeHeartbeat(cb: HeartbeatListener): () => void {
    this.heartbeatListeners.add(cb);
    return () => this.heartbeatListeners.delete(cb);
  }

  subscribeLifecycle(cb: LifecycleListener): () => void {
    this.lifecycleListeners.add(cb);
    return () => this.lifecycleListeners.delete(cb);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private handleMessage(raw: unknown) {
    let data: Record<string, unknown>;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
    } catch {
      return;
    }

    const requestId = data.requestId as string | undefined;
    if (requestId && this.pending.has(requestId)) {
      const pending = this.pending.get(requestId)!;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.resolve(this.normalizeEnvelope(data));
      return;
    }

    // Push event
    const type = data.type as string | undefined;
    if (type === "studio_log") {
      this.studioLogListeners.forEach((l) => {
        try {
          l(data as StudioLogEvent);
        } catch {
          /* ignore listener errors */
        }
      });
    } else if (type === "heartbeat") {
      this.heartbeatListeners.forEach((l) => {
        try {
          l(data as HeartbeatEvent);
        } catch {
          /* ignore listener errors */
        }
      });
    }
  }

  private normalizeEnvelope(data: Record<string, unknown>): BridgeEnvelope {
    return {
      protocolVersion: (data.protocolVersion as string) ?? "0.3",
      bridgeVersion: (data.bridgeVersion as string) ?? "",
      requestId: (data.requestId as string) ?? "",
      status: (data.status as "success" | "error") ?? "error",
      output: data.output,
      error_code: (data.error_code as string | null) ?? null,
      error: (data.error as string | null) ?? null,
      durationMs: (data.durationMs as number) ?? 0,
      timestamp: (data.timestamp as number) ?? Date.now(),
    };
  }

  private failAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.manualClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        /* scheduleReconnect runs again from onclose */
      });
    }, RECONNECT_INTERVAL_MS);
  }

  private emitLifecycle(ev: BridgeLifecycleEvent) {
    this.lifecycleListeners.forEach((l) => {
      try {
        l(ev);
      } catch {
        /* ignore */
      }
    });
  }
}

export const bridgeClient = new BridgeClient();
