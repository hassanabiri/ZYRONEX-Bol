import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { TELEGRAM_API_HOST, UNSUPPORTED_OPERATIONS, telegramConnector } from "@/lib/connectors/adapters/telegram";
import {
  TELEGRAM_UPDATE_TYPES,
  normalizeTelegramMessage,
  normalizeTelegramUpdate,
  telegramEventType,
} from "@/lib/connectors/adapters/telegram-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-telegram";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const TOKEN_B = "987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsbb";
const SECRET = "zyronex_webhook-secret_1";
const CHAT = 424242;
const creds = { access_token: TOKEN };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}
function capture(response: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return jsonResponse(response, init);
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
  return runConnectorOperation({ adapter: telegramConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const ok = (result: unknown) => ({ ok: true, result });
const MSG = { message_id: 10, date: 1_700_000_000, chat: { id: CHAT, type: "private", first_name: "Sara" }, from: { id: 7, is_bot: false, first_name: "Sara" }, text: "hi" };

function verify(payload: unknown, opts: { header?: string | null; secret?: string | null; nowMs?: number } = {}) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {};
  if (opts.header !== null) headers["x-telegram-bot-api-secret-token"] = opts.header ?? SECRET;
  return verifyWebhook("telegram", {
    raw,
    headers,
    payload: JSON.parse(raw) as unknown,
    secret: opts.secret === undefined ? SECRET : opts.secret,
    nowMs: opts.nowMs ?? 1_700_000_100_000,
    replayWindowMs: 300_000,
  });
}

// ---------------------------------------------------------------------------
describe("telegram registration", () => {
  it("is registered with aliases", () => {
    expect(getConnector("telegram")?.id).toBe("telegram");
    expect(getConnector("telegram_bot")?.id).toBe("telegram");
  });
  it("describes itself without credential values", () => {
    const d = describeConnectors().find((c) => c.id === "telegram");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
    expect(JSON.stringify(d)).not.toContain(TOKEN);
  });
  it("declares messaging, files, webhook, pagination and health capabilities", () => {
    expect(telegramConnector.capabilities).toEqual(expect.arrayContaining(["messaging", "files", "webhook", "pagination", "health_check"]));
    expect(telegramConnector.healthOperation).toBe("get_me");
  });
  it("catalog stores the bot token as a secret field", () => {
    const p = PROVIDERS.find((x) => x.id === "telegram");
    expect(p?.credentialFields.find((f) => f.key === "bot_token")?.secret).toBe(true);
    expect(p?.credentialFields.find((f) => f.key === "webhook_secret_token")?.secret).toBe(true);
  });
  it("documents unsupported operations and never exposes them", () => {
    expect(Object.keys(UNSUPPORTED_OPERATIONS).length).toBeGreaterThanOrEqual(8);
    for (const [op, reason] of Object.entries(UNSUPPORTED_OPERATIONS)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(telegramConnector.operations).not.toContain(op);
      expect(() => telegramConnector.buildCall({ operation: op })).toThrow(/Unknown Telegram operation/);
    }
  });
  it("contains no AI, business, CRM or database logic", () => {
    for (const f of ["telegram.ts", "telegram-map.ts"]) {
      const src = readFileSync(`src/lib/connectors/adapters/${f}`, "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
      expect(src).not.toMatch(/supabase|workspace|openai|gemini|\bagent\b|crm/i);
    }
  });
  it("only targets the official Bot API host", () => {
    for (const op of telegramConnector.operations) {
      const src = readFileSync("src/lib/connectors/adapters/telegram.ts", "utf8");
      expect(src).not.toMatch(/https:\/\/(?!api\.telegram\.org|core\.telegram\.org)[a-z0-9.-]+\.[a-z]+\/bot/i);
      expect(op).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("telegram bot authentication", () => {
  it("injects the token only into the request path", async () => {
    const { calls, fetchImpl } = capture(ok({ id: 1, is_bot: true, first_name: "Z", username: "zyronex_bot" }));
    await run({ operation: "get_me" }, fetchImpl);
    expect(calls[0]?.url).toBe(`${TELEGRAM_API_HOST}/bot${TOKEN}/getMe`);
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBeNull();
  });
  it("accepts bot_token via the vault alias (access_token)", async () => {
    const { calls, fetchImpl } = capture(ok({ id: 1, is_bot: true, first_name: "Z" }));
    const r = await run({ operation: "get_me" }, fetchImpl, { access_token: TOKEN, bot_token: TOKEN });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toContain(TOKEN);
  });
  it("fails fast when the token is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "get_me" }, fetchImpl, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects a malformed token before any network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "get_me" }, fetchImpl, { access_token: "not-a-token" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("maps 401 Unauthorized to a non-retryable auth error", async () => {
    const { fetchImpl } = capture({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("auth");
      expect(r.error.retryable).toBe(false);
    }
  });
});

describe("telegram connection account / bot management", () => {
  it.each([
    ["get_my_commands", "getMyCommands", {}],
    ["set_my_commands", "setMyCommands", { commands: [{ command: "start", description: "Start" }] }],
    ["delete_my_commands", "deleteMyCommands", {}],
    ["get_my_name", "getMyName", {}],
    ["set_my_name", "setMyName", { name: "ZYRONEX" }],
    ["get_my_description", "getMyDescription", {}],
    ["set_my_description", "setMyDescription", { description: "d" }],
    ["get_my_short_description", "getMyShortDescription", {}],
    ["set_my_short_description", "setMyShortDescription", { short_description: "s" }],
  ])("%s calls %s", async (operation, method, params) => {
    const { calls, fetchImpl } = capture(ok(true));
    const r = await run({ operation, params }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true);
  });
  it("set_my_commands requires commands", () => {
    expect(() => telegramConnector.buildCall({ operation: "set_my_commands" })).toThrow(/commands/);
  });
});

describe("telegram getMe / health", () => {
  it("normalizes getMe", async () => {
    const { fetchImpl } = capture(ok({ id: 5, is_bot: true, first_name: "Z", username: "zyronex_bot" }));
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "5", isBot: true, username: "zyronex_bot" });
  });
  it("health is healthy on getMe", async () => {
    const { fetchImpl } = capture(ok({ id: 5, is_bot: true, first_name: "Z" }));
    const h = await checkConnectorHealth({ adapter: telegramConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(true);
  });
  it("health is unhealthy on a revoked token without leaking it", async () => {
    const { fetchImpl } = capture({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` }, { status: 401 });
    const h = await checkConnectorHealth({ adapter: telegramConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(false);
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});

describe("telegram send message", () => {
  it("sends text with parse mode and thread id", async () => {
    const { calls, fetchImpl } = capture(ok(MSG));
    const r = await run({ operation: "send_message", params: { chat_id: CHAT, text: "hi", parse_mode: "HTML", message_thread_id: 3 } }, fetchImpl);
    expect(calls[0]?.url.endsWith("/sendMessage")).toBe(true);
    expect(body(calls[0])).toMatchObject({ chat_id: CHAT, text: "hi", parse_mode: "HTML", message_thread_id: 3 });
    expect(r.ok && r.items[0]).toMatchObject({ id: `${CHAT}:10`, chatId: String(CHAT), kind: "text", text: "hi" });
  });
  it("accepts @channel usernames", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: "@zyronex_news", text: "x" } })).not.toThrow();
  });
  it.each([["abc"], ["@a"], ["12 34"]])("rejects invalid chat id %s", (chat_id) => {
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id, text: "x" } })).toThrow(/chat id/);
  });
  it("rejects unknown parse modes", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", parse_mode: "RTF" } })).toThrow(/parse_mode/);
  });
  it("requires text", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT } })).toThrow(/text/);
  });
  it("drops undeclared params", () => {
    const call = telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", evil: 1 } });
    expect(call.body).not.toHaveProperty("evil");
  });
  it.each([
    ["send_location", "sendLocation", { latitude: 24.7, longitude: 46.6 }],
    ["send_venue", "sendVenue", { latitude: 24.7, longitude: 46.6, title: "HQ", address: "Riyadh" }],
    ["send_contact", "sendContact", { phone_number: "+966500000000", first_name: "Sara" }],
    ["send_poll", "sendPoll", { question: "Q?", options: [{ text: "a" }, { text: "b" }] }],
    ["send_dice", "sendDice", {}],
    ["forward_message", "forwardMessage", { from_chat_id: 1, message_id: 2 }],
  ])("%s calls %s", async (operation, method, params) => {
    const { calls, fetchImpl } = capture(ok(MSG));
    const r = await run({ operation, params: { chat_id: CHAT, ...params } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true);
  });
  it("copy_message returns the new message id", async () => {
    const { fetchImpl } = capture(ok({ message_id: 99 }));
    const r = await run({ operation: "copy_message", params: { chat_id: CHAT, from_chat_id: 1, message_id: 2 } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ message_id: 99 });
  });
  it("send_chat_action validates the official action list", async () => {
    const { calls, fetchImpl } = capture(ok(true));
    await run({ operation: "send_chat_action", params: { chat_id: CHAT, action: "typing" } }, fetchImpl);
    expect(body(calls[0])["action"]).toBe("typing");
    expect(() => telegramConnector.buildCall({ operation: "send_chat_action", params: { chat_id: CHAT, action: "dancing" } })).toThrow(/action/);
  });
});

describe("telegram replies and threading", () => {
  it("send_reply sets official reply_parameters", async () => {
    const { calls, fetchImpl } = capture(ok({ ...MSG, reply_to_message: { message_id: 5 } }));
    const r = await run({ operation: "send_reply", params: { chat_id: CHAT, text: "re", reply_to_message_id: 5 } }, fetchImpl);
    expect(body(calls[0])["reply_parameters"]).toEqual({ message_id: 5 });
    expect(r.ok && r.items[0]).toMatchObject({ replyToMessageId: 5 });
  });
  it("keeps extra reply_parameters (quote) and forum thread", () => {
    const call = telegramConnector.buildCall({
      operation: "send_reply",
      params: { chat_id: CHAT, text: "re", reply_to_message_id: 5, reply_parameters: { quote: "hi" }, message_thread_id: 9 },
    });
    expect(call.body).toMatchObject({ reply_parameters: { quote: "hi", message_id: 5 }, message_thread_id: 9 });
  });
  it("rejects an invalid reply target", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_reply", params: { chat_id: CHAT, text: "x", reply_to_message_id: "abc" } })).toThrow(/reply_to_message_id/);
  });
  it("normalizes thread id from messages", () => {
    expect(normalizeTelegramMessage({ ...MSG, message_thread_id: 12 }).threadId).toBe(12);
  });
});

describe("telegram media and files", () => {
  it.each([
    ["send_photo", "sendPhoto", "photo"],
    ["send_video", "sendVideo", "video"],
    ["send_audio", "sendAudio", "audio"],
    ["send_voice", "sendVoice", "voice"],
    ["send_document", "sendDocument", "document"],
    ["send_animation", "sendAnimation", "animation"],
    ["send_video_note", "sendVideoNote", "video_note"],
    ["send_sticker", "sendSticker", "sticker"],
  ])("%s sends by file_id or https URL", async (operation, method, field) => {
    const { calls, fetchImpl } = capture(ok({ ...MSG, text: undefined, [field]: { file_id: "F1" } }));
    const r = await run({ operation, params: { chat_id: CHAT, [field]: "https://cdn.example.com/a.bin" } }, fetchImpl);
    expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true);
    expect(r.ok && r.items[0]).toMatchObject({ fileIds: ["F1"] });
  });
  it("rejects plain http media URLs", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_photo", params: { chat_id: CHAT, photo: "http://x.dev/a.jpg" } })).toThrow(/https/);
  });
  it("rejects multipart attach:// uploads (unsupported)", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_document", params: { chat_id: CHAT, document: "attach://file" } })).toThrow(/multipart/);
  });
  it("picks the largest photo size's file_id", () => {
    const m = normalizeTelegramMessage({ ...MSG, text: undefined, photo: [{ file_id: "small" }, { file_id: "large" }], caption: "c" });
    expect(m).toMatchObject({ kind: "photo", fileIds: ["large"], caption: "c" });
  });
  it("send_media_group validates 2–10 items and returns a list", async () => {
    const { fetchImpl } = capture(ok([MSG, { ...MSG, message_id: 11 }]));
    const media = [{ type: "photo", media: "F1" }, { type: "photo", media: "https://x.dev/b.jpg" }];
    const r = await run({ operation: "send_media_group", params: { chat_id: CHAT, media } }, fetchImpl);
    expect(r.ok && r.items).toHaveLength(2);
    expect(() => telegramConnector.buildCall({ operation: "send_media_group", params: { chat_id: CHAT, media: [media[0]] } })).toThrow(/2–10/);
  });
  it("get_file returns file_path but never a token-bearing download URL", async () => {
    const { fetchImpl } = capture(ok({ file_id: "F1", file_unique_id: "U1", file_size: 10, file_path: "photos/file_1.jpg" }));
    const r = await run({ operation: "get_file", params: { file_id: "F1" } }, fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ fileId: "F1", fileUniqueId: "U1", fileSize: 10, filePath: "photos/file_1.jpg" });
    expect(JSON.stringify(r)).not.toContain("/file/bot");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("telegram edit / delete", () => {
  it("edits text by chat_id + message_id", async () => {
    const { calls, fetchImpl } = capture(ok({ ...MSG, text: "new", edit_date: 1_700_000_050 }));
    const r = await run({ operation: "edit_message_text", params: { chat_id: CHAT, message_id: 10, text: "new" } }, fetchImpl);
    expect(calls[0]?.url.endsWith("/editMessageText")).toBe(true);
    expect(r.ok).toBe(true);
  });
  it("edits inline messages by inline_message_id (result true)", async () => {
    const { fetchImpl } = capture(ok(true));
    const r = await run({ operation: "edit_message_caption", params: { inline_message_id: "IM1", caption: "c" } }, fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ result: true });
  });
  it("requires a target to edit", () => {
    expect(() => telegramConnector.buildCall({ operation: "edit_message_text", params: { text: "x" } })).toThrow(/inline_message_id/);
  });
  it("edit_message_media validates the input file", () => {
    expect(() => telegramConnector.buildCall({ operation: "edit_message_media", params: { chat_id: CHAT, message_id: 1, media: { type: "photo", media: "F" } } })).not.toThrow();
  });
  it("maps the official 48h edit refusal to invalid_request", async () => {
    const { fetchImpl } = capture({ ok: false, error_code: 400, description: "Bad Request: message can't be edited" }, { status: 400 });
    const r = await run({ operation: "edit_message_text", params: { chat_id: CHAT, message_id: 1, text: "x" } }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("deletes a message", async () => {
    const { calls, fetchImpl } = capture(ok(true));
    const r = await run({ operation: "delete_message", params: { chat_id: CHAT, message_id: 10 } }, fetchImpl);
    expect(calls[0]?.url.endsWith("/deleteMessage")).toBe(true);
    expect(r.ok && r.items[0]).toEqual({ ok: true });
  });
  it("delete_messages enforces 1–100 ids", () => {
    expect(() => telegramConnector.buildCall({ operation: "delete_messages", params: { chat_id: CHAT, message_ids: [] } })).toThrow(/1–100/);
    expect(() => telegramConnector.buildCall({ operation: "delete_messages", params: { chat_id: CHAT, message_ids: [1, 2] } })).not.toThrow();
  });
  it.each([
    ["set_message_reaction", "setMessageReaction", { message_id: 1, reaction: [{ type: "emoji", emoji: "👍" }] }],
    ["pin_chat_message", "pinChatMessage", { message_id: 1 }],
    ["unpin_chat_message", "unpinChatMessage", {}],
  ])("%s calls %s", async (operation, method, params) => {
    const { calls, fetchImpl } = capture(ok(true));
    await run({ operation, params: { chat_id: CHAT, ...params } }, fetchImpl);
    expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true);
  });
});

describe("telegram keyboards and callback queries", () => {
  it("accepts an inline keyboard", () => {
    const reply_markup = { inline_keyboard: [[{ text: "Yes", callback_data: "y" }, { text: "Site", url: "https://z.ai" }]] };
    const call = telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "?", reply_markup } });
    expect(call.body).toMatchObject({ reply_markup });
  });
  it("accepts a reply keyboard, remove_keyboard and force_reply", () => {
    for (const reply_markup of [{ keyboard: [[{ text: "A" }]], resize_keyboard: true }, { remove_keyboard: true }, { force_reply: true }])
      expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", reply_markup } })).not.toThrow();
  });
  it("rejects malformed keyboards", () => {
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", reply_markup: { inline_keyboard: [{}] } } })).toThrow(/rows/);
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", reply_markup: { inline_keyboard: [[{ callback_data: "a" }]] } } })).toThrow(/text/);
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", reply_markup: { foo: 1 } } })).toThrow(/reply_markup/);
  });
  it("enforces the 64-byte callback_data limit", () => {
    const reply_markup = { inline_keyboard: [[{ text: "t", callback_data: "x".repeat(65) }]] };
    expect(() => telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", reply_markup } })).toThrow(/64 bytes/);
  });
  it("edits only the reply markup", async () => {
    const { calls, fetchImpl } = capture(ok(MSG));
    await run({ operation: "edit_message_reply_markup", params: { chat_id: CHAT, message_id: 10, reply_markup: { inline_keyboard: [] } } }, fetchImpl);
    expect(calls[0]?.url.endsWith("/editMessageReplyMarkup")).toBe(true);
  });
  it("answers a callback query", async () => {
    const { calls, fetchImpl } = capture(ok(true));
    const r = await run({ operation: "answer_callback_query", params: { callback_query_id: "cb1", text: "Done", show_alert: false } }, fetchImpl);
    expect(body(calls[0])).toEqual({ callback_query_id: "cb1", text: "Done", show_alert: false });
    expect(r.ok).toBe(true);
  });
  it("normalizes callback_query updates", () => {
    const u = normalizeTelegramUpdate({ update_id: 1, callback_query: { id: "cb1", data: "y", from: { id: 7, first_name: "S" }, message: MSG } });
    expect(u).toMatchObject({ type: "callback_query", event: "callback_query", chatId: String(CHAT), callbackQuery: { id: "cb1", data: "y" } });
  });
});

describe("telegram chats and contacts", () => {
  it("normalizes get_chat", async () => {
    const { fetchImpl } = capture(ok({ id: -100123, type: "supergroup", title: "Team" }));
    const r = await run({ operation: "get_chat", params: { chat_id: -100123 } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "-100123", type: "supergroup", title: "Team" });
  });
  it.each([["get_chat_member", "getChatMember", { user_id: 7 }], ["get_chat_member_count", "getChatMemberCount", {}]])("%s calls %s", async (operation, method, params) => {
    const { calls, fetchImpl } = capture(ok(operation === "get_chat_member" ? { status: "member", user: { id: 7 } } : 12));
    const r = await run({ operation, params: { chat_id: CHAT, ...params } }, fetchImpl);
    expect(calls[0]?.url.endsWith(`/${method}`)).toBe(true);
    expect(r.ok).toBe(true);
  });
});

describe("telegram webhook management", () => {
  it("set_webhook sends the secret_token and allowed updates", async () => {
    const { calls, fetchImpl } = capture(ok(true));
    await run({ operation: "set_webhook", params: { url: "https://x.dev/api/public/webhooks/tg", secret_token: SECRET, allowed_updates: ["message", "callback_query"] } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ url: "https://x.dev/api/public/webhooks/tg", secret_token: SECRET });
  });
  it("set_webhook rejects http URLs and invalid secret tokens", () => {
    expect(() => telegramConnector.buildCall({ operation: "set_webhook", params: { url: "http://x.dev" } })).toThrow(/https/);
    expect(() => telegramConnector.buildCall({ operation: "set_webhook", params: { url: "https://x.dev", secret_token: "bad token!" } })).toThrow(/secret_token/);
  });
  it("normalizes get_webhook_info", async () => {
    const { fetchImpl } = capture(ok({ url: "https://x.dev", has_custom_certificate: false, pending_update_count: 2, last_error_date: 1_700_000_000, last_error_message: "timeout" }));
    const r = await run({ operation: "get_webhook_info" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ url: "https://x.dev", pendingUpdateCount: 2, lastErrorMessage: "timeout" });
  });
  it("delete_webhook", async () => {
    const { calls, fetchImpl } = capture(ok(true));
    await run({ operation: "delete_webhook", params: { drop_pending_updates: true } }, fetchImpl);
    expect(calls[0]?.url.endsWith("/deleteWebhook")).toBe(true);
  });
  it("getUpdates while a webhook is active maps 409 to invalid_request", async () => {
    const { fetchImpl } = capture({ ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" }, { status: 409 });
    const r = await run({ operation: "get_updates" }, fetchImpl);
    expect(!r.ok && r.error).toMatchObject({ kind: "invalid_request", retryable: false });
  });
});

describe("telegram pagination / offset", () => {
  it("getUpdates uses short polling and the official offset", () => {
    const call = telegramConnector.buildCall({ operation: "get_updates", params: { limit: 2 }, cursor: "51" });
    expect(call.body).toMatchObject({ limit: 2, timeout: 0, offset: 51 });
  });
  it("follows update_id + 1 across pages until a short page", async () => {
    let n = 0;
    const offsets: unknown[] = [];
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      offsets.push(JSON.parse(String(init?.body))["offset"]);
      n += 1;
      return jsonResponse(ok(n === 1 ? [{ update_id: 1, message: MSG }, { update_id: 2, message: MSG }] : [{ update_id: 3, message: MSG }]));
    }) as unknown as typeof fetch;
    const r = await run({ operation: "get_updates", params: { limit: 2 }, maxPages: 5 }, fetchImpl);
    expect(offsets).toEqual([undefined, 3]);
    expect(r.ok && r.items).toHaveLength(3);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("returns a resume cursor when the page budget is exhausted", async () => {
    const { fetchImpl } = capture(ok([{ update_id: 7, message: MSG }, { update_id: 8, message: MSG }]));
    const r = await run({ operation: "get_updates", params: { limit: 2 }, maxPages: 1 }, fetchImpl);
    expect(r.ok && r.cursor).toBe("9");
  });
  it("clamps limit to the official 1–100 range", () => {
    expect((telegramConnector.buildCall({ operation: "get_updates", params: { limit: 500 } }).body as Record<string, unknown>)["limit"]).toBe(100);
  });
  it("profile photos page by offset + count against total_count", async () => {
    const { fetchImpl } = capture(ok({ total_count: 3, photos: [[{ file_id: "a" }], [{ file_id: "b" }]] }));
    const r = await run({ operation: "get_user_profile_photos", params: { user_id: 7, limit: 2 }, maxPages: 1 }, fetchImpl);
    expect(r.ok && r.cursor).toBe("2");
    expect(r.ok && r.items[0]).toMatchObject({ sizes: [{ fileId: "a" }] });
  });
  it("rejects a non-list getUpdates result", async () => {
    const { fetchImpl } = capture(ok({}));
    const r = await run({ operation: "get_updates" }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
});

describe("telegram rate limits and retry", () => {
  it("honours parameters.retry_after on 429 and retries", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ ok: false, error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }, { status: 429 }),
      () => jsonResponse(ok(MSG)),
    );
    const r = await run({ operation: "send_message", params: { chat_id: CHAT, text: "x" } }, fetchImpl, creds, { sleep: async (ms) => void sleeps.push(ms) });
    expect(count()).toBe(2);
    expect(r.ok).toBe(true);
    expect(sleeps[0]).toBe(3000);
  });
  it("reads retry_after into rate-limit info", () => {
    expect(telegramConnector.readRateLimit?.(new Headers(), { parameters: { retry_after: 5 } })).toEqual({ retryAfterMs: 5000 });
  });
  it("falls back to standard headers", () => {
    expect(telegramConnector.readRateLimit?.(new Headers({ "retry-after": "2" }), {})?.retryAfterMs).toBe(2000);
  });
  it("retries 5xx with backoff", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ ok: false, error_code: 502, description: "Bad Gateway" }, { status: 502 }),
      () => jsonResponse(ok(MSG)),
    );
    const r = await run({ operation: "send_message", params: { chat_id: CHAT, text: "x" } }, fetchImpl);
    expect(count()).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("gives up after max attempts", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ ok: false, error_code: 500, description: "Internal" }, { status: 500 }));
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok).toBe(false);
    expect(count()).toBe(3);
  });
  it("does not retry 400 errors", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 }));
    await run({ operation: "send_message", params: { chat_id: CHAT, text: "x" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("retries network failures", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("ECONNRESET");
      return jsonResponse(ok(MSG));
    }) as unknown as typeof fetch;
    const r = await run({ operation: "send_message", params: { chat_id: CHAT, text: "x" } }, fetchImpl);
    expect(r.ok).toBe(true);
  });
});

describe("telegram error normalization", () => {
  it.each([
    [403, "Forbidden: bot was blocked by the user", "forbidden"],
    [404, "Not Found", "not_found"],
    [400, "Bad Request: message text is empty", "invalid_request"],
    [409, "Conflict", "invalid_request"],
    [429, "Too Many Requests", "rate_limit"],
    [500, "Internal Server Error", "provider"],
  ])("%i → %s", (code, description, kind) => {
    expect(telegramConnector.mapError?.(code, { ok: false, error_code: code, description })?.kind).toBe(kind);
  });
  it("returns null for successful envelopes", () => {
    expect(telegramConnector.mapError?.(200, ok(true))).toBeNull();
  });
  it("treats ok:false with HTTP 200 as an error", () => {
    expect(telegramConnector.mapError?.(200, { ok: false, error_code: 400, description: "x" })?.kind).toBe("invalid_request");
  });
  it("rejects malformed envelopes", async () => {
    const { fetchImpl } = capture({ hello: "world" });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
  it("unknown operations are unsupported", async () => {
    const r = await run({ operation: "teleport" }, vi.fn() as unknown as typeof fetch);
    expect(!r.ok && r.error.kind).toBe("unsupported");
  });
});

describe("telegram webhooks — verification", () => {
  const update = { update_id: 1001, message: { ...MSG, date: 1_700_000_050 } };
  it("accepts the official secret token header", () => {
    expect(verify(update)).toMatchObject({ ok: true, eventId: "update:1001", eventType: "message.received" });
  });
  it("rejects a missing header", () => {
    expect(verify(update, { header: null })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a wrong token", () => {
    expect(verify(update, { header: "other" })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("fails closed without a configured secret", () => {
    expect(verify(update, { secret: null })).toMatchObject({ ok: false, reason: "missing_secret" });
  });
  it("rejects payloads without update_id", () => {
    expect(verify({ message: MSG })).toMatchObject({ ok: false, reason: "malformed_payload" });
  });
  it("rejects unknown update types", () => {
    expect(verify({ update_id: 5, teleport: {} })).toMatchObject({ ok: false, reason: "unsupported_event" });
  });
});

describe("telegram webhooks — replay protection", () => {
  it("rejects updates older than Telegram's 24h retention", () => {
    const old = { update_id: 1, message: { ...MSG, date: 1_700_000_000 } };
    expect(verify(old, { nowMs: 1_700_000_000_000 + 25 * 3600_000 })).toMatchObject({ ok: false, reason: "replay" });
  });
  it("accepts legitimate Telegram redeliveries within 24h", () => {
    const retried = { update_id: 1, message: { ...MSG, date: 1_700_000_000 } };
    expect(verify(retried, { nowMs: 1_700_000_000_000 + 2 * 3600_000 }).ok).toBe(true);
  });
  it("uses edit_date for edited messages", () => {
    const edited = { update_id: 2, edited_message: { ...MSG, date: 1_600_000_000, edit_date: 1_700_000_000 } };
    expect(verify(edited, { nowMs: 1_700_000_100_000 })).toMatchObject({ ok: true, eventType: "message.edited", timestampMs: 1_700_000_000_000 });
  });
  it("undated updates (inline_query) rely on update_id dedupe", () => {
    expect(verify({ update_id: 3, inline_query: { id: "q", from: { id: 1 }, query: "x" } })).toMatchObject({ ok: true, eventType: "inline_query" });
  });
});

describe("telegram webhooks — event types and dedupe", () => {
  it.each([
    ["message", "message.received"],
    ["edited_message", "message.edited"],
    ["channel_post", "channel_post.received"],
    ["edited_channel_post", "channel_post.edited"],
    ["callback_query", "callback_query"],
    ["message_reaction", "message.reaction"],
    ["my_chat_member", "my_chat_member"],
    ["chat_join_request", "chat_join_request"],
    ["poll_answer", "poll_answer"],
    ["pre_checkout_query", "pre_checkout_query"],
  ])("%s → %s", (type, event) => {
    expect(telegramEventType({ update_id: 1, [type]: {} })).toBe(event);
  });
  it("recognises every documented Update type", () => {
    for (const t of TELEGRAM_UPDATE_TYPES) expect(telegramEventType({ update_id: 1, [t]: {} })).toBeDefined();
  });
  it("same update_id yields the same event id (duplicate delivery)", () => {
    const u = { update_id: 77, message: { ...MSG, date: 1_700_000_050 } };
    expect(verify(u).eventId).toBe(verify({ ...u }).eventId);
  });
  it("different update_ids yield different event ids", () => {
    expect(verify({ update_id: 1, message: { ...MSG, date: 1_700_000_050 } }).eventId).not.toBe(
      verify({ update_id: 2, message: { ...MSG, date: 1_700_000_050 } }).eventId,
    );
  });
  it("event id is still produced on failed verification (for audit)", () => {
    expect(verify({ update_id: 9, message: MSG }, { header: "bad" }).eventId).toBe("update:9");
  });
});

describe("telegram webhooks — normalization", () => {
  it("normalizes message updates", () => {
    const u = normalizeTelegramUpdate({ update_id: 5, message: MSG });
    expect(u).toMatchObject({ updateId: 5, type: "message", event: "message.received", chatId: String(CHAT), from: { id: "7" }, message: { text: "hi" } });
  });
  it("normalizes member updates without a message", () => {
    const u = normalizeTelegramUpdate({ update_id: 6, my_chat_member: { chat: { id: -1, type: "group" }, from: { id: 7 } } });
    expect(u).toMatchObject({ type: "my_chat_member", message: null, chatId: "-1" });
  });
  it("getUpdates items share the webhook shape", async () => {
    const { fetchImpl } = capture(ok([{ update_id: 1, message: MSG }]));
    const r = await run({ operation: "get_updates" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ updateId: 1, event: "message.received" });
  });
});

describe("telegram idempotency", () => {
  it("inbound idempotency uses only the official update_id", () => {
    expect(verify({ update_id: 123, message: { ...MSG, date: 1_700_000_050 } }).eventId).toBe("update:123");
  });
  it("never invents an idempotency header on outbound calls", () => {
    const call = telegramConnector.buildCall({ operation: "send_message", params: { chat_id: CHAT, text: "x", idempotency_key: "k" } });
    expect(Object.keys(call.headers).join(",")).not.toMatch(/idempot/i);
    expect(call.body).not.toHaveProperty("idempotency_key");
  });
  it("documents the missing official idempotency mechanism", () => {
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/update_id/);
  });
});

describe("telegram isolation, redaction and tracing", () => {
  it("never mixes two workspaces' bot tokens", async () => {
    const a = capture(ok(MSG));
    const b = capture(ok(MSG));
    await run({ operation: "send_message", params: { chat_id: CHAT, text: "a" } }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "send_message", params: { chat_id: CHAT, text: "b" } }, b.fetchImpl, { access_token: TOKEN_B });
    expect(a.calls[0]?.url).toContain(TOKEN);
    expect(a.calls[0]?.url).not.toContain(TOKEN_B);
    expect(b.calls[0]?.url).toContain(TOKEN_B);
  });
  it("ignores tokens smuggled through params", async () => {
    const { calls, fetchImpl } = capture(ok(MSG));
    await run({ operation: "send_message", params: { chat_id: CHAT, text: "x", access_token: TOKEN_B, bot_token: TOKEN_B } }, fetchImpl);
    expect(calls[0]?.url).toContain(TOKEN);
    expect(calls[0]?.url + String(calls[0]?.init.body)).not.toContain(TOKEN_B);
  });
  it("buildCall never contains the token (placeholder only)", () => {
    const call = telegramConnector.buildCall({ operation: "get_me" });
    expect(call.url).not.toContain(TOKEN);
    expect(call.url).toContain("placeholder");
  });
  it("never leaks the token into results", async () => {
    const { fetchImpl } = capture(ok(MSG));
    const r = await run({ operation: "send_message", params: { chat_id: CHAT, text: "x" } }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from provider error messages", async () => {
    const { fetchImpl } = capture({ ok: false, error_code: 400, description: `bad ${TOKEN}` }, { status: 400 });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from network errors that echo the URL", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      throw new Error(`connect failed ${String(url)}`);
    }) as unknown as typeof fetch;
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("keeps the token out of emitted log events", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = capture({ ok: false, error_code: 500, description: `x ${TOKEN}` }, { status: 500 });
    await run({ operation: "get_me" }, fetchImpl, creds, { onEvent: (e) => void events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
  it("redacts bot_token fields in objects", () => {
    expect(JSON.stringify(redact({ bot_token: TOKEN, access_token: TOKEN }))).not.toContain(TOKEN);
  });
  it("propagates the trace id on success and failure", async () => {
    const good = await run({ operation: "get_me" }, capture(ok({ id: 1, is_bot: true, first_name: "Z" })).fetchImpl);
    const bad = await run({ operation: "get_me" }, capture({ ok: false, error_code: 403, description: "x" }, { status: 403 }).fetchImpl);
    expect(good.traceId).toBe(trace);
    expect(bad.traceId).toBe(trace);
  });
  it("tags log events with the trace id", async () => {
    const events: { traceId: string }[] = [];
    await run({ operation: "get_me" }, capture(ok({ id: 1, is_bot: true, first_name: "Z" })).fetchImpl, creds, { onEvent: (e) => void events.push(e) });
    expect(events.every((e) => e.traceId === trace)).toBe(true);
  });
});
