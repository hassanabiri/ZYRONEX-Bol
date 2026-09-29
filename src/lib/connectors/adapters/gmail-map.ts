import { ConnectorError } from "@/lib/connectors/errors";
import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Gmail pure helpers: RFC 2822 / MIME composition for `messages.send` /
 * `drafts.*` (the official `raw` field), base64url codecs, and normalizers for
 * the official Gmail API resources. No I/O, no business logic.
 */

// ---- base64url --------------------------------------------------------------
export function toBase64Url(input: string | Uint8Array): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
}

// ---- MIME composition -------------------------------------------------------
export type GmailAttachmentInput = { filename: string; mime_type?: string; content_base64: string };

export type GmailComposeInput = {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  in_reply_to?: string;
  references?: string | string[];
  attachments?: GmailAttachmentInput[];
};

/** Gmail's documented cap for a message sent through the JSON `raw` field path. */
export const GMAIL_MAX_RAW_BYTES = 5 * 1024 * 1024;

const RESERVED_HEADERS = new Set([
  "from", "to", "cc", "bcc", "reply-to", "subject", "mime-version", "content-type",
  "content-transfer-encoding", "in-reply-to", "references",
]);

function assertHeaderSafe(name: string, value: string) {
  if (/[\r\n]/.test(value) || /[\r\n:]/.test(name))
    throw new ConnectorError("invalid_request", `Header "${name.replace(/[\r\n]/g, "")}" contains a line break`, {
      retryable: false,
    });
}

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function addressList(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : value.split(",")).map((v) => v.trim()).filter(Boolean);
  return list.length ? list.join(", ") : undefined;
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function textPart(mime: "text/plain" | "text/html", content: string): string {
  return [
    `Content-Type: ${mime}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(content, "utf8").toString("base64")),
  ].join("\r\n");
}

let boundarySeq = 0;
function boundary(tag: string): string {
  boundarySeq = (boundarySeq + 1) % 1_000_000;
  return `zyx_${tag}_${Date.now().toString(36)}_${boundarySeq}`;
}

function multipart(type: string, parts: string[], b: string): string {
  return [`Content-Type: multipart/${type}; boundary="${b}"`, "", ...parts.map((p) => `--${b}\r\n${p}`), `--${b}--`].join(
    "\r\n",
  );
}

/** Builds an RFC 2822 message string (not yet base64url-encoded). */
export function buildMimeMessage(input: GmailComposeInput): string {
  const headers: string[] = [];
  const push = (name: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    assertHeaderSafe(name, value);
    headers.push(`${name}: ${value}`);
  };
  push("From", input.from);
  push("To", addressList(input.to));
  push("Cc", addressList(input.cc));
  push("Bcc", addressList(input.bcc));
  push("Reply-To", input.reply_to);
  if (input.subject !== undefined) push("Subject", encodeHeader(input.subject));
  push("In-Reply-To", input.in_reply_to);
  const refs = Array.isArray(input.references) ? input.references.join(" ") : input.references;
  push("References", refs);
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (RESERVED_HEADERS.has(name.toLowerCase())) continue;
    push(name, encodeHeader(String(value)));
  }
  headers.push("MIME-Version: 1.0");

  const hasText = typeof input.text === "string";
  const hasHtml = typeof input.html === "string";
  let bodyPart: string;
  if (hasText && hasHtml) bodyPart = multipart("alternative", [textPart("text/plain", input.text!), textPart("text/html", input.html!)], boundary("alt"));
  else if (hasHtml) bodyPart = textPart("text/html", input.html!);
  else bodyPart = textPart("text/plain", input.text ?? "");

  const attachments = input.attachments ?? [];
  let content = bodyPart;
  if (attachments.length) {
    const parts = [bodyPart];
    for (const a of attachments) {
      if (!a || typeof a.filename !== "string" || typeof a.content_base64 !== "string" || !a.filename)
        throw new ConnectorError("invalid_request", "Each attachment needs filename and content_base64", { retryable: false });
      assertHeaderSafe("filename", a.filename);
      const mime = a.mime_type ?? "application/octet-stream";
      assertHeaderSafe("mime_type", mime);
      const name = encodeHeader(a.filename).replace(/"/g, "");
      const data = a.content_base64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
        throw new ConnectorError("invalid_request", `Attachment "${a.filename}" is not valid base64`, { retryable: false });
      parts.push(
        [
          `Content-Type: ${mime}; name="${name}"`,
          `Content-Disposition: attachment; filename="${name}"`,
          "Content-Transfer-Encoding: base64",
          "",
          wrap76(data),
        ].join("\r\n"),
      );
    }
    content = multipart("mixed", parts, boundary("mix"));
  }
  return `${headers.join("\r\n")}\r\n${content}`;
}

/** Encodes a MIME message for Gmail's `raw` field and enforces the size cap. */
export function encodeRaw(mime: string): string {
  const bytes = Buffer.byteLength(mime, "utf8");
  if (bytes > GMAIL_MAX_RAW_BYTES)
    throw new ConnectorError(
      "invalid_request",
      `Message is ${bytes} bytes; the JSON send path accepts up to ${GMAIL_MAX_RAW_BYTES} bytes (larger needs the media upload endpoint)`,
      { retryable: false },
    );
  return toBase64Url(mime);
}

// ---- Normalizers ------------------------------------------------------------
type Part = Record<string, unknown>;

function headerMap(payload: Part): Record<string, string> {
  const out: Record<string, string> = {};
  const list = payload["headers"];
  if (Array.isArray(list))
    for (const h of list) {
      const r = asRecord(h);
      if (typeof r["name"] === "string" && typeof r["value"] === "string") out[r["name"].toLowerCase()] = r["value"];
    }
  return out;
}

function walk(part: Part, acc: { text?: string; html?: string; attachments: Record<string, unknown>[] }) {
  const mime = String(part["mimeType"] ?? "");
  const body = asRecord(part["body"]);
  const filename = typeof part["filename"] === "string" ? part["filename"] : "";
  if (filename || (typeof body["attachmentId"] === "string" && !mime.startsWith("multipart/"))) {
    acc.attachments.push({
      part_id: part["partId"] ?? null,
      filename,
      mime_type: mime || null,
      size: typeof body["size"] === "number" ? body["size"] : null,
      attachment_id: typeof body["attachmentId"] === "string" ? body["attachmentId"] : null,
    });
  } else if (typeof body["data"] === "string") {
    if (mime === "text/plain" && acc.text === undefined) acc.text = fromBase64Url(body["data"]);
    else if (mime === "text/html" && acc.html === undefined) acc.html = fromBase64Url(body["data"]);
  }
  const parts = part["parts"];
  if (Array.isArray(parts)) for (const p of parts) walk(asRecord(p), acc);
}

export function normalizeGmailMessage(value: unknown): Record<string, unknown> {
  const m = asRecord(value);
  const payload = asRecord(m["payload"]);
  const h = headerMap(payload);
  const acc: { text?: string; html?: string; attachments: Record<string, unknown>[] } = { attachments: [] };
  if (Object.keys(payload).length) walk(payload, acc);
  const internal = Number(m["internalDate"]);
  return {
    id: m["id"] ?? null,
    thread_id: m["threadId"] ?? null,
    label_ids: Array.isArray(m["labelIds"]) ? m["labelIds"] : [],
    snippet: m["snippet"] ?? null,
    history_id: m["historyId"] ?? null,
    internal_date: Number.isFinite(internal) && m["internalDate"] !== undefined ? new Date(internal).toISOString() : null,
    size_estimate: m["sizeEstimate"] ?? null,
    from: h["from"] ?? null,
    to: h["to"] ?? null,
    cc: h["cc"] ?? null,
    bcc: h["bcc"] ?? null,
    subject: h["subject"] ?? null,
    date: h["date"] ?? null,
    message_id_header: h["message-id"] ?? null,
    in_reply_to: h["in-reply-to"] ?? null,
    references: h["references"] ?? null,
    text: acc.text ?? null,
    html: acc.html ?? null,
    attachments: acc.attachments,
    ...(typeof m["raw"] === "string" ? { raw: m["raw"] } : {}),
  };
}

export function normalizeGmailThread(value: unknown): Record<string, unknown> {
  const t = asRecord(value);
  const messages = Array.isArray(t["messages"]) ? t["messages"].map(normalizeGmailMessage) : [];
  return {
    id: t["id"] ?? null,
    snippet: t["snippet"] ?? null,
    history_id: t["historyId"] ?? null,
    message_count: messages.length,
    messages,
  };
}

export function normalizeGmailLabel(value: unknown): Record<string, unknown> {
  const l = asRecord(value);
  return {
    id: l["id"] ?? null,
    name: l["name"] ?? null,
    type: l["type"] ?? null,
    message_list_visibility: l["messageListVisibility"] ?? null,
    label_list_visibility: l["labelListVisibility"] ?? null,
    messages_total: l["messagesTotal"] ?? null,
    messages_unread: l["messagesUnread"] ?? null,
    threads_total: l["threadsTotal"] ?? null,
    threads_unread: l["threadsUnread"] ?? null,
    color: l["color"] ?? null,
  };
}

export function normalizeGmailDraft(value: unknown): Record<string, unknown> {
  const d = asRecord(value);
  return { id: d["id"] ?? null, message: d["message"] ? normalizeGmailMessage(d["message"]) : null };
}

export function normalizeGmailProfile(value: unknown): Record<string, unknown> {
  const p = asRecord(value);
  return {
    id: p["emailAddress"] ?? null,
    email_address: p["emailAddress"] ?? null,
    messages_total: p["messagesTotal"] ?? null,
    threads_total: p["threadsTotal"] ?? null,
    history_id: p["historyId"] ?? null,
  };
}

export function normalizeGmailHistory(value: unknown): Record<string, unknown> {
  const h = asRecord(value);
  const ids = (key: string) =>
    Array.isArray(h[key]) ? (h[key] as unknown[]).map((e) => asRecord(asRecord(e)["message"])["id"]).filter(Boolean) : [];
  return {
    id: h["id"] ?? null,
    message_ids: Array.isArray(h["messages"]) ? (h["messages"] as unknown[]).map((m) => asRecord(m)["id"]) : [],
    messages_added: ids("messagesAdded"),
    messages_deleted: ids("messagesDeleted"),
    labels_added: ids("labelsAdded"),
    labels_removed: ids("labelsRemoved"),
  };
}

// ---- Pub/Sub push notifications ---------------------------------------------
/**
 * Gmail push notifications arrive as a Cloud Pub/Sub push envelope whose
 * `message.data` is base64 JSON `{ emailAddress, historyId }`. It is only a
 * change signal — it never contains the message itself.
 */
export function parseGmailPush(payload: unknown): {
  messageId?: string;
  publishTime?: string;
  subscription?: string;
  emailAddress?: string;
  historyId?: string;
} {
  const body = asRecord(payload);
  const message = asRecord(body["message"]);
  const out: ReturnType<typeof parseGmailPush> = {};
  const id = message["messageId"] ?? message["message_id"];
  if (typeof id === "string" && id) out.messageId = id;
  const publish = message["publishTime"] ?? message["publish_time"];
  if (typeof publish === "string") out.publishTime = publish;
  if (typeof body["subscription"] === "string") out.subscription = body["subscription"];
  if (typeof message["data"] === "string") {
    try {
      const data = asRecord(JSON.parse(fromBase64Url(message["data"])));
      if (typeof data["emailAddress"] === "string") out.emailAddress = data["emailAddress"];
      if (data["historyId"] !== undefined) out.historyId = String(data["historyId"]);
    } catch {
      /* malformed data is reported by the verifier */
    }
  }
  return out;
}
