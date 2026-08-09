import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  provider: z.string().max(60),
  apiKey: z.string().max(500),
  model: z.string().max(120).optional(),
  baseUrl: z.string().max(300).optional(),
});

export const testAiProviderConnection = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { testProviderConnection } = await import("./ai/provider-test.server");
    return testProviderConnection(data);
  });
