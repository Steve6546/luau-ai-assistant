import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOOL_LINES = [
  "character_navigation — Navigate the player character to a position or instance.",
  "search_game_tree — Explore the DataModel hierarchy with optional filters.",
  "script_search — Fuzzy search for scripts by name (max 10 results).",
  "script_read — Read full script source by dot-notation path.",
  "search_creator_store — Search the Roblox Creator Store; returns searchId for insertion.",
  "subagent — Launch a specialized sub-agent (e.g. 'explore') for autonomous investigation.",
  "multi_edit — Atomic multi-edit of a script (also creates new scripts). REQUIRES user diff approval.",
  "execute_luau — Execute Luau code in Studio.",
  "screen_capture — Capture the current viewport as an image.",
  "get_console_output — Read the Studio output log.",
  "script_grep — Regex/text search across all script contents (max 50 matches).",
  "user_keyboard_input — Send keyboard input to the running game.",
  "start_stop_play — Start or stop Play mode.",
  "generate_material — AI-generate a MaterialVariant from a prompt.",
  "user_mouse_input — Send mouse actions to the game.",
  "generate_mesh — AI-generate a textured mesh from a prompt.",
  "insert_from_creator_store — Insert an asset previously located via search_creator_store.",
  "store_image — Upload a local image; returns IMAGEID URI.",
  "inspect_instance — Get all properties/attributes/children of one instance.",
  "from_history — Recall content read earlier that scrolled out of context.",
  "list_roblox_studios — List all connected Roblox Studio instances.",
  "set_active_studio — Switch which Studio receives subsequent tool calls.",
];

function buildSystemPrompt(mode: string, bridgeConnected: boolean, studioName?: string) {
  const modeBlock =
    mode === "plan"
      ? `MODE: PLAN — You may design a task_plan but the user has DISABLED execution. Explain steps; do NOT promise the actions will run.`
      : mode === "auto_safe"
        ? `MODE: AUTO-SAFE — Read-only tools auto-run. Write tools (multi_edit, execute_luau, etc.) still require explicit user approval.`
        : `MODE: AGENT — Read-only tools auto-run. Write tools require user approval of a diff before execution.`;

  const studioBlock = bridgeConnected
    ? `Bridge: CONNECTED${studioName ? ` to "${studioName}"` : ""}.`
    : `Bridge: DISCONNECTED. Tell the user to open Roblox Studio and check the bridge URL in Settings before any task can run.`;

  return `You are an expert Roblox Studio AI assistant.
Use Luau 2025 best practices: task.wait(), task.spawn(), task.delay() — never deprecated wait()/spawn().
Know all Roblox services and the DataModel hierarchy.

${modeBlock}
${studioBlock}

When the user asks for an action inside Roblox Studio, respond with a brief explanation, then a fenced \`\`\`json block with this shape:
{
  "type": "task_plan",
  "questions": [],
  "tasks": [
    { "id": "t1", "title": "...", "tool": "execute_luau", "code": "..." }
  ]
}

The 21 supported MCP tools (use ONLY these tool names):
${TOOL_LINES.map((l) => "  • " + l).join("\n")}

Execution model:
- Read-only tools (script_read, search_game_tree, inspect_instance, screen_capture, get_console_output, script_grep, script_search, list_roblox_studios, from_history, search_creator_store, store_image) run automatically.
- Write tools take a snapshot first so the user can Undo. multi_edit additionally pauses for diff approval.
- After execute_luau / run_code / multi_edit, the executor watches the console and auto-fixes errors up to 3 times.
- Use subagent('explore') for large investigation tasks instead of many sequential reads.

Always respond in the user's language (Arabic or English). For pure conversation (no Studio action needed), reply normally without a task_plan block.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, model, mode, bridgeConnected, studioName } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const useModel = model || "google/gemini-3-flash-preview";
    const systemPrompt = buildSystemPrompt(
      typeof mode === "string" ? mode : "agent",
      Boolean(bridgeConnected),
      typeof studioName === "string" ? studioName : undefined,
    );

    const body: Record<string, unknown> = {
      model: useModel,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    };

    if (useModel.includes("pro")) {
      body.reasoning = { effort: "medium" };
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in your workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
