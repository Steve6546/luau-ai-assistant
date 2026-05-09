
# Project Audit & Reorganization Plan
**Roblox Studio MCP Bridge Platform**

## Part 1 — Audit (what's currently in the project)

### What works well
- **Database layer (Supabase)** is solid: `conversations`, `messages`, `tasks`, `snapshots`, `studio_logs`, `audit_logs`, `projects` — all with correct RLS scoped via `conversations.user_id`. Snapshots use gzip+base64 for >32KB payloads (`src/lib/compress.ts`).
- **Auth** is wired through `AuthProvider` + `RequireAuth` and the chat/settings/projects routes are protected.
- **Settings page** (`src/routes/settings.tsx`) is well-built: bridge URL/token/policy inputs, Ping / Deep Health / Tool Registry buttons, auto-refresh every 30s, results table.
- **Status bar** (`src/components/StatusBar.tsx`) parses health envelopes correctly and shows bridge/studio/tools/latency.
- **Task executor** (`src/lib/use-task-executor.ts`) implements the full pipeline: snapshot → run → watch_console → auto-fix loop (3 attempts) → audit log → undo from snapshot.
- **Diff approval** (`ScriptDiffViewer` + `awaiting_approval` status) blocks `multi_edit` until the user clicks Apply.
- **Plan parsing** (`parse-tasks.ts`) uses Zod and tolerates either fenced JSON or raw `task_plan` blocks.
- **Mode context** (`ChatModeContext`) persists `plan` / `agent` / `auto_safe` to localStorage with cross-tab sync.

### Critical issues found

1. **Two parallel bridge clients that don't talk to each other.**
   - `src/lib/bridge.ts` — legacy client, default `wss://unquested-marline-nonrurally.ngrok-free.dev`, used by `chat.tsx`, `use-task-executor.ts`, `projects.$id.tsx`.
   - `src/services/bridgeClient.ts` — new Protocol 0.3 client, default `ws://127.0.0.1:8765`, used by `StatusBar` and `settings.tsx` only.
   - Result: the StatusBar shows "Connected" against one URL while the chat tries to dispatch tools against a completely different URL. Saving the URL in Settings calls **both** clients but they can't agree on protocol shape.

2. **Default bridge URL is wrong.** Legacy still hardcodes the old ngrok URL; the user's current bridge endpoint is `ws://127.0.0.1:8765`. Until both clients agree on this, the chat says "Bridge not connected" even when the StatusBar is green.

3. **Mode selector is not mounted.** `ModeSelector` exists but is never rendered. The mode in localStorage has zero effect on what the chat does — `plan` mode currently still executes tasks, `auto_safe` doesn't auto-approve reads, etc.

4. **System prompt lists generic MCP tool names**, not the actual Roblox Studio tools the user pasted. The current 20-tool allowlist (`MCP_TOOL_ALLOWLIST`) is missing important tools like `script_grep`, `script_search`, `get_console_output`, `set_active_studio`, `character_navigation`, `search_creator_store`, `insert_from_creator_store`, `generate_mesh`, `generate_material`, `store_image`, `user_keyboard_input`, `user_mouse_input`, `inspect_instance` (present), `subagent`, `from_history`. Several tools currently in the allowlist (`set_property`, `insert_instance`, `delete_instance`, `rename_instance`, `move_instance`, `get_hierarchy`, `get_scripts`) are not in the user's actual 21-tool list.

5. **Duplicate connection indicators.** The chat header has its own `BridgeIndicator` (legacy bridge) AND the bottom `StatusBar` (new client). Two dots, two states.

6. **System prompt is stale.** Edge function's `SYSTEM_PROMPT` doesn't know about the mode (plan vs agent vs auto_safe), doesn't know about the actual 21 Roblox tools, and doesn't know about the connected Studio context (active studio name, available tools from the registry).

7. **`READ_ONLY_TOOLS` set is half-correct** — `script_read`, `inspect_instance`, `screen_capture` are correct, but `run_code` (currently in `WRITE_TOOLS`) is fine while `execute_luau` should also be classified as write since it mutates Studio state.

---

## Part 2 — Plan (what I'll do, in order)

### Step 1 — Single source of truth for the bridge
- Promote `src/services/bridgeClient.ts` to the **only** bridge.
- Migrate `chat.tsx`, `use-task-executor.ts`, `projects.$id.tsx` from `useBridge()`/`bridge.send()` → `bridgeClient.callTool()` / `bridgeClient.subscribe*()`.
- Delete `src/lib/bridge.ts` after migration.
- Remove duplicate `BridgeIndicator` from chat header — keep only `StatusBar`.
- Default URL becomes `ws://127.0.0.1:8765` everywhere; settings already point here.

### Step 2 — Update the 21-tool allowlist
Replace `MCP_TOOL_ALLOWLIST` with the user's exact 21 Roblox Studio tools:

```
character_navigation, search_game_tree, script_search, script_read,
search_creator_store, subagent, multi_edit, execute_luau, screen_capture,
get_console_output, script_grep, user_keyboard_input, start_stop_play,
generate_material, user_mouse_input, generate_mesh, insert_from_creator_store,
store_image, inspect_instance, from_history, list_roblox_studios, set_active_studio
```

(That's actually 22 tool names; I'll match the canonical list the user provided.)

Also retain the bridge-meta tools (`snapshot`, `batch_execute`, `watch_console`, `studio_log`, `ping`, `health_deep`, `get_tool_registry`) as **infrastructure tools** the executor uses internally — these aren't shown to the AI but are allowed to dispatch.

Reclassify:
- **READ_ONLY** (auto-approve, no snapshot): `script_read`, `script_search`, `script_grep`, `search_game_tree`, `inspect_instance`, `screen_capture`, `get_console_output`, `list_roblox_studios`, `from_history`, `search_creator_store`, `store_image`.
- **WRITE** (snapshot before, diff approval if `multi_edit`): `multi_edit`, `execute_luau`, `start_stop_play`, `insert_from_creator_store`, `generate_material`, `generate_mesh`, `character_navigation`, `set_active_studio`, `user_keyboard_input`, `user_mouse_input`.
- **Subagent** is dispatched but treated as a long-running task (60s+ timeout, no snapshot).

### Step 3 — Wire ModeSelector into the chat input
Mount `<ModeSelector />` in the chat input bar (next to the model picker). Use `useChatMode()` inside `chat.tsx` and `use-task-executor.ts`:

| Mode      | Behavior                                                                                       |
|-----------|------------------------------------------------------------------------------------------------|
| `plan`    | AI may emit a `task_plan` but the executor never auto-runs and write tools are disabled.       |
| `agent`   | Read-only tools auto-run; write tools require diff approval (current behavior). **Default.**   |
| `auto_safe` | Same as `agent` but reads run without even appearing in the task panel; only writes are shown. |

### Step 4 — Refresh the system prompt
Update `supabase/functions/chat/index.ts`:
- Inject the **actual 21 Roblox tools** with one-line descriptions.
- Inject the current `mode` (sent from frontend) so the model knows whether to plan vs execute.
- Inject `bridge_connected` and `studio_name` (sent from frontend after `health_deep`) so the model can warn when Studio is offline.
- Make the system prompt explicit: read tools auto-run, `multi_edit` requires a diff, snapshots are taken before writes, console errors trigger an auto-fix loop (max 3 attempts).

### Step 5 — Pass mode + studio context from chat → edge function
Extend the `/functions/v1/chat` POST body with `{ mode, studioName, bridgeConnected }`. The edge function uses these to specialize the system prompt.

### Step 6 — Documentation file
Create `docs/ARCHITECTURE.md` covering:
- High-level diagram (chat ↔ bridgeClient ↔ WebSocket bridge ↔ Roblox Studio; chat ↔ Supabase for persistence; chat ↔ AI Gateway via edge function).
- Each table's purpose and RLS rule.
- Each chat mode's behavior matrix.
- The 21-tool catalog and which are read vs write vs infra.
- The task lifecycle: parse → snapshot → approve (if write) → execute → watch_console → auto-fix → audit/log → undo.
- Bridge protocol envelope (Protocol 0.3) reference.
- Settings page tour.
- Known limits (snapshot size, retry count, tool timeout).

### Step 7 — Quality gates before finishing
- Build passes.
- Settings page can save a new URL and the chat sees the change without a page reload.
- A read-only task (e.g. `inspect_instance`) auto-runs in `agent` mode.
- A `multi_edit` task shows the diff and only executes after Apply.
- Plan mode hides the Run button and disables tool dispatch.
- StatusBar and chat both reflect the same connection state.

---

## Part 3 — Out of scope for this round
- Migrating from edge function to TanStack `createServerFn` (would change the streaming contract — defer).
- Adding new MCP tools that the bridge doesn't implement yet (we only allowlist; the bridge must actually expose them).
- Multi-Studio session switching UI (`set_active_studio` will be allowlisted but no UI yet).

---

## Technical notes

- The legacy `bridge.ts` removal must happen in the **same patch** as the chat/executor/projects migration — they all import from it; partial migration breaks the build.
- The new `bridgeClient` returns Protocol 0.3 envelopes (`{ status, output, error_code, durationMs, ... }`); the executor currently reads `res.error`, `res.output ?? res.result`, `res.durationMs` — adapter logic is straightforward but needs to be applied to every call site.
- Mode propagation: I'll add `mode` to the executor hook signature so `plan` mode short-circuits `prepare()`/`execute()` without breaking the existing approval flow.
- No DB migration is needed — all the tables already exist.
