import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert Roblox Studio AI assistant.
Use Luau 2025 best practices: task.wait(), task.spawn(), task.delay() — never deprecated wait()/spawn().
Know all Roblox services and the DataModel hierarchy.

When the user asks for an action inside Roblox Studio, respond with a brief explanation, then a fenced \`\`\`json block with this shape:
{
  "type": "task_plan",
  "questions": [],
  "tasks": [
    { "id": "t1", "title": "...", "tool": "execute_luau", "code": "..." }
  ]
}

Supported tools: execute_luau, script_read, multi_edit, search_game_tree, inspect_instance, start_stop_play, screen_capture, list_roblox_studios, ping, run_code, get_hierarchy, get_scripts, set_property, insert_instance.

Always respond in the user's language (Arabic or English). For pure conversation (no Studio action needed), reply normally without a task_plan block.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, model } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const useModel = model || "google/gemini-3-flash-preview";
    const body: Record<string, unknown> = {
      model: useModel,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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