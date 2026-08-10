import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  mode: z.enum(["explain", "generate"]),
  field: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  format: z.string().max(200).optional(),
  example: z.string().max(300).optional(),
  currentValue: z.string().max(2000).optional(),
  context: z.string().max(1500).optional(),
  language: z.enum(["en", "ar"]),
});

/** In-context AI helper for a single form field (explain or auto-generate). */
export const assistField = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { generateGeminiText } = await import("@/lib/ai/gemini.server");

    const lang = data.language === "ar" ? "Arabic" : "English";
    const system =
      data.mode === "generate"
        ? `You fill in a single form field inside the ZYRONEX AI agent platform. Reply in ${lang}. Return ONLY the value for the field, with no quotes, no labels and no explanation. Respect the requested format exactly.`
        : `You explain a single form field inside the ZYRONEX AI agent platform. Reply in ${lang}. Maximum 3 short sentences: what the field is, the expected format, and a concrete example.`;

    const prompt = [
      `Field: ${data.field}`,
      data.description ? `Purpose: ${data.description}` : "",
      data.format ? `Expected format: ${data.format}` : "",
      data.example ? `Example: ${data.example}` : "",
      data.currentValue ? `Current value: ${data.currentValue}` : "",
      data.context ? `Project context: ${data.context}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const text = await generateGeminiText({
        system,
        turns: [{ role: "user" as const, content: prompt }],
        temperature: data.mode === "generate" ? 0.7 : 0.3,
        maxOutputTokens: 400,
      });
      return { text: text?.trim() ?? null };
    } catch (error) {
      console.error("assistField failed", error);
      return { text: null };
    }
  });
