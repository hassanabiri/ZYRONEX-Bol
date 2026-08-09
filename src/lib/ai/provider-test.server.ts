export type ProviderTestInput = {
  provider: string;
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
};


export type ProviderTestResult = {
  ok: boolean;
  /** Stable reason code the UI translates into a precise message. */
  reason?:
    | "invalid_key"
    | "expired_credentials"
    | "unreachable"
    | "model_unavailable"
    | "rate_limited"
    | "failed";
  detail?: string;
};

function endpoint(input: ProviderTestInput): { url: string; headers: Record<string, string> } {
  const key = input.apiKey.trim();
  switch (input.provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      };
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        headers: {},
      };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } };
    default: {
      const base = (input.baseUrl || "").trim().replace(/\/+$/, "");
      return {
        url: `${base}/models`,
        headers: { Authorization: `Bearer ${key}` },
      };
    }
  }
}

/** Performs a read-only credential check against the provider. Nothing is stored. */
export async function testProviderConnection(
  input: ProviderTestInput,
): Promise<ProviderTestResult> {
  if (!input.apiKey.trim()) return { ok: false, reason: "invalid_key" };
  const { url, headers } = endpoint(input);
  if (!/^https?:\/\//.test(url)) return { ok: false, reason: "unreachable" };

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (response.status === 401) return { ok: false, reason: "invalid_key" };
  if (response.status === 403) return { ok: false, reason: "expired_credentials" };
  if (response.status === 429) return { ok: false, reason: "rate_limited" };
  if (response.status === 404) return { ok: false, reason: "unreachable" };
  if (!response.ok) {
    return { ok: false, reason: "failed", detail: `HTTP ${response.status}` };
  }

  const model = input.model?.trim();
  if (model) {
    let ids: string[] = [];
    try {
      const body = (await response.json()) as {
        data?: { id?: string }[];
        models?: { name?: string }[];
      };
      ids = [
        ...(body.data ?? []).map((entry) => entry.id ?? ""),
        ...(body.models ?? []).map((entry) => (entry.name ?? "").replace(/^models\//, "")),
      ].filter(Boolean);
    } catch {
      ids = [];
    }
    if (ids.length > 0 && !ids.some((id) => id === model || id.includes(model))) {
      return { ok: false, reason: "model_unavailable" };
    }
  }

  return { ok: true };
}
