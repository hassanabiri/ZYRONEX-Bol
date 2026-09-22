/**
 * WhatsApp Business Cloud → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no CRM decisions — the connector
 * layer turns Meta's payload shapes into the same neutral shapes the rest of
 * ZYRONEX (workflows, agents, CRM) already consumes for the commerce
 * connectors.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Cloud API timestamps are unix seconds as a string. */
function timestamp(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return raw;
  return new Date(seconds * 1000).toISOString();
}

export type NormalizedWhatsAppContact = {
  object: "contact";
  source: "whatsapp";
  wa_id: string | null;
  phone: string | null;
  name: string | null;
  input: string | null;
};

export type NormalizedWhatsAppMessage = {
  object: "message";
  source: "whatsapp";
  id: string | null;
  direction: "inbound" | "outbound";
  from: string | null;
  to: string | null;
  type: string | null;
  text: string | null;
  /** `context.id` when the customer replied to one of our messages. */
  reply_to: string | null;
  media: { id: string | null; mime_type: string | null; sha256: string | null; caption: string | null } | null;
  timestamp: string | null;
  raw: Record<string, unknown>;
};

export type NormalizedWhatsAppStatus = {
  object: "message_status";
  source: "whatsapp";
  message_id: string | null;
  status: string | null;
  recipient: string | null;
  conversation_id: string | null;
  pricing_category: string | null;
  timestamp: string | null;
  errors: { code: string | null; title: string | null; details: string | null }[];
};

export type NormalizedWhatsAppSendResult = {
  object: "message_receipt";
  source: "whatsapp";
  id: string | null;
  status: string | null;
  recipient: string | null;
  contact_wa_id: string | null;
};

export type NormalizedWhatsAppTemplate = {
  object: "message_template";
  source: "whatsapp";
  id: string | null;
  name: string | null;
  language: string | null;
  category: string | null;
  status: string | null;
  components: unknown[];
};

export type NormalizedWhatsAppMedia = {
  object: "media";
  source: "whatsapp";
  id: string | null;
  url: string | null;
  mime_type: string | null;
  sha256: string | null;
  file_size: number | null;
};

export type NormalizedWhatsAppPhoneNumber = {
  object: "phone_number";
  source: "whatsapp";
  id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  status: string | null;
};

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];

export function normalizeWhatsAppContact(input: unknown): NormalizedWhatsAppContact | null {
  const source = record(input);
  if (Object.keys(source).length === 0) return null;
  const profile = record(source["profile"]);
  const waId = str(source["wa_id"]);
  return {
    object: "contact",
    source: "whatsapp",
    wa_id: waId,
    phone: waId ? `+${waId.replace(/^\+/, "")}` : null,
    name: str(profile["name"]) ?? str(source["name"]),
    input: str(source["input"]),
  };
}

/** Maps one inbound message from `value.messages[]`. */
export function normalizeWhatsAppMessage(
  input: unknown,
  context: { businessPhone?: string | null } = {},
): NormalizedWhatsAppMessage {
  const source = record(input);
  const type = str(source["type"]);
  const mediaKey = type && MEDIA_TYPES.includes(type) ? type : null;
  const media = mediaKey ? record(source[mediaKey]) : null;

  return {
    object: "message",
    source: "whatsapp",
    id: str(source["id"]),
    direction: "inbound",
    from: str(source["from"]),
    to: str(context.businessPhone ?? null),
    type,
    text:
      str(record(source["text"])["body"]) ??
      str(record(record(source["interactive"])["button_reply"])["title"]) ??
      str(record(record(source["interactive"])["list_reply"])["title"]) ??
      str(record(source["button"])["text"]) ??
      (media ? str(media["caption"]) : null),
    reply_to: str(record(source["context"])["id"]),
    media: media
      ? {
          id: str(media["id"]),
          mime_type: str(media["mime_type"]),
          sha256: str(media["sha256"]),
          caption: str(media["caption"]),
        }
      : null,
    timestamp: timestamp(source["timestamp"]),
    raw: source,
  };
}

/** Maps one delivery/read status from `value.statuses[]`. */
export function normalizeWhatsAppStatus(input: unknown): NormalizedWhatsAppStatus {
  const source = record(input);
  const conversation = record(source["conversation"]);
  const pricing = record(source["pricing"]);
  return {
    object: "message_status",
    source: "whatsapp",
    message_id: str(source["id"]),
    status: str(source["status"]),
    recipient: str(source["recipient_id"]),
    conversation_id: str(conversation["id"]),
    pricing_category: str(pricing["category"]) ?? str(record(conversation["origin"])["type"]),
    timestamp: timestamp(source["timestamp"]),
    errors: array(source["errors"]).map((entry) => {
      const error = record(entry);
      return {
        code: str(error["code"]),
        title: str(error["title"]),
        details: str(record(error["error_data"])["details"]) ?? str(error["message"]),
      };
    }),
  };
}

/** `POST /{phone_number_id}/messages` answers with contacts + messages. */
export function normalizeWhatsAppSendResult(input: unknown): NormalizedWhatsAppSendResult {
  const source = record(input);
  const message = record(array(source["messages"])[0]);
  const contact = record(array(source["contacts"])[0]);
  return {
    object: "message_receipt",
    source: "whatsapp",
    id: str(message["id"]),
    status: str(message["message_status"]) ?? "accepted",
    recipient: str(contact["input"]) ?? str(contact["wa_id"]),
    contact_wa_id: str(contact["wa_id"]),
  };
}

export function normalizeWhatsAppTemplate(input: unknown): NormalizedWhatsAppTemplate {
  const source = record(input);
  return {
    object: "message_template",
    source: "whatsapp",
    id: str(source["id"]),
    name: str(source["name"]),
    language: str(source["language"]),
    category: str(source["category"]),
    status: str(source["status"]),
    components: array(source["components"]),
  };
}

export function normalizeWhatsAppMedia(input: unknown): NormalizedWhatsAppMedia {
  const source = record(input);
  return {
    object: "media",
    source: "whatsapp",
    id: str(source["id"]),
    url: str(source["url"]),
    mime_type: str(source["mime_type"]),
    sha256: str(source["sha256"]),
    file_size: Number.isFinite(Number(source["file_size"])) ? Number(source["file_size"]) : null,
  };
}

export function normalizeWhatsAppPhoneNumber(input: unknown): NormalizedWhatsAppPhoneNumber {
  const source = record(input);
  return {
    object: "phone_number",
    source: "whatsapp",
    id: str(source["id"]),
    display_phone_number: str(source["display_phone_number"]),
    verified_name: str(source["verified_name"]),
    quality_rating: str(source["quality_rating"]),
    status: str(source["status"]) ?? str(source["code_verification_status"]),
  };
}

export type NormalizedWhatsAppWebhookEvent = {
  event: string | null;
  field: string | null;
  business_account_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  contacts: NormalizedWhatsAppContact[];
  messages: NormalizedWhatsAppMessage[];
  statuses: NormalizedWhatsAppStatus[];
  errors: { code: string | null; title: string | null; details: string | null }[];
  resource: Record<string, unknown>;
};

/**
 * Normalizes the official `entry[].changes[].value` envelope. Meta batches
 * several messages and statuses into one delivery, so every array is preserved
 * — the runtime, not the connector, decides what to do with them.
 */
export function normalizeWhatsAppWebhookEvent(payload: unknown): NormalizedWhatsAppWebhookEvent {
  const body = record(payload);
  const entry = record(array(body["entry"])[0]);
  const change = record(array(entry["changes"])[0]);
  const value = record(change["value"]);
  const metadata = record(value["metadata"]);
  const businessPhone = str(metadata["display_phone_number"]);

  const messages = array(value["messages"]).map((item) => normalizeWhatsAppMessage(item, { businessPhone }));
  const statuses = array(value["statuses"]).map((item) => normalizeWhatsAppStatus(item));

  return {
    event: messages.length ? "message.received" : statuses.length ? "message.status" : str(change["field"]),
    field: str(change["field"]),
    business_account_id: str(entry["id"]),
    phone_number_id: str(metadata["phone_number_id"]),
    display_phone_number: businessPhone,
    contacts: array(value["contacts"])
      .map((item) => normalizeWhatsAppContact(item))
      .filter((item): item is NormalizedWhatsAppContact => item !== null),
    messages,
    statuses,
    errors: array(value["errors"]).map((entryError) => {
      const error = record(entryError);
      return {
        code: str(error["code"]),
        title: str(error["title"]),
        details: str(record(error["error_data"])["details"]) ?? str(error["message"]),
      };
    }),
    resource: value,
  };
}
