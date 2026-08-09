import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Context-aware assistant for the public marketing site.
 * Uses the Google Gemini API directly via the GEMINI_API_KEY secret.
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
    const { generateGeminiText } = await import("@/lib/ai/gemini.server");

    const system = [
      "You are the ZYRONEX product assistant on the public website.",
      "Answer concisely in the user's language. Be helpful, factual and never invent pricing or features.",
      `The user is on page: ${data.page}. Context: ${data.pageContext}`,
      "If they need account help, suggest signing in or contacting support.",
    ].join(" ");

    try {
      const reply = await generateGeminiText({
        system,
        turns: [...data.history, { role: "user" as const, content: data.message }],
        temperature: 0.5,
        maxOutputTokens: 800,
      });
      return { reply };
    } catch (error) {
      console.error("Gemini assistant failed", error);
      return { reply: null };
    }
  });

