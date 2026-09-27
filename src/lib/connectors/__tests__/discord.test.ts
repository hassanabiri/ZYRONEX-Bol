import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { DISCORD_API_BASE, UNSUPPORTED_OPERATIONS, discordConnector } from "@/lib/connectors/adapters/discord";
import {
  discordEventId,
  discordEventType,
  normalizeDiscordChannel,
  normalizeDiscordEvent,
  normalizeDiscordMessage,
} from "@/lib/connectors/adapters/discord-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-discord";
const TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.abcdefghijklmnopqrstuvwxyz0123456789AB";
const TOKEN_B = "OTg3NjU0MzIxMDk4NzY1NDMy.XyZaBc.ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210zz";
const creds = { access_token: TOKEN };
const CH = "111111111111111111";
const GUILD = "222222222222222222";
const MID = "333333333333333333";
const APP = "444444444444444444";
const USER = "555555555555555555";
const ITOKEN = "aW50ZXJhY3Rpb246MTIzNDU2Nzg5MDEyMzQ1Njc4OmFiYw";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}
const empty = () => new Response(null, { status: 204 });
function capture(response: unknown | (() => Response), init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return typeof response === "function" ? (response as () => Response)() : jsonResponse(response, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  const fetchImpl = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]!()) as unknown as typeof fetch;
  return { fetchImpl, count: () => i };
}
function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({ adapter: discordConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headers = (call: { init: RequestInit } | undefined) => (call?.init.headers ?? {}) as Record<string, string>;
const MSG = { id: MID, channel_id: CH, guild_id: GUILD, author: { id: USER, username: "sara", bot: false }, content: "hi", timestamp: "2026-09-27T10:00:00.000Z", embeds: [], attachments: [] };
const msg = (n: number) => ({ ...MSG, id: String(BigInt(MID) - BigInt(n)) });
const guild = (n: number) => ({ id: String(BigInt(GUILD) + BigInt(n)), name: `G${n}`, owner: false, permissions: "8", features: [] });

// ---- Ed25519 signing (official Discord security) -----------------------------
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
const other = generateKeyPairSync("ed25519");
const OTHER_KEY = (other.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
const NOW_S = 1_790_000_000;

function verify(payload: unknown, opts: { ts?: string; sig?: string | null; key?: string | null; nowMs?: number; tamper?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const ts = opts.ts ?? String(NOW_S);
  const signature = sign(null, Buffer.from(ts + raw), privateKey).toString("hex");
  const h: Record<string, string> = { "x-signature-timestamp": ts };
  if (opts.sig !== null) h["x-signature-ed25519"] = opts.sig ?? signature;
  return verifyWebhook("discord", {
    raw: opts.tamper ? raw.replace("hi", "ho") : raw,
    headers: h,
    payload,
    secret: opts.key === undefined ? PUBLIC_KEY : opts.key,
    nowMs: opts.nowMs ?? NOW_S * 1000 + 1000,
    replayWindowMs: 300_000,
  });
}
const INTERACTION = { id: "666666666666666666", application_id: APP, type: 2, token: ITOKEN, guild_id: GUILD, channel_id: CH, member: { user: { id: USER, username: "sara" } }, data: { name: "hi" } };
const PING = { ...INTERACTION, id: "666666666666666667", type: 1 };
const WEBHOOK_EVENT = { version: 1, application_id: APP, type: 1, event: { type: "APPLICATION_AUTHORIZED", timestamp: "2026-09-27T10:00:00.000Z", data: { user: { id: USER }, scopes: ["bot"] } } };

// ---------------------------------------------------------------------------
describe("discord registration", () => {
  it("is registered with aliases", () => {
    expect(getConnector("discord")?.id).toBe("discord");
    expect(getConnector("discord_bot")?.id).toBe("discord");
  });
  it("describes itself without credential values", () => {
    const d = describeConnectors().find((c) => c.id === "discord");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
    expect(JSON.stringify(d)).not.toContain(TOKEN);
  });
  it("declares messaging, pagination, webhook and health capabilities", () => {
    expect(discordConnector.capabilities).toEqual(expect.arrayContaining(["messaging", "pagination", "webhook", "health_check"]));
  });
  it("catalog exposes bot token as secret and public key as non-secret", () => {
    const p = PROVIDERS.find((x) => x.id === "discord")!;
    expect(p.credentialFields.find((f) => f.key === "bot_token")?.secret).toBe(true);
    expect(p.credentialFields.find((f) => f.key === "public_key")?.secret).toBe(false);
  });
  it("uses only the official v10 host", () => {
    for (const op of ["get_current_user", "list_guilds"]) expect(discordConnector.buildCall({ operation: op }).url.startsWith(DISCORD_API_BASE)).toBe(true);
    expect(DISCORD_API_BASE).toBe("https://discord.com/api/v10");
  });
});

describe("discord authentication", () => {
  it("sends the bot token as `Authorization: Bot`", async () => {
    const { calls, fetchImpl } = capture({ id: USER, username: "zy", bot: true });
    await run({ operation: "get_current_user" }, fetchImpl);
    expect(headers(calls[0])["authorization"]).toBe(`Bot ${TOKEN}`);
  });
  it("accepts the vault alias bot_token", async () => {
    const { calls, fetchImpl } = capture({ id: USER, bot: true });
    const r = await run({ operation: "get_current_user" }, fetchImpl, { access_token: TOKEN, bot_token: TOKEN });
    expect(r.ok).toBe(true);
    expect(headers(calls[0])["authorization"]).toContain(TOKEN);
  });
  it("fails before any request without a token", async () => {
    const { calls, fetchImpl } = capture({});
    const r = await run({ operation: "get_current_user" }, fetchImpl, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(calls).toHaveLength(0);
  });
  it("rejects a malformed token", async () => {
    const { calls, fetchImpl } = capture({});
    const r = await run({ operation: "get_current_user" }, fetchImpl, { access_token: "not-a-token" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("maps 401 to auth, non-retryable", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ code: 0, message: "401: Unauthorized" }, { status: 401 }));
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(count()).toBe(1);
  });
  it("interaction callbacks do not send the bot token", async () => {
    const { calls, fetchImpl } = capture(empty);
    await run({ operation: "create_interaction_response", params: { interaction_id: INTERACTION.id, interaction_token: ITOKEN, type: 4, data: { content: "ok" } } }, fetchImpl);
    expect(headers(calls[0])["authorization"]).toBeUndefined();
    expect(headers(calls[0])["x-zyronex-no-auth"]).toBeUndefined();
  });
});

describe("discord connection account / identity", () => {
  it("reads the bot user", async () => {
    const r = await run({ operation: "get_current_user" }, capture({ id: USER, username: "zyronex", bot: true }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: USER, username: "zyronex", bot: true });
  });
  it("reads the application (public key for events)", async () => {
    const { calls, fetchImpl } = capture({ id: APP, name: "ZYRONEX", verify_key: PUBLIC_KEY, bot_public: false, bot: { id: USER, bot: true } });
    const r = await run({ operation: "get_current_application" }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/applications/@me`);
    expect(r.ok && r.items[0]).toMatchObject({ id: APP, verifyKey: PUBLIC_KEY });
  });
  it("reads gateway bot info", async () => {
    const { calls, fetchImpl } = capture({ url: "wss://gateway.discord.gg", shards: 1 });
    await run({ operation: "get_gateway_bot" }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/gateway/bot`);
  });
});

describe("discord health", () => {
  it("is healthy on users/@me", async () => {
    const h = await checkConnectorHealth({ adapter: discordConnector, credentials: creds, traceId: trace, fetchImpl: capture({ id: USER, bot: true }).fetchImpl });
    expect(h.healthy).toBe(true);
  });
  it("is unhealthy on 401 without retrying", async () => {
    const s = sequence(() => jsonResponse({ code: 0, message: "401: Unauthorized" }, { status: 401 }));
    const h = await checkConnectorHealth({ adapter: discordConnector, credentials: creds, traceId: trace, fetchImpl: s.fetchImpl });
    expect(h.healthy).toBe(false);
    expect(s.count()).toBe(1);
  });
  it("health message never contains the token", async () => {
    const h = await checkConnectorHealth({ adapter: discordConnector, credentials: creds, traceId: trace, fetchImpl: capture({ code: 0, message: `bad ${TOKEN}` }, { status: 401 }).fetchImpl });
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});

describe("discord guilds", () => {
  it("lists guilds with limit and counts", async () => {
    const { calls, fetchImpl } = capture([guild(1)]);
    const r = await run({ operation: "list_guilds", params: { with_counts: true } }, fetchImpl);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/v10/users/@me/guilds");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("with_counts")).toBe("true");
    expect(r.ok && r.items[0]).toMatchObject({ name: "G1", permissions: "8" });
  });
  it("gets a guild", async () => {
    const { calls, fetchImpl } = capture(guild(0));
    await run({ operation: "get_guild", params: { guild_id: GUILD } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/guilds/${GUILD}`);
  });
  it("rejects invalid guild ids before any call", async () => {
    const { calls, fetchImpl } = capture({});
    const r = await run({ operation: "get_guild", params: { guild_id: "../users" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
    expect(calls).toHaveLength(0);
  });
  it("lists guild members (after-paginated)", async () => {
    const { calls, fetchImpl } = capture([{ user: { id: USER }, nick: "S", roles: ["1"], joined_at: "x" }]);
    const r = await run({ operation: "list_guild_members", params: { guild_id: GUILD, limit: 5000 } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("1000");
    expect(r.ok && r.items[0]).toMatchObject({ nick: "S" });
  });
  it("requires guild_id", async () => {
    const r = await run({ operation: "list_guild_channels" }, capture([]).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

describe("discord channels", () => {
  it("lists guild channels normalized", async () => {
    const r = await run({ operation: "list_guild_channels", params: { guild_id: GUILD } }, capture([{ id: CH, type: 0, name: "general", guild_id: GUILD }]).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: CH, type: "guild_text", name: "general", isThread: false });
  });
  it("gets a channel", async () => {
    const { calls, fetchImpl } = capture({ id: CH, type: 0 });
    await run({ operation: "get_channel", params: { channel_id: CH } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}`);
  });
  it("normalizes thread channels", () => {
    expect(normalizeDiscordChannel({ id: CH, type: 11, thread_metadata: { archived: true, archive_timestamp: "t" } })).toMatchObject({ type: "public_thread", isThread: true, archived: true });
  });
  it("triggers typing (204)", async () => {
    const { calls, fetchImpl } = capture(empty);
    const r = await run({ operation: "trigger_typing", params: { channel_id: CH } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("POST");
    expect(r.ok && r.items[0]).toEqual({ ok: true });
  });
  it("opens a DM channel", async () => {
    const { calls, fetchImpl } = capture({ id: CH, type: 1 });
    const r = await run({ operation: "create_dm", params: { recipient_id: USER } }, fetchImpl);
    expect(body(calls[0])).toEqual({ recipient_id: USER });
    expect(r.ok && r.items[0]).toMatchObject({ type: "dm" });
  });
});

describe("discord messages", () => {
  it("sends a text message", async () => {
    const { calls, fetchImpl } = capture(MSG);
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "hi" } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}/messages`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ content: "hi" });
    expect(r.ok && r.items[0]).toMatchObject({ id: MID, content: "hi", channelId: CH });
  });
  it("drops non-allowlisted fields", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "hi", evil: 1, webhook_url: "x" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ content: "hi" });
  });
  it("rejects content over 2000 characters", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "x".repeat(2001) } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects an empty message", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("passes allowed_mentions through", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "@everyone", allowed_mentions: { parse: [] } } }, fetchImpl);
    expect(body(calls[0])["allowed_mentions"]).toEqual({ parse: [] });
  });
  it("gets a message", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "get_message", params: { channel_id: CH, message_id: MID } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}/messages/${MID}`);
  });
  it("lists pinned messages", async () => {
    const r = await run({ operation: "list_pinned_messages", params: { channel_id: CH } }, capture([MSG]).fetchImpl);
    expect(r.ok && r.items).toHaveLength(1);
  });
  it("pins and unpins", async () => {
    const a = capture(empty);
    await run({ operation: "pin_message", params: { channel_id: CH, message_id: MID } }, a.fetchImpl);
    expect(a.calls[0]?.init.method).toBe("PUT");
    const b = capture(empty);
    await run({ operation: "unpin_message", params: { channel_id: CH, message_id: MID } }, b.fetchImpl);
    expect(b.calls[0]?.init.method).toBe("DELETE");
  });
  it("normalizes messages", () => {
    const m = normalizeDiscordMessage({ ...MSG, message_reference: { message_id: "9" }, reactions: [{ emoji: { name: "👍" }, count: 2, me: true }], attachments: [{ id: "1", filename: "a.png", url: "https://cdn", content_type: "image/png", size: 3 }] });
    expect(m.replyToMessageId).toBe("9");
    expect(m.reactions[0]).toEqual({ emoji: "👍", count: 2, me: true });
    expect(m.attachments[0]?.contentType).toBe("image/png");
    expect(m.author?.username).toBe("sara");
  });
});

describe("discord replies", () => {
  it("sends a reply with message_reference", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_reply", params: { channel_id: CH, reply_to_message_id: MID, content: "yes" } }, fetchImpl);
    expect(body(calls[0])["message_reference"]).toEqual({ message_id: MID, channel_id: CH, fail_if_not_exists: true });
  });
  it("can opt out of fail_if_not_exists", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_reply", params: { channel_id: CH, reply_to_message_id: MID, content: "y", fail_if_not_exists: false } }, fetchImpl);
    expect((body(calls[0])["message_reference"] as Record<string, unknown>)["fail_if_not_exists"]).toBe(false);
  });
  it("requires reply_to_message_id", async () => {
    const r = await run({ operation: "send_reply", params: { channel_id: CH, content: "y" } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects a non-snowflake reply target", async () => {
    const r = await run({ operation: "send_reply", params: { channel_id: CH, reply_to_message_id: "abc", content: "y" } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

describe("discord edit / delete", () => {
  it("edits a message with PATCH", async () => {
    const { calls, fetchImpl } = capture({ ...MSG, content: "new", edited_timestamp: "t2" });
    const r = await run({ operation: "edit_message", params: { channel_id: CH, message_id: MID, content: "new" } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(r.ok && r.items[0]).toMatchObject({ content: "new", editedTimestamp: "t2" });
  });
  it("deletes a message (204)", async () => {
    const { calls, fetchImpl } = capture(empty);
    const r = await run({ operation: "delete_message", params: { channel_id: CH, message_id: MID } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(r.ok && r.items[0]).toEqual({ ok: true });
  });
  it("bulk deletes 2–100 messages", async () => {
    const { calls, fetchImpl } = capture(empty);
    await run({ operation: "bulk_delete_messages", params: { channel_id: CH, messages: [MID, msg(1).id] } }, fetchImpl);
    expect(calls[0]?.url).toContain("/messages/bulk-delete");
  });
  it("rejects bulk delete of a single message", async () => {
    const r = await run({ operation: "bulk_delete_messages", params: { channel_id: CH, messages: [MID] } }, capture(empty).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("maps editing someone else's message (403/50005) to forbidden", async () => {
    const r = await run({ operation: "edit_message", params: { channel_id: CH, message_id: MID, content: "x" } }, capture({ code: 50005, message: "Cannot edit a message authored by another user" }, { status: 403 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("forbidden");
  });
  it("maps bulk delete of old messages (400/50034) to invalid_request", async () => {
    const r = await run({ operation: "bulk_delete_messages", params: { channel_id: CH, messages: [MID, msg(1).id] } }, capture({ code: 50034, message: "too old" }, { status: 400 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
});

describe("discord embeds", () => {
  it("sends embeds", async () => {
    const { calls, fetchImpl } = capture(MSG);
    const embeds = [{ title: "Order", description: "Shipped", color: 3447003, fields: [{ name: "a", value: "b" }] }];
    await run({ operation: "send_message", params: { channel_id: CH, embeds } }, fetchImpl);
    expect(body(calls[0])["embeds"]).toEqual(embeds);
  });
  it("rejects more than 10 embeds", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, embeds: Array.from({ length: 11 }, () => ({ title: "x" })) } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects an oversized title", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, embeds: [{ title: "x".repeat(257) }] } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects embeds over 6000 characters in total", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, embeds: [{ description: "x".repeat(4000) }, { description: "x".repeat(2500) }] } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects more than 25 fields", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, embeds: [{ fields: Array.from({ length: 26 }, () => ({ name: "a", value: "b" })) }] } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

describe("discord attachments / media", () => {
  it("sends media by https URL in an embed", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, embeds: [{ image: { url: "https://cdn.example.com/a.png" } }] } }, fetchImpl);
    expect(body(calls[0])["embeds"]).toBeDefined();
  });
  it("rejects non-https media URLs", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, embeds: [{ image: { url: "http://x/a.png" } }] } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("keeps existing attachments on edit by id", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "edit_message", params: { channel_id: CH, message_id: MID, attachments: [{ id: "777777777777777777" }] } }, fetchImpl);
    expect(body(calls[0])["attachments"]).toEqual([{ id: "777777777777777777" }]);
  });
  it("refuses binary attachment upload (UNSUPPORTED)", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "x", attachments: [{ filename: "a.png", data: "AAAA" }] } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
    expect(UNSUPPORTED_OPERATIONS["upload_attachment_binary"]).toMatch(/multipart/);
  });
  it("normalizes received attachments", async () => {
    const r = await run({ operation: "get_message", params: { channel_id: CH, message_id: MID } }, capture({ ...MSG, attachments: [{ id: "1", filename: "f.pdf", url: "https://cdn.discordapp.com/f.pdf", size: 10 }] }).fetchImpl);
    expect(r.ok && (r.items[0] as { attachments: unknown[] }).attachments).toHaveLength(1);
  });
});

describe("discord threads", () => {
  it("starts a thread from a message", async () => {
    const { calls, fetchImpl } = capture({ id: CH, type: 11, name: "Support" });
    const r = await run({ operation: "start_thread_from_message", params: { channel_id: CH, message_id: MID, name: "Support", auto_archive_duration: 1440 } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}/messages/${MID}/threads`);
    expect(r.ok && r.items[0]).toMatchObject({ type: "public_thread" });
  });
  it("starts a thread without a message", async () => {
    const { calls, fetchImpl } = capture({ id: CH, type: 12 });
    await run({ operation: "start_thread", params: { channel_id: CH, name: "Private", type: 12 } }, fetchImpl);
    expect(body(calls[0])).toEqual({ name: "Private", type: 12 });
  });
  it("rejects an invalid auto_archive_duration", async () => {
    const r = await run({ operation: "start_thread", params: { channel_id: CH, name: "x", auto_archive_duration: 5 } }, capture({}).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("rejects thread names over 100 characters", async () => {
    const r = await run({ operation: "start_thread", params: { channel_id: CH, name: "x".repeat(101) } }, capture({}).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("joins and leaves a thread", async () => {
    const a = capture(empty);
    await run({ operation: "join_thread", params: { thread_id: CH } }, a.fetchImpl);
    expect(a.calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}/thread-members/@me`);
    const b = capture(empty);
    await run({ operation: "leave_thread", params: { thread_id: CH } }, b.fetchImpl);
    expect(b.calls[0]?.init.method).toBe("DELETE");
  });
  it("lists active guild threads", async () => {
    const r = await run({ operation: "list_active_threads", params: { guild_id: GUILD } }, capture({ threads: [{ id: CH, type: 11 }], members: [] }).fetchImpl);
    expect(r.ok && r.items).toHaveLength(1);
  });
  it("paginates archived threads by archive timestamp", async () => {
    const { calls, fetchImpl } = capture({ threads: [{ id: CH, type: 11, thread_metadata: { archived: true, archive_timestamp: "2026-01-01T00:00:00Z" } }], has_more: true });
    const r = await run({ operation: "list_public_archived_threads", params: { channel_id: CH, limit: 1 } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("1");
    expect(r.ok && r.cursor).toBe("2026-01-01T00:00:00Z");
  });
});

describe("discord reactions", () => {
  it("adds a unicode reaction URL-encoded", async () => {
    const { calls, fetchImpl } = capture(empty);
    await run({ operation: "add_reaction", params: { channel_id: CH, message_id: MID, emoji: "👍" } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/channels/${CH}/messages/${MID}/reactions/${encodeURIComponent("👍")}/@me`);
    expect(calls[0]?.init.method).toBe("PUT");
  });
  it("adds a custom emoji name:id", async () => {
    const { calls, fetchImpl } = capture(empty);
    await run({ operation: "add_reaction", params: { channel_id: CH, message_id: MID, emoji: "zy:888888888888888888" } }, fetchImpl);
    expect(calls[0]?.url).toContain(encodeURIComponent("zy:888888888888888888"));
  });
  it("rejects malformed custom emoji", async () => {
    const r = await run({ operation: "add_reaction", params: { channel_id: CH, message_id: MID, emoji: "bad:emoji/../x" } }, capture(empty).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("removes own reaction", async () => {
    const { calls, fetchImpl } = capture(empty);
    await run({ operation: "remove_own_reaction", params: { channel_id: CH, message_id: MID, emoji: "👍" } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("DELETE");
  });
  it("lists reacting users", async () => {
    const r = await run({ operation: "list_reactions", params: { channel_id: CH, message_id: MID, emoji: "👍" } }, capture([{ id: USER, username: "s" }]).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: USER });
  });
});

describe("discord interactions replies", () => {
  it("creates an interaction response via the official callback", async () => {
    const { calls, fetchImpl } = capture(empty);
    const r = await run({ operation: "create_interaction_response", params: { interaction_id: INTERACTION.id, interaction_token: ITOKEN, type: 4, data: { content: "ok" } } }, fetchImpl);
    expect(calls[0]?.url).toBe(`${DISCORD_API_BASE}/interactions/${INTERACTION.id}/${ITOKEN}/callback`);
    expect(r.ok).toBe(true);
  });
  it("rejects unknown callback types", async () => {
    const r = await run({ operation: "create_interaction_response", params: { interaction_id: INTERACTION.id, interaction_token: ITOKEN, type: 99 } }, capture(empty).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("sends a follow-up and edits the original", async () => {
    const a = capture(MSG);
    await run({ operation: "create_followup_message", params: { application_id: APP, interaction_token: ITOKEN, content: "more" } }, a.fetchImpl);
    expect(a.calls[0]?.url).toBe(`${DISCORD_API_BASE}/webhooks/${APP}/${ITOKEN}`);
    const b = capture(MSG);
    await run({ operation: "edit_original_interaction_response", params: { application_id: APP, interaction_token: ITOKEN, content: "edited" } }, b.fetchImpl);
    expect(b.calls[0]?.url).toBe(`${DISCORD_API_BASE}/webhooks/${APP}/${ITOKEN}/messages/@original`);
  });
  it("rejects a malformed interaction token", async () => {
    const r = await run({ operation: "create_followup_message", params: { application_id: APP, interaction_token: "a/b", content: "x" } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

describe("discord pagination", () => {
  it("follows messages `before` the oldest id", async () => {
    const pages = [[msg(0), msg(1)], [msg(2)]];
    const calls: string[] = [];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse(pages[i++] ?? []);
    }) as unknown as typeof fetch;
    const r = await run({ operation: "list_messages", params: { channel_id: CH, limit: 2 }, maxPages: 5 }, fetchImpl);
    expect(r.ok && r.items).toHaveLength(3);
    expect(new URL(calls[1]!).searchParams.get("before")).toBe(msg(1).id);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("returns a cursor when maxPages stops early", async () => {
    const r = await run({ operation: "list_messages", params: { channel_id: CH, limit: 2 }, maxPages: 1 }, capture([msg(0), msg(1)]).fetchImpl);
    expect(r.ok && r.cursor).toBe(msg(1).id);
  });
  it("follows guilds `after` the last id", async () => {
    const pages = [[guild(1), guild(2)], [guild(3)]];
    const calls: string[] = [];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse(pages[i++] ?? []);
    }) as unknown as typeof fetch;
    const r = await run({ operation: "list_guilds", params: { limit: 2 }, maxPages: 5 }, fetchImpl);
    expect(r.ok && r.items).toHaveLength(3);
    expect(new URL(calls[1]!).searchParams.get("after")).toBe(guild(2).id);
  });
  it("clamps message limit to 100", async () => {
    const { calls, fetchImpl } = capture([]);
    await run({ operation: "list_messages", params: { channel_id: CH, limit: 500 } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("100");
  });
  it("accepts an explicit cursor", async () => {
    const { calls, fetchImpl } = capture([]);
    await run({ operation: "list_messages", params: { channel_id: CH }, cursor: MID }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("before")).toBe(MID);
  });
  it("rejects a non-snowflake cursor", async () => {
    const r = await run({ operation: "list_messages", params: { channel_id: CH }, cursor: "x&y" }, capture([]).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

describe("discord rate limits and retry", () => {
  it("retries 429 using retry_after from the body", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ message: "You are being rate limited.", retry_after: 1.5, global: false }, { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse(MSG),
    );
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "x" } }, fetchImpl, creds, { sleep: async (ms) => void sleeps.push(ms) });
    expect(r.ok).toBe(true);
    expect(count()).toBe(2);
    expect(sleeps).toHaveLength(1);
  });
  it("reads body retry_after (seconds, float)", () => {
    expect(discordConnector.readRateLimit?.(new Headers(), { retry_after: 1.5 })?.retryAfterMs).toBe(1500);
  });
  it("reads bucket headers", () => {
    const info = discordConnector.readRateLimit?.(new Headers({ "x-ratelimit-limit": "5", "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.25", "x-ratelimit-reset": "1790000000" }), {});
    expect(info).toMatchObject({ limit: 5, remaining: 0, retryAfterMs: 250 });
    expect(info?.resetAt).toBe(new Date(1_790_000_000_000).toISOString());
  });
  it("waits proactively when the bucket is exhausted", async () => {
    const sleeps: number[] = [];
    const r = await run(
      { operation: "list_messages", params: { channel_id: CH, limit: 1 }, maxPages: 2 },
      capture([msg(0)], { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.5" } }).fetchImpl,
      creds,
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r.ok).toBe(true);
    expect(sleeps).toContain(500);
  });
  it("retries 5xx with backoff", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ message: "x" }, { status: 502 }), () => jsonResponse(MSG));
    const r = await run({ operation: "get_message", params: { channel_id: CH, message_id: MID } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("gives up after max attempts", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ message: "x" }, { status: 500 }));
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(r.ok).toBe(false);
    expect(count()).toBe(3);
  });
  it("does not retry 400", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ code: 50035, message: "Invalid Form Body" }, { status: 400 }));
    await run({ operation: "send_message", params: { channel_id: CH, content: "x" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("retries network failures", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("ECONNRESET");
      return jsonResponse(MSG);
    }) as unknown as typeof fetch;
    expect((await run({ operation: "send_message", params: { channel_id: CH, content: "x" } }, fetchImpl)).ok).toBe(true);
  });
});

describe("discord error normalization", () => {
  const cases: [number, unknown, string][] = [
    [400, { code: 50035, message: "Invalid Form Body" }, "invalid_request"],
    [403, { code: 50013, message: "Missing Permissions" }, "forbidden"],
    [403, { code: 50001, message: "Missing Access" }, "forbidden"],
    [404, { code: 10003, message: "Unknown Channel" }, "not_found"],
    [404, { code: 10008, message: "Unknown Message" }, "not_found"],
    [429, { message: "rate limited", retry_after: 1 }, "rate_limit"],
    [503, { message: "unavailable" }, "provider"],
  ];
  for (const [status, payload, kind] of cases)
    it(`maps ${status} ${JSON.stringify(payload).slice(0, 30)} → ${kind}`, () => {
      expect(discordConnector.mapError?.(status, payload)?.kind).toBe(kind);
    });
  it("includes the official JSON error code", () => {
    expect(discordConnector.mapError?.(403, { code: 50013, message: "Missing Permissions" })?.message).toBe("Discord error 50013: Missing Permissions");
  });
  it("returns null on success", () => {
    expect(discordConnector.mapError?.(200, MSG)).toBeNull();
  });
  it("flags unknown operations", async () => {
    const r = await run({ operation: "delete_guild" }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("unsupported");
  });
  it("marks documented gaps as UNSUPPORTED_OPERATION", async () => {
    const r = await run({ operation: "gateway_events" }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("unsupported");
    expect(() => discordConnector.buildCall({ operation: "gateway_events" })).toThrow(/UNSUPPORTED_OPERATION/);
  });
  it("rejects malformed payloads", async () => {
    const r = await run({ operation: "list_messages", params: { channel_id: CH } }, capture({ not: "a list" }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
});

describe("discord events — signature verification", () => {
  it("accepts a valid Ed25519 signature", () => {
    expect(verify(INTERACTION)).toMatchObject({ ok: true, eventType: "interaction.application_command" });
  });
  it("rejects a tampered body", () => {
    expect(verify(INTERACTION, { tamper: true })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a missing signature header", () => {
    expect(verify(INTERACTION, { sig: null })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a signature from another application key", () => {
    expect(verify(INTERACTION, { key: OTHER_KEY })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a garbage signature", () => {
    expect(verify(INTERACTION, { sig: "zz" })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("requires a configured public key", () => {
    expect(verify(INTERACTION, { key: null })).toMatchObject({ ok: false, reason: "missing_secret" });
  });
  it("rejects a malformed public key", () => {
    expect(verify(INTERACTION, { key: "abc" })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
});

describe("discord events — replay protection", () => {
  it("rejects timestamps outside the replay window", () => {
    expect(verify(INTERACTION, { nowMs: (NOW_S + 3600) * 1000 })).toMatchObject({ ok: false, reason: "replay" });
  });
  it("rejects future timestamps outside the window", () => {
    expect(verify(INTERACTION, { nowMs: (NOW_S - 3600) * 1000 })).toMatchObject({ ok: false, reason: "replay" });
  });
  it("signs the timestamp, so it cannot be swapped", () => {
    const raw = JSON.stringify(INTERACTION);
    const sig = sign(null, Buffer.from(String(NOW_S) + raw), privateKey).toString("hex");
    const res = verifyWebhook("discord", { raw, headers: { "x-signature-ed25519": sig, "x-signature-timestamp": String(NOW_S + 10) }, payload: INTERACTION, secret: PUBLIC_KEY, nowMs: NOW_S * 1000, replayWindowMs: 300_000 });
    expect(res).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("reports the signed timestamp", () => {
    expect(verify(INTERACTION).timestampMs).toBe(NOW_S * 1000);
  });
});

describe("discord events — types and dedupe", () => {
  it("dedupes interactions by the official interaction id", () => {
    expect(verify(INTERACTION).eventId).toBe(`interaction:${INTERACTION.id}`);
    expect(verify(INTERACTION).eventId).toBe(verify(INTERACTION).eventId);
  });
  it("recognizes ping", () => {
    expect(verify(PING)).toMatchObject({ ok: true, eventType: "interaction.ping" });
  });
  it("recognizes component and modal interactions", () => {
    expect(discordEventType({ ...INTERACTION, type: 3 })).toBe("interaction.message_component");
    expect(discordEventType({ ...INTERACTION, type: 5 })).toBe("interaction.modal_submit");
  });
  it("recognizes Webhook Events", () => {
    expect(verify(WEBHOOK_EVENT)).toMatchObject({ ok: true, eventType: "event.application_authorized" });
  });
  it("derives a stable Webhook Event id from official fields", () => {
    expect(discordEventId(WEBHOOK_EVENT)).toBe(`event:${APP}:APPLICATION_AUTHORIZED:2026-09-27T10:00:00.000Z:${USER}`);
  });
  it("webhook pings carry no event id", () => {
    const pingEvent = { version: 1, application_id: APP, type: 0 };
    expect(discordEventType(pingEvent)).toBe("webhook.ping");
    expect(discordEventId(pingEvent)).toBeUndefined();
  });
  it("rejects unknown event types after verification", () => {
    expect(verify({ version: 1, application_id: APP, type: 1, event: { type: "MADE_UP", timestamp: "t", data: {} } })).toMatchObject({ ok: false, reason: "unsupported_event" });
  });
  it("different interactions get different ids", () => {
    expect(discordEventId(INTERACTION)).not.toBe(discordEventId(PING));
  });
});

describe("discord events — normalization", () => {
  it("normalizes an interaction", () => {
    expect(normalizeDiscordEvent(INTERACTION)).toMatchObject({ kind: "interaction", eventType: "interaction.application_command", guildId: GUILD, user: { id: USER } });
  });
  it("normalizes a Webhook Event", () => {
    expect(normalizeDiscordEvent(WEBHOOK_EVENT)).toMatchObject({ kind: "webhook_event", type: "APPLICATION_AUTHORIZED" });
  });
  it("the interaction token is redacted in logs", () => {
    expect(JSON.stringify(redact(normalizeDiscordEvent(INTERACTION)))).not.toContain(ITOKEN);
  });
});

describe("discord idempotency", () => {
  it("maps idempotency_key to the official nonce + enforce_nonce", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "x", idempotency_key: "exec-42-step-3" } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ nonce: "exec-42-step-3", enforce_nonce: true });
  });
  it("uses the same nonce on retry so Discord dedupes", async () => {
    const bodies: unknown[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      n += 1;
      return n === 1 ? jsonResponse({ message: "x" }, { status: 502 }) : jsonResponse({ ...MSG, nonce: "k1" });
    }) as unknown as typeof fetch;
    const r = await run({ operation: "send_reply", params: { channel_id: CH, reply_to_message_id: MID, content: "x", nonce: "k1" } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
  });
  it("rejects nonces over 25 characters", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "x", idempotency_key: "x".repeat(26) } }, capture(MSG).fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("sends no invented idempotency header", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "x", idempotency_key: "k" } }, fetchImpl);
    expect(Object.keys(headers(calls[0])).some((h) => /idempotency/i.test(h))).toBe(false);
  });
  it("normalizes the returned nonce", () => {
    expect(normalizeDiscordMessage({ ...MSG, nonce: "k1" }).nonce).toBe("k1");
  });
});

describe("discord isolation, redaction and tracing", () => {
  it("never mixes two workspaces' bot tokens", async () => {
    const a = capture(MSG);
    const b = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "a" } }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "send_message", params: { channel_id: CH, content: "b" } }, b.fetchImpl, { access_token: TOKEN_B });
    expect(headers(a.calls[0])["authorization"]).toBe(`Bot ${TOKEN}`);
    expect(headers(b.calls[0])["authorization"]).toBe(`Bot ${TOKEN_B}`);
  });
  it("ignores tokens smuggled through params", async () => {
    const { calls, fetchImpl } = capture(MSG);
    await run({ operation: "send_message", params: { channel_id: CH, content: "x", access_token: TOKEN_B, authorization: `Bot ${TOKEN_B}` } }, fetchImpl);
    expect(JSON.stringify(calls[0])).not.toContain(TOKEN_B);
  });
  it("buildCall never contains the token", () => {
    expect(JSON.stringify(discordConnector.buildCall({ operation: "get_current_user" }))).not.toContain(TOKEN);
  });
  it("never leaks the token into results", async () => {
    const r = await run({ operation: "send_message", params: { channel_id: CH, content: "x" } }, capture(MSG).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from provider errors", async () => {
    const r = await run({ operation: "get_current_user" }, capture({ code: 0, message: `bad ${TOKEN}` }, { status: 400 }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`failed Bot ${TOKEN}`);
    }) as unknown as typeof fetch;
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("keeps the token out of emitted log events", async () => {
    const events: unknown[] = [];
    await run({ operation: "get_current_user" }, capture({ message: `x ${TOKEN}` }, { status: 500 }).fetchImpl, creds, { onEvent: (e) => void events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
  it("redacts bot_token fields", () => {
    expect(JSON.stringify(redact({ bot_token: TOKEN, authorization: `Bot ${TOKEN}` }))).not.toContain(TOKEN);
  });
  it("propagates the trace id on success and failure", async () => {
    const good = await run({ operation: "get_current_user" }, capture({ id: USER }).fetchImpl);
    const bad = await run({ operation: "get_current_user" }, capture({ code: 0, message: "x" }, { status: 403 }).fetchImpl);
    expect(good.traceId).toBe(trace);
    expect(bad.traceId).toBe(trace);
  });
  it("tags log events with the trace id", async () => {
    const events: { traceId: string }[] = [];
    await run({ operation: "get_current_user" }, capture({ id: USER }).fetchImpl, creds, { onEvent: (e) => void events.push(e) });
    expect(events.every((e) => e.traceId === trace)).toBe(true);
  });
  it("documents every unsupported operation with a reason", () => {
    for (const reason of Object.values(UNSUPPORTED_OPERATIONS)) expect(reason.length).toBeGreaterThan(20);
    expect(Object.keys(UNSUPPORTED_OPERATIONS)).toContain("gateway_events");
  });
});
