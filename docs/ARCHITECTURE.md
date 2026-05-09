# Roblox Studio MCP Bridge Platform — Architecture

_Last updated: 2026-05-09_

This document is the source of truth for how the platform is wired together.
Read it before adding features that touch the bridge, the executor, or the
Supabase schema.

---

## 1. High-level diagram

```
┌──────────────┐      ┌─────────────────────┐      ┌───────────────┐
│  Chat UI     │──────│  bridgeClient (WS)  │──────│ Roblox Studio │
│ (chat.tsx)   │      │  Protocol 0.3       │      │   MCP Bridge  │
└──────┬───────┘      └──────────┬──────────┘      └───────────────┘
       │                         │
       │                         │ studio_log / heartbeat (push)
       ▼                         ▼
┌──────────────┐      ┌─────────────────────┐
│ Edge fn      │      │   Task executor     │
│ /chat (LLM)  │      │ (use-task-executor) │
└──────┬───────┘      └──────────┬──────────┘
       │                         │
       └──────────┬──────────────┘
                  ▼
          ┌────────────────┐
          │ Supabase (RLS) │
          │ conversations, │
          │ messages,      │
          │ tasks,         │
          │ snapshots,     │
          │ studio_logs,   │
          │ audit_logs,    │
          │ projects       │
          └────────────────┘
```

---

## 2. Bridge — single source of truth

There is **exactly one** WebSocket to the bridge:
`src/services/bridgeClient.ts`. Everything else either:

- imports `bridgeClient` directly (Settings, StatusBar), **or**
- imports the legacy `src/lib/bridge.ts` API which is now a thin shim
  delegating to the same `bridgeClient` instance.

### Configuration
- `localStorage["bridge_url"]` — default `ws://127.0.0.1:8765`.
- `localStorage["bridge_token"]` — appended as `?token=...` query parameter.
- `localStorage["bridge_policy"]` — `permissive` | `guided` (default) | `strict`.

Settings → "Save Settings" persists these and reconnects atomically.

### Protocol 0.3 envelope

Every response message is shaped:
```json
{
  "protocolVersion": "0.3",
  "bridgeVersion": "1.2.3",
  "requestId": "uuid",
  "status": "success" | "error",
  "output": { ... },
  "error_code": "unauthorized" | "studio_unavailable" | "mcp_unavailable" | "approval_required" | "tool_not_found" | "timeout" | null,
  "error": "human readable" | null,
  "durationMs": 123,
  "timestamp": 1746747000000
}
```

Push frames have `type: "studio_log"` or `type: "heartbeat"` and no
`requestId`. The client routes them to subscribers.

### Reconnect & timeouts
- 30 s per request timeout.
- 5 s reconnect interval after disconnect (no exponential back-off — Studio
  bridge restarts are usually fast).
- Lifecycle events: `connecting` → `connected` → `disconnected` →
  `reconnecting` → `reconnected`.

---

## 3. Tool catalog (`src/lib/mcp-tools.ts`)

The 21 public Roblox tools the AI is allowed to plan against:

| Tool | Class |
|------|-------|
| character_navigation | write |
| search_game_tree | read |
| script_search | read |
| script_read | read |
| search_creator_store | read |
| subagent | special (no snapshot) |
| multi_edit | write — diff approval required |
| execute_luau | write |
| screen_capture | read |
| get_console_output | read |
| script_grep | read |
| user_keyboard_input | write |
| start_stop_play | write |
| generate_material | write |
| user_mouse_input | write |
| generate_mesh | write |
| insert_from_creator_store | write |
| store_image | read |
| inspect_instance | read |
| from_history | read |
| list_roblox_studios | read |
| set_active_studio | write |

Plus internal **infra tools** (not exposed to the AI but allowed to dispatch):
`snapshot`, `batch_execute`, `watch_console`, `studio_log`, `ping`,
`health_deep`, `get_tool_registry`, `run_code`.

---

## 4. Chat modes

The mode lives in `localStorage["chat_mode"]` and is exposed via
`useChatMode()` from `src/contexts/ChatModeContext.tsx`. The
`<ModeSelector />` dropdown in the chat input controls it.

| Mode      | Auto-run reads | Run writes              | AI knows |
|-----------|----------------|-------------------------|----------|
| plan      | ❌             | ❌ (Run-all blocked)    | "Plan only — do not promise execution" |
| **agent** (default) | ✅ | ✅ after diff approval | "Execute with approval" |
| auto_safe | ✅             | ✅ after diff approval | "Reads auto-run; writes still need approval" |

The mode is sent to the edge function as part of the chat POST body so the
LLM specializes its response.

---

## 5. Task lifecycle

```
parse JSON task_plan ──► snapshot (write tools only)
                              │
                              ▼
            multi_edit? ── yes ──► awaiting_approval (ScriptDiffViewer)
                              │
                            no/Apply
                              ▼
                            running ──► call_tool ──► output
                              │
                              ▼
              run_code/execute_luau/multi_edit?
                              │
                            yes ─► watch_console ──► error?
                              │                       │
                              ▼                     yes ─► fixing (LLM patch) ── retry up to 3
                            done                      │
                                                      no
                                                      │
                                                      ▼
                                                    done

                                                    Undo ─► restore_snapshot via run_code
```

State persisted to `tasks` (status, duration_ms, retry_count, snapshot_id,
approved, diff_original, diff_new, script_path, output). Live Studio output
is streamed into per-task `logs` AND mirrored into `studio_logs`. Every
`call_tool` dispatch produces an `audit_logs` row.

---

## 6. Supabase tables (RLS scope)

| Table | Owner | Notes |
|-------|-------|-------|
| `projects` | `user_id` | User's workspace folders |
| `conversations` | `user_id` | One chat thread |
| `messages` | via `conversations.user_id` | role/content/reasoning |
| `tasks` | via conversation | Full lifecycle, diff fields, snapshot ref |
| `snapshots` | via conversation | gzip+base64 if > 32 KB (`src/lib/compress.ts`) |
| `studio_logs` | via conversation | Live console mirror |
| `audit_logs` | `user_id` | Every `call_tool` dispatch |

All write paths in `use-task-executor.ts` are wrapped in `try/catch` with
graceful degradation — losing the audit log never breaks the user's task.

---

## 7. Settings page (`/settings`)

Three cards:
1. **Bridge Connection** — URL, token, policy. Save & Reset.
2. **Connection Tests** — `ping`, `health_deep`, `get_tool_registry`.
3. **Last Health Status** — auto-refresh every 30 s, shows
   bridge/MCP/studio/tools/latency.

The page is the ONLY UI surface that should ever talk to the bridge with
custom URLs — every other module reads `localStorage["bridge_url"]`.

---

## 8. StatusBar (`src/components/StatusBar.tsx`)

Persistent 28 px bar at the bottom. Shows:
- 🟢 / 🟡 / 🔴 Bridge + version
- Studio session name (from heartbeat)
- Tools loaded count
- Latency (last health check)
- AI provider/model + active mode (placeholder slots — wired in a future step)

---

## 9. Limits & constraints

| Concern | Limit |
|---------|-------|
| Bridge request timeout | 30 s |
| Auto-fix attempts after console error | 3 |
| Snapshot compression threshold | 32 KB |
| Per-task in-memory log buffer | 200 entries |
| `task_plan.tasks` max | 50 (Zod validated) |
| Allowlist enforcement | Every `call_tool` checks `MCP_TOOL_ALLOWLIST` |

---

## 10. Known limitations (next phase)

- Multi-Studio session UI for `set_active_studio` not implemented.
- StatusBar mode/provider chips are static placeholders.
- Edge function is still Supabase-hosted; will migrate to TanStack
  `createServerFn` later (changes streaming contract).
- `runAll` batch path is heuristic — only batches `execute_luau`,
  `run_code`, `set_property`, `insert_instance`. Other tool sequences
  fall back to sequential execution.
