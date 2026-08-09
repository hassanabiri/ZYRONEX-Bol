/**
 * Direct Google Gemini API client.
 * Uses the GEMINI_API_KEY secret; no Lovable AI Gateway involved.
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODEL = "gemini-2.5-flash";

export function geminiApiKey(): string | undefined {
  return process.env["GEMINI_API_KEY"];
}

type JsonSchema = Record<string, unknown>;

/** Gemini's responseSchema rejects `additionalProperties`. */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === "additionalProperties" || key === "strict") continue;
      out[key] = sanitizeSchema(value);
    }
    return out;
  }
  return schema;
}

export type GeminiTurn = { role: "user" | "assistant"; content: string };

export async function generateGeminiText(options: {
  system?: string;
  turns: GeminiTurn[];
  jsonSchema?: JsonSchema;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
}): Promise<string | null> {
  const key = geminiApiKey();
  if (!key) return null;

  const body: Record<string, unknown> = {
    contents: options.turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    generationConfig: {
      temperature: options.temperature ?? 0.6,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      ...(options.jsonSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: sanitizeSchema(options.jsonSchema),
          }
        : {}),
    },
  };
  if (options.system) {
    body["systemInstruction"] = { parts: [{ text: options.system }] };
  }

  const response = await fetch(
    `${BASE}/${options.model ?? GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    console.error(`Gemini request failed [${response.status}]: ${await response.text()}`);
    return null;
  }

  const json = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return text || null;
}
