import { invokeConnector } from "@/lib/connectors/run.server";
import { registerNodeHandler } from "@/lib/execution/engine.server";

/**
 * Binds the connector layer to the Server Execution Runtime.
 *
 * Importing this module registers the `http_request` and `integration` node
 * handlers. The runtime itself is untouched: it still only knows about node
 * kinds and handler results, and never sees credentials.
 */

function templated(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const resolved = key
      .split(".")
      .reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), variables);
    return resolved === undefined || resolved === null ? match : String(resolved);
  });
}

function resolveParams(params: Record<string, unknown>, variables: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, templated(value, variables)]));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

registerNodeHandler("http_request", async ({ node, variables, workspaceId, traceId }) => {
  const params = resolveParams((node.params ?? {}) as Record<string, unknown>, variables);
  const result = await invokeConnector({
    workspaceId,
    connectorId: "http",
    operation: "request",
    traceId,
    params: {
      ...params,
      headers: parseMaybeJson(params["headers"]) ?? {},
      body: parseMaybeJson(params["body"]),
    },
  });

  if (!result.ok) {
    const error = new Error(result.error.message);
    // Non-retryable provider answers must not consume the runtime's retry budget.
    (error as Error & { retryable?: boolean }).retryable = result.error.retryable;
    if (result.error.retryAfterMs !== undefined) (error as Error & { retryAfterMs?: number }).retryAfterMs = result.error.retryAfterMs;
    throw error;
  }

  return {
    output: {
      status: result.status,
      items: result.items,
      cursor: result.cursor,
      durationMs: result.durationMs,
    },
  };
});

registerNodeHandler("integration", async ({ node, variables, workspaceId, traceId }) => {
  const params = resolveParams((node.params ?? {}) as Record<string, unknown>, variables);
  const provider = String(params["provider"] ?? "").trim();
  const operation = String(params["action"] ?? params["operation"] ?? "").trim();
  if (!provider) return { warning: `"${node.label}" has no provider selected and was skipped.` };
  if (!operation) return { warning: `"${node.label}" has no action selected and was skipped.` };

  const result = await invokeConnector({
    workspaceId,
    provider,
    operation,
    traceId,
    params,
    maxPages: Number(params["max_pages"] ?? 1),
  });

  if (!result.ok) {
    if (result.error.kind === "unsupported")
      return { warning: `"${node.label}" skipped: ${result.error.message}` };
    const error = new Error(result.error.message);
    (error as Error & { retryable?: boolean }).retryable = result.error.retryable;
    if (result.error.retryAfterMs !== undefined) (error as Error & { retryAfterMs?: number }).retryAfterMs = result.error.retryAfterMs;
    throw error;
  }

  return {
    output: {
      provider,
      operation,
      count: result.items.length,
      items: result.items.slice(0, 50),
      cursor: result.cursor,
    },
  };
});

export const connectorHandlersRegistered = true;
