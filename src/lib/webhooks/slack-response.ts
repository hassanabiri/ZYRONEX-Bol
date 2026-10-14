import { redactString } from "@/lib/connectors/errors";

/**
 * Slack `response_url` handling for slash commands and interactivity.
 *
 * The URL is a bearer capability (anyone holding it can post into the
 * conversation for 30 minutes, up to 5 times), so it is sealed with the
 * Credential Vault cipher before the event is persisted and is never written
 * to logs, delivery records or error messages.
 */

const SLACK_HOOK_HOST = "hooks.slack.com";

export function isSlackResponseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === SLACK_HOOK_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Replaces `response_url` / `response_urls[].response_url` with sealed values. */
export function sealSlackResponseUrls(
  payload: unknown,
  seal: (url: string) => string,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body = { ...(payload as Record<string, unknown>) };
  if ("response_url" in body) {
    const url = body["response_url"];
    delete body["response_url"];
    if (isSlackResponseUrl(url)) body["response_url_sealed"] = seal(url);
  }
  if (Array.isArray(body["response_urls"])) {
    body["response_urls"] = (body["response_urls"] as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const copy = { ...(item as Record<string, unknown>) };
      const url = copy["response_url"];
      delete copy["response_url"];
      if (isSlackResponseUrl(url)) copy["response_url_sealed"] = seal(url);
      return copy;
    });
  }
  return body;
}

export type SlackResponseMessage = {
  text?: string;
  blocks?: unknown[];
  response_type?: "ephemeral" | "in_channel";
  replace_original?: boolean;
  delete_original?: boolean;
  thread_ts?: string;
};

/** Posts a delayed reply to a Slack `response_url`. Never echoes the URL. */
export async function postSlackResponse(options: {
  responseUrl: string;
  message: SlackResponseMessage;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!isSlackResponseUrl(options.responseUrl))
    return { ok: false, status: 0, error: "response_url is not an official Slack hook URL" };
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(options.responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(options.message),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = (await res.text().catch(() => "")).split(options.responseUrl).join("[redacted]");
    return { ok: false, status: res.status, error: redactString(text.slice(0, 200)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { ok: false, status: 0, error: redactString(message.split(options.responseUrl).join("[redacted]")) };
  } finally {
    clearTimeout(timer);
  }
}
