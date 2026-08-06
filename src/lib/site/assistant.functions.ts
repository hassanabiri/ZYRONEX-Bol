import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Context-aware assistant for the public marketing site.
 * Uses the Lovable AI Gateway so no external API keys are required.
 */
const inputSchema = z.object({
  message: z.string().min(1).max(2000),
  page: z.string(),
  pageContext: z.string(),
  language: z.enum(["en", "ar"]),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20),
});

export const askSiteAssistant = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return { reply: null };
    }

    const system = [
      "You are the ZYRONEX product assistant on the public website.",
      "Answer concisely in the user's language. Be helpful, factual and never invent pricing or features.",
      `The user is on page: ${data.page}. Context: ${data.pageContext}`,
      "If they need account help, suggest signing in or contacting support.",
    ].join(" ");

    const messages = [
      { role: "system", content: system },
      ...data.history,
      { role: "user", content: data.message },
    ];

    const response = await fetch("https://ai.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.5,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      return { reply: null };
    }

    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return { reply: json.choices?.[0]?.message?.content?.trim() ?? null };
  });
