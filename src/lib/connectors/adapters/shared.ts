import { ConnectorError } from "@/lib/connectors/errors";

/**
 * Shared adapter primitives.
 *
 * Every commerce adapter (Salla, Zid, Shopify, WooCommerce) previously carried
 * byte-identical copies of these helpers. They are transport-neutral and carry
 * no provider or business logic, so they live here once. Behaviour — including
 * error kinds and messages — is unchanged.
 */

/** Narrows an unknown payload to a plain object (arrays and scalars → {}). */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Copies only the declared keys that are actually present in `params`. */
export function pickInto(params: Record<string, unknown>, keys: string[] | undefined): Record<string, unknown> {
  if (!keys) return {};
  const out: Record<string, unknown> = {};
  for (const key of keys) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

/** Fails fast, before any network call, when a required parameter is missing. */
export function assertRequiredParams(
  operation: string,
  params: Record<string, unknown>,
  required: string[] | undefined,
): void {
  for (const key of required ?? [])
    if (params[key] === undefined || params[key] === null || params[key] === "")
      throw new ConnectorError("invalid_request", `\`${key}\` is required for ${operation}`, { retryable: false });
}
