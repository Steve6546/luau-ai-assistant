/**
 * MCP tool catalog for the Roblox Studio bridge.
 *
 * - PUBLIC_MCP_TOOLS: the 21 Roblox Studio tools shown to the AI in the
 *   system prompt and dispatchable through `call_tool`.
 * - INFRA_TOOLS: bridge-side helpers used by the executor (snapshots, batch
 *   execution, health, etc.). Not advertised to the AI.
 * - READ_ONLY_TOOLS: auto-approve, never trigger snapshots.
 * - WRITE_TOOLS: snapshot before, may require diff approval (`multi_edit`).
 */

export const PUBLIC_MCP_TOOLS = [
  "character_navigation",
  "search_game_tree",
  "script_search",
  "script_read",
  "search_creator_store",
  "subagent",
  "multi_edit",
  "execute_luau",
  "screen_capture",
  "get_console_output",
  "script_grep",
  "user_keyboard_input",
  "start_stop_play",
  "generate_material",
  "user_mouse_input",
  "generate_mesh",
  "insert_from_creator_store",
  "store_image",
  "inspect_instance",
  "from_history",
  "list_roblox_studios",
  "set_active_studio",
] as const;

/** Bridge infrastructure tools the executor uses internally. */
export const INFRA_TOOLS = [
  "snapshot",
  "batch_execute",
  "watch_console",
  "studio_log",
  "ping",
  "health_deep",
  "get_tool_registry",
  "run_code",
] as const;

export const MCP_TOOL_ALLOWLIST = [
  ...PUBLIC_MCP_TOOLS,
  ...INFRA_TOOLS,
] as const;
export type McpTool = (typeof MCP_TOOL_ALLOWLIST)[number];

export function isAllowedTool(name: string): name is McpTool {
  return (MCP_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

/** Tools that never mutate Studio state — auto-approved with no snapshot. */
export const READ_ONLY_TOOLS = new Set<string>([
  "script_read",
  "script_search",
  "script_grep",
  "search_game_tree",
  "inspect_instance",
  "screen_capture",
  "get_console_output",
  "list_roblox_studios",
  "from_history",
  "search_creator_store",
  "store_image",
  "studio_log",
  "ping",
  "health_deep",
  "get_tool_registry",
]);

/** Tools that mutate Studio state — snapshot taken before they run. */
export const WRITE_TOOLS = new Set<string>([
  "multi_edit",
  "execute_luau",
  "run_code",
  "start_stop_play",
  "insert_from_creator_store",
  "generate_material",
  "generate_mesh",
  "character_navigation",
  "set_active_studio",
  "user_keyboard_input",
  "user_mouse_input",
]);

/** Subset of write tools used in the post-write self-test loop. */
export const TEST_TOOLS = new Set<string>([
  "execute_luau",
  "run_code",
  "multi_edit",
]);

/** One-line descriptions for the AI system prompt. */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  character_navigation: "Navigate the player character to a position or instance.",
  search_game_tree: "Explore the DataModel hierarchy with optional filters.",
  script_search: "Fuzzy search for scripts by name (max 10 results).",
  script_read: "Read full script source by dot-notation path.",
  search_creator_store: "Search the Roblox Creator Store; returns searchId for insertion.",
  subagent: "Launch a specialized sub-agent (e.g. 'explore') for autonomous investigation.",
  multi_edit: "Apply multiple edits to a script in one atomic operation; can also create new scripts. Requires user approval of a diff.",
  execute_luau: "Execute Luau code in Studio; returns result or error.",
  screen_capture: "Capture the current edit-time viewport as an image.",
  get_console_output: "Read the Studio output log.",
  script_grep: "Regex/text search across all script contents (max 50 matches).",
  user_keyboard_input: "Send keyboard input sequences to the running game.",
  start_stop_play: "Start or stop Play mode.",
  generate_material: "AI-generate a MaterialVariant from a prompt.",
  user_mouse_input: "Send mouse actions (move, click, scroll) to the game.",
  generate_mesh: "AI-generate a textured mesh from a prompt.",
  insert_from_creator_store: "Insert an asset previously located via search_creator_store.",
  store_image: "Upload a local image and get an IMAGEID URI for other tools.",
  inspect_instance: "Get all properties, attributes, and children of one instance.",
  from_history: "Recall content read earlier in the conversation that has scrolled out of context.",
  list_roblox_studios: "List all connected Roblox Studio instances.",
  set_active_studio: "Switch which Studio instance receives subsequent tool calls.",
};
