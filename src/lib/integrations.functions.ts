import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const credentialsInput = z.object({
  integrationId: z.string().uuid(),
  values: z.record(z.string(), z.string().max(8000)),
});

export const saveIntegrationCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => credentialsInput.parse(data))
  .handler(async ({ data, context }) => {
    const { storeCredentials } = await import("@/lib/integrations/api.server");
    return storeCredentials(context.supabase, context.userId, data.integrationId, data.values);
  });

export const revokeIntegrationCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ integrationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { dropCredentials } = await import("@/lib/integrations/api.server");
    return dropCredentials(context.supabase, context.userId, data.integrationId);
  });

export const verifyIntegrationConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        integrationId: z.string().uuid(),
        requiredConfigKeys: z.array(z.string().max(64)).max(24).default([]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { verifyConnection } = await import("@/lib/integrations/api.server");
    return verifyConnection(
      context.supabase,
      context.userId,
      data.integrationId,
      data.requiredConfigKeys,
    );
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        name: z.string().trim().min(1).max(80),
        scopes: z.array(z.string().max(64)).max(40).default([]),
        environment: z.enum(["production", "sandbox"]).default("production"),
        expiresAt: z.string().datetime().nullable().default(null),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { issueApiKey } = await import("@/lib/integrations/api.server");
    return issueApiKey(context.supabase, context.userId, data);
  });

export const rotateApiKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ keyId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { rotateApiKey } = await import("@/lib/integrations/api.server");
    return rotateApiKey(context.supabase, context.userId, data.keyId);
  });

export const generateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ endpointId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { issueWebhookSecret } = await import("@/lib/integrations/api.server");
    return issueWebhookSecret(context.supabase, context.userId, data.endpointId);
  });
