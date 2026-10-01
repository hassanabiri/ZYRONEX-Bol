import {
  DRIVE_FOLDER_MIME,
  WORKSPACE_MIME,
  normalizeDriveAbout,
  normalizeDriveChange,
  normalizeDriveChannel,
  normalizeDriveFile,
  normalizeDrivePermission,
  normalizeSharedDrive,
} from "@/lib/connectors/adapters/google-drive-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Google Drive connector — official Google Drive API v3 only
 * (https://developers.google.com/drive/api/reference/rest/v3).
 *
 * Owns authentication, API calls, normalization, `pageToken`/`nextPageToken`
 * pagination and error mapping. No AI, business logic or database access.
 * Registered as `google_drive_api` so the existing `google_drive` → `google`
 * catalog alias (generic Google connector) keeps its current behavior.
 */

export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DRIVES_MAX_LIMIT = 100;
const PERMISSIONS_MAX_LIMIT = 100;

/** Documented Drive scopes, from narrowest to broadest. */
export const DRIVE_SCOPES = {
  metadata_readonly: "https://www.googleapis.com/auth/drive.metadata.readonly",
  readonly: "https://www.googleapis.com/auth/drive.readonly",
  /** Per-file access to files created or opened by this app. */
  file: "https://www.googleapis.com/auth/drive.file",
  /** Full Drive — only for operations on arbitrary files/shared drives the app did not create. */
  full: "https://www.googleapis.com/auth/drive",
} as const;
type ScopeKey = keyof typeof DRIVE_SCOPES;

/** files.export only returns text bodies the JSON/text runtime can carry losslessly. */
export const TEXT_EXPORT_MIME = ["text/plain", "text/csv", "text/tab-separated-values", "text/html", "text/markdown", "image/svg+xml", "application/vnd.google-apps.script+json"];

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  upload_file_content:
    "Content upload uses /upload/drive/v3 with uploadType=media|multipart|resumable (raw or multipart binary bodies); the JSON runtime creates metadata-only files and folders.",
  resumable_upload: "Resumable uploads need session URIs and chunked binary PUTs that the JSON runtime does not carry.",
  update_file_content: "Replacing file content needs a media/multipart upload to /upload/drive/v3/files/{id}.",
  download_file:
    "files.get?alt=media returns arbitrary binary bytes; the runtime decodes responses as text, so binary download is not offered (metadata and webViewLink are returned instead).",
  export_binary:
    "files.export to binary formats (PDF, DOCX, XLSX, PPTX, images) returns bytes the text runtime cannot carry; only text export MIME types are supported.",
  export_over_10mb: "files.export is limited by Google to 10 MB of exported content.",
  edit_document_content: "Editing Docs/Sheets/Slides content needs the Docs/Sheets/Slides APIs, which are separate connectors outside this phase.",
  google_forms_responses: "Form questions and responses live in the Google Forms API; Drive exposes Forms as files (metadata, permissions, trash) only.",
  idempotency_key:
    "The Drive API publishes no idempotency header; duplicate writes stay guarded by ZYRONEX execution idempotency and results carry Drive file/permission ids.",
  push_payload_contains_file: "Drive push notifications carry only X-Goog-* headers and an empty body; read the change with changes.list / files.get.",
  bypass_sharing_policy: "Sharing is always subject to Google Workspace admin policies; the connector never retries or escalates a denied permission change.",
  transfer_ownership_consumer:
    "Ownership transfer between consumer accounts needs a pending-owner acceptance flow; only the documented transferOwnership flag is passed through and Google enforces its rules.",
  shared_drive_admin_access: "useDomainAdminAccess needs Workspace admin privileges and is not exposed.",
  empty_trash: "files.emptyTrash permanently deletes every trashed file and needs the full drive scope; it is not exposed as a connector operation.",
};

type Kind = "file" | "files" | "about" | "permission" | "permissions" | "drive" | "drives" | "changes" | "start_token" | "channel" | "export" | "empty";

type Spec = {
  verb: HttpMethod;
  path: (p: Record<string, unknown>) => string;
  kind: Kind;
  scope: ScopeKey;
  required?: string[];
  collection?: string;
  paginated?: boolean;
  maxLimit?: number;
  /** Query params: snake_case input → Drive name. */
  query?: Record<string, string>;
  /** Fixed query params (e.g. supportsAllDrives). */
  fixed?: (p: Record<string, unknown>) => Record<string, string>;
  body?: (p: Record<string, unknown>) => unknown;
  validate?: (p: Record<string, unknown>) => void;
};

const enc = (v: unknown) => encodeURIComponent(String(v));
const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

const FILE_FIELDS =
  "id,name,mimeType,parents,driveId,size,trashed,starred,createdTime,modifiedTime,webViewLink,md5Checksum,owners(displayName,emailAddress,permissionId,me),version";
const ALL_DRIVES = () => ({ supportsAllDrives: "true" });
const withFields = (fields: string) => () => ({ supportsAllDrives: "true", fields });

/** Escapes a literal for the Drive `q` grammar (backslash and single quote). */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Builds an official Drive `q` expression from structured filters. Only
 * documented terms are used: name, mimeType, parents, trashed, modifiedTime,
 * owners and fullText. A raw `query` is passed through untouched.
 */
export function buildDriveQuery(p: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof p["query"] === "string" && p["query"].trim()) parts.push(`(${p["query"].trim()})`);
  if (typeof p["name"] === "string") parts.push(`name = '${escapeQueryValue(p["name"])}'`);
  if (typeof p["name_contains"] === "string") parts.push(`name contains '${escapeQueryValue(p["name_contains"])}'`);
  if (typeof p["mime_type"] === "string") parts.push(`mimeType = '${escapeQueryValue(p["mime_type"])}'`);
  if (typeof p["parent_id"] === "string") parts.push(`'${escapeQueryValue(p["parent_id"])}' in parents`);
  if (typeof p["owner"] === "string") parts.push(`'${escapeQueryValue(p["owner"])}' in owners`);
  if (typeof p["full_text"] === "string") parts.push(`fullText contains '${escapeQueryValue(p["full_text"])}'`);
  if (typeof p["modified_after"] === "string") {
    if (!Number.isFinite(Date.parse(p["modified_after"]))) throw invalid("`modified_after` must be an RFC 3339 timestamp");
    parts.push(`modifiedTime > '${new Date(p["modified_after"]).toISOString()}'`);
  }
  if (typeof p["modified_before"] === "string") {
    if (!Number.isFinite(Date.parse(p["modified_before"]))) throw invalid("`modified_before` must be an RFC 3339 timestamp");
    parts.push(`modifiedTime < '${new Date(p["modified_before"]).toISOString()}'`);
  }
  if (p["folders_only"] === true) parts.push(`mimeType = '${DRIVE_FOLDER_MIME}'`);
  if (typeof p["trashed"] === "boolean") parts.push(`trashed = ${p["trashed"]}`);
  else if (p["include_trashed"] !== true) parts.push("trashed = false");
  return parts.length ? parts.join(" and ") : undefined;
}

/** Corpus selection: My Drive (user) vs one shared drive vs everything. */
function listFixed(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { supportsAllDrives: "true", fields: `nextPageToken,files(${FILE_FIELDS})` };
  const q = buildDriveQuery(p);
  if (q) out["q"] = q;
  if (typeof p["drive_id"] === "string") {
    out["corpora"] = "drive";
    out["driveId"] = p["drive_id"];
    out["includeItemsFromAllDrives"] = "true";
  } else if (p["corpora"] === "allDrives") {
    out["corpora"] = "allDrives";
    out["includeItemsFromAllDrives"] = "true";
  } else out["corpora"] = "user";
  return out;
}

function metadataBody(p: Record<string, unknown>, create: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p["name"] !== undefined) out["name"] = p["name"];
  if (p["description"] !== undefined) out["description"] = p["description"];
  if (p["starred"] !== undefined) out["starred"] = p["starred"];
  if (p["properties"] !== undefined) out["properties"] = p["properties"];
  if (p["app_properties"] !== undefined) out["appProperties"] = p["app_properties"];
  if (create) {
    if (p["mime_type"] !== undefined) out["mimeType"] = p["mime_type"];
    if (typeof p["parent_id"] === "string") out["parents"] = [p["parent_id"]];
  }
  return out;
}

function noContent(p: Record<string, unknown>) {
  if (p["content"] !== undefined || p["content_base64"] !== undefined)
    throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["upload_file_content"]}`, { retryable: false });
}

function moveFixed(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { supportsAllDrives: "true", fields: FILE_FIELDS };
  out["addParents"] = String(p["new_parent_id"]);
  if (p["old_parent_id"] !== undefined) out["removeParents"] = String(p["old_parent_id"]);
  return out;
}

const PERMISSION_TYPES = ["user", "group", "domain", "anyone"];
const PERMISSION_ROLES = ["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"];

function permissionBody(p: Record<string, unknown>, create: boolean) {
  const out: Record<string, unknown> = {};
  if (p["role"] !== undefined) {
    if (!PERMISSION_ROLES.includes(String(p["role"]))) throw invalid(`\`role\` must be one of ${PERMISSION_ROLES.join(", ")}`);
    out["role"] = p["role"];
  }
  if (create) {
    if (!PERMISSION_TYPES.includes(String(p["type"]))) throw invalid(`\`type\` must be one of ${PERMISSION_TYPES.join(", ")}`);
    out["type"] = p["type"];
    if ((p["type"] === "user" || p["type"] === "group") && typeof p["email"] !== "string") throw invalid("`email` is required for user/group permissions");
    if (p["type"] === "domain" && typeof p["domain"] !== "string") throw invalid("`domain` is required for domain permissions");
    if (p["email"] !== undefined) out["emailAddress"] = p["email"];
    if (p["domain"] !== undefined) out["domain"] = p["domain"];
    if (p["allow_file_discovery"] !== undefined) out["allowFileDiscovery"] = p["allow_file_discovery"];
  }
  if (p["expiration_time"] !== undefined) out["expirationTime"] = p["expiration_time"];
  return out;
}

function permissionFixed(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { supportsAllDrives: "true" };
  if (p["send_notification_email"] !== undefined) out["sendNotificationEmail"] = String(p["send_notification_email"] === true);
  if (p["email_message"] !== undefined) out["emailMessage"] = String(p["email_message"]);
  if (p["transfer_ownership"] === true) out["transferOwnership"] = "true";
  return out;
}

function watchBody(p: Record<string, unknown>) {
  const body: Record<string, unknown> = { id: p["channel_id"], type: "web_hook", address: p["address"] };
  if (typeof p["address"] !== "string" || !/^https:\/\//.test(p["address"])) throw invalid("`address` must be an HTTPS URL");
  if (p["channel_token"] !== undefined) body["token"] = p["channel_token"];
  if (p["expiration_ms"] !== undefined) body["expiration"] = String(p["expiration_ms"]);
  return body;
}

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / health -----------------------------------------------------
  get_about: {
    verb: "GET", path: () => "/about", kind: "about", scope: "metadata_readonly",
    fixed: () => ({ fields: "user,storageQuota,canCreateDrives" }),
  },

  // ---- Files -----------------------------------------------------------------
  list_files: { verb: "GET", path: () => "/files", kind: "files", collection: "files", paginated: true, fixed: listFixed, scope: "metadata_readonly", query: { order_by: "orderBy" } },
  search_files: {
    verb: "GET", path: () => "/files", kind: "files", collection: "files", paginated: true, fixed: listFixed, scope: "metadata_readonly", query: { order_by: "orderBy" },
    validate: (p) => {
      if (!["query", "name", "name_contains", "mime_type", "parent_id", "owner", "full_text", "modified_after", "modified_before"].some((k) => p[k] !== undefined))
        throw invalid("search_files needs at least one filter");
    },
  },
  get_file: { verb: "GET", path: (p) => `/files/${enc(p["file_id"])}`, kind: "file", required: ["file_id"], fixed: withFields(FILE_FIELDS), scope: "metadata_readonly" },
  create_file: {
    verb: "POST", path: () => "/files", kind: "file", required: ["name"], fixed: withFields(FILE_FIELDS), scope: "file",
    validate: noContent, body: (p) => metadataBody(p, true),
  },
  create_workspace_file: {
    verb: "POST", path: () => "/files", kind: "file", required: ["name", "workspace_type"], fixed: withFields(FILE_FIELDS), scope: "file",
    validate: (p) => {
      if (!(String(p["workspace_type"]) in WORKSPACE_MIME)) throw invalid(`\`workspace_type\` must be one of ${Object.keys(WORKSPACE_MIME).join(", ")}`);
    },
    body: (p) => ({ ...metadataBody(p, true), mimeType: WORKSPACE_MIME[String(p["workspace_type"]) as keyof typeof WORKSPACE_MIME] }),
  },
  update_file: {
    verb: "PATCH", path: (p) => `/files/${enc(p["file_id"])}`, kind: "file", required: ["file_id"], fixed: withFields(FILE_FIELDS), scope: "file",
    validate: (p) => {
      noContent(p);
      if (Object.keys(metadataBody(p, false)).length === 0) throw invalid("update_file needs at least one metadata field");
    },
    body: (p) => metadataBody(p, false),
  },
  copy_file: {
    verb: "POST", path: (p) => `/files/${enc(p["file_id"])}/copy`, kind: "file", required: ["file_id"], fixed: withFields(FILE_FIELDS), scope: "file",
    body: (p) => metadataBody(p, true),
  },
  move_file: {
    verb: "PATCH", path: (p) => `/files/${enc(p["file_id"])}`, kind: "file", required: ["file_id", "new_parent_id"], fixed: moveFixed, scope: "file", body: () => ({}),
  },
  trash_file: { verb: "PATCH", path: (p) => `/files/${enc(p["file_id"])}`, kind: "file", required: ["file_id"], fixed: withFields(FILE_FIELDS), scope: "file", body: () => ({ trashed: true }) },
  untrash_file: { verb: "PATCH", path: (p) => `/files/${enc(p["file_id"])}`, kind: "file", required: ["file_id"], fixed: withFields(FILE_FIELDS), scope: "file", body: () => ({ trashed: false }) },
  delete_file: { verb: "DELETE", path: (p) => `/files/${enc(p["file_id"])}`, kind: "empty", required: ["file_id"], fixed: ALL_DRIVES, scope: "file" },
  export_file: {
    verb: "GET", path: (p) => `/files/${enc(p["file_id"])}/export`, kind: "export", required: ["file_id", "export_mime_type"], scope: "readonly",
    query: { export_mime_type: "mimeType" },
    validate: (p) => {
      if (!TEXT_EXPORT_MIME.includes(String(p["export_mime_type"])))
        throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["export_binary"]}`, { retryable: false });
    },
  },

  // ---- Folders (official folder MIME type) -----------------------------------
  create_folder: {
    verb: "POST", path: () => "/files", kind: "file", required: ["name"], fixed: withFields(FILE_FIELDS), scope: "file",
    body: (p) => ({ ...metadataBody(p, true), mimeType: DRIVE_FOLDER_MIME }),
  },
  list_folders: {
    verb: "GET", path: () => "/files", kind: "files", collection: "files", paginated: true, scope: "metadata_readonly",
    fixed: (p) => listFixed({ ...p, folders_only: true }), query: { order_by: "orderBy" },
  },
  list_folder_children: {
    verb: "GET", path: () => "/files", kind: "files", collection: "files", paginated: true, required: ["folder_id"], scope: "metadata_readonly",
    fixed: (p) => listFixed({ ...p, parent_id: p["folder_id"] }), query: { order_by: "orderBy" },
  },
  get_folder: { verb: "GET", path: (p) => `/files/${enc(p["folder_id"])}`, kind: "file", required: ["folder_id"], fixed: withFields(FILE_FIELDS), scope: "metadata_readonly" },
  rename_folder: {
    verb: "PATCH", path: (p) => `/files/${enc(p["folder_id"])}`, kind: "file", required: ["folder_id", "name"], fixed: withFields(FILE_FIELDS), scope: "file",
    body: (p) => ({ name: p["name"] }),
  },
  move_folder: {
    verb: "PATCH", path: (p) => `/files/${enc(p["folder_id"])}`, kind: "file", required: ["folder_id", "new_parent_id"], fixed: moveFixed, scope: "file", body: () => ({}),
  },
  trash_folder: { verb: "PATCH", path: (p) => `/files/${enc(p["folder_id"])}`, kind: "file", required: ["folder_id"], fixed: withFields(FILE_FIELDS), scope: "file", body: () => ({ trashed: true }) },
  delete_folder: { verb: "DELETE", path: (p) => `/files/${enc(p["folder_id"])}`, kind: "empty", required: ["folder_id"], fixed: ALL_DRIVES, scope: "file" },

  // ---- Permissions -----------------------------------------------------------
  list_permissions: {
    verb: "GET", path: (p) => `/files/${enc(p["file_id"])}/permissions`, kind: "permissions", collection: "permissions", paginated: true, maxLimit: PERMISSIONS_MAX_LIMIT,
    required: ["file_id"], scope: "metadata_readonly",
    fixed: () => ({ supportsAllDrives: "true", fields: "nextPageToken,permissions(id,type,role,emailAddress,domain,displayName,expirationTime,deleted)" }),
  },
  get_permission: {
    verb: "GET", path: (p) => `/files/${enc(p["file_id"])}/permissions/${enc(p["permission_id"])}`, kind: "permission", required: ["file_id", "permission_id"],
    scope: "metadata_readonly", fixed: () => ({ supportsAllDrives: "true", fields: "id,type,role,emailAddress,domain,displayName,expirationTime,deleted" }),
  },
  create_permission: {
    verb: "POST", path: (p) => `/files/${enc(p["file_id"])}/permissions`, kind: "permission", required: ["file_id", "type", "role"], scope: "file",
    fixed: permissionFixed, body: (p) => permissionBody(p, true),
  },
  update_permission: {
    verb: "PATCH", path: (p) => `/files/${enc(p["file_id"])}/permissions/${enc(p["permission_id"])}`, kind: "permission",
    required: ["file_id", "permission_id"], scope: "file", fixed: permissionFixed,
    validate: (p) => {
      if (p["role"] === undefined && p["expiration_time"] === undefined) throw invalid("update_permission needs `role` or `expiration_time`");
    },
    body: (p) => permissionBody(p, false),
  },
  delete_permission: {
    verb: "DELETE", path: (p) => `/files/${enc(p["file_id"])}/permissions/${enc(p["permission_id"])}`, kind: "empty",
    required: ["file_id", "permission_id"], scope: "file", fixed: ALL_DRIVES,
  },

  // ---- Shared drives ---------------------------------------------------------
  list_shared_drives: {
    verb: "GET", path: () => "/drives", kind: "drives", collection: "drives", paginated: true, maxLimit: DRIVES_MAX_LIMIT, scope: "readonly", query: { query: "q" },
  },
  get_shared_drive: { verb: "GET", path: (p) => `/drives/${enc(p["drive_id"])}`, kind: "drive", required: ["drive_id"], scope: "readonly" },

  // ---- Changes / push --------------------------------------------------------
  get_start_page_token: {
    verb: "GET", path: () => "/changes/startPageToken", kind: "start_token", scope: "metadata_readonly",
    fixed: (p) => ({ supportsAllDrives: "true", ...(typeof p["drive_id"] === "string" ? { driveId: p["drive_id"] } : {}) }),
  },
  list_changes: {
    verb: "GET", path: () => "/changes", kind: "changes", collection: "changes", paginated: true, required: ["page_token"], scope: "metadata_readonly",
    fixed: (p) => ({
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields: `nextPageToken,newStartPageToken,changes(changeType,fileId,driveId,removed,time,file(${FILE_FIELDS}))`,
      ...(typeof p["drive_id"] === "string" ? { driveId: p["drive_id"] } : {}),
      ...(p["include_removed"] === false ? { includeRemoved: "false" } : {}),
    }),
  },
  watch_changes: {
    verb: "POST", path: () => "/changes/watch", kind: "channel", required: ["page_token", "channel_id", "address"], scope: "metadata_readonly",
    fixed: (p) => ({
      pageToken: String(p["page_token"]), supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      ...(typeof p["drive_id"] === "string" ? { driveId: p["drive_id"] } : {}),
    }),
    body: watchBody,
  },
  watch_file: {
    verb: "POST", path: (p) => `/files/${enc(p["file_id"])}/watch`, kind: "channel", required: ["file_id", "channel_id", "address"], scope: "metadata_readonly",
    fixed: ALL_DRIVES, body: watchBody,
  },
  stop_channel: {
    verb: "POST", path: () => "/channels/stop", kind: "empty", required: ["channel_id", "resource_id"], scope: "metadata_readonly",
    body: (p) => ({ id: p["channel_id"], resourceId: p["resource_id"] }),
  },
};

export const DRIVE_OPERATIONS = Object.keys(OPERATIONS);

/** Least-privilege scope for an operation. Writes on files this app did not create need `drive`. */
export function driveScopeFor(operation: string): string | undefined {
  const spec = OPERATIONS[operation];
  return spec ? DRIVE_SCOPES[spec.scope] : undefined;
}

function buildUrl(spec: Spec, params: Record<string, unknown>, cursor: string | null | undefined): string {
  const url = new URL(`${DRIVE_API_BASE}${spec.path(params)}`);
  for (const [k, v] of Object.entries(spec.fixed?.(params) ?? {})) url.searchParams.set(k, v);
  for (const [from, to] of Object.entries(spec.query ?? {})) {
    const value = params[from];
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(to, String(value));
  }
  if (spec.paginated) {
    const max = spec.maxLimit ?? MAX_LIMIT;
    const limit = Math.min(Math.max(Number(params["limit"] ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), max);
    url.searchParams.set("pageSize", String(limit));
    // changes.list: the first page token is the caller's saved token; later pages use nextPageToken.
    if (cursor) url.searchParams.set("pageToken", cursor);
    else if (params["page_token"] !== undefined && spec.kind === "changes") url.searchParams.set("pageToken", String(params["page_token"]));
  }
  return url.toString();
}

function normalizeByKind(kind: Kind, value: unknown): Record<string, unknown> {
  switch (kind) {
    case "file":
    case "files":
      return normalizeDriveFile(value);
    case "about":
      return normalizeDriveAbout(value);
    case "permission":
    case "permissions":
      return normalizeDrivePermission(value);
    case "drive":
    case "drives":
      return normalizeSharedDrive(value);
    case "changes":
      return normalizeDriveChange(value);
    case "channel":
      return normalizeDriveChannel(value);
    default:
      return asRecord(value);
  }
}

const RATE_REASONS = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "sharingRateLimitExceeded"];

export const googleDriveConnector: ConnectorAdapter = {
  id: "google_drive_api",
  label: "Google Drive",
  capabilities: ["read", "write", "search", "pagination", "files", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token"] },
  operations: DRIVE_OPERATIONS,
  healthOperation: "get_about",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Google Drive operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    spec.validate?.(params);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: spec.kind === "export" ? "*/*" : "application/json" };
    if (spec.verb === "GET" || spec.verb === "DELETE" || !spec.body)
      return { method: spec.verb, url, headers, ...(spec.paginated ? { paginated: true } : {}) };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json; charset=utf-8" }, body: spec.body(params) };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Google Drive account is not connected yet", { retryable: false });
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Google's `{ error: { code, message, status, errors:[{reason}] } }` envelope. */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const error = asRecord(asRecord(payload)["error"]);
    const message = String(error["message"] ?? `Google Drive request failed (${status})`);
    const reasons = Array.isArray(error["errors"]) ? (error["errors"] as unknown[]).map((e) => String(asRecord(e)["reason"] ?? "")) : [];
    const gstatus = String(error["status"] ?? "");
    if (status === 401) return { kind: "auth", message: `Google Drive rejected the token: ${message}`, retryable: false };
    if (status === 429 || gstatus === "RESOURCE_EXHAUSTED" || reasons.some((r) => RATE_REASONS.includes(r)))
      return { kind: "rate_limit", message: `Google Drive quota exceeded: ${message}`, retryable: true };
    if (status === 403) {
      if (reasons.includes("insufficientPermissions") || reasons.includes("insufficientFilePermissions") || gstatus === "PERMISSION_DENIED" || /scope/i.test(message))
        return { kind: "forbidden", message: `Google Drive permission or scope missing: ${message}`, retryable: false };
      return { kind: "forbidden", message: `Google Drive denied the request: ${message}`, retryable: false };
    }
    if (status === 404) return { kind: "not_found", message: `Google Drive resource not found: ${message}`, retryable: false };
    if (status >= 500) return { kind: "provider", message: `Google Drive is temporarily unavailable: ${message}`, retryable: true };
    return { kind: "invalid_request", message: `Google Drive rejected the request: ${message}`, retryable: false };
  },

  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) return undefined;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return { retryAfterMs: Math.max(0, seconds) * 1000, remaining: 0 };
    const at = Date.parse(retryAfter);
    return Number.isFinite(at) ? { retryAfterMs: Math.max(0, at - Date.now()), remaining: 0, resetAt: new Date(at).toISOString() } : undefined;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Google Drive operation "${operation}"`, { retryable: false });
    if (spec.kind === "empty") return { items: [{ ok: true, operation }], cursor: null, raw: payload };
    if (spec.kind === "export") {
      if (typeof payload !== "string" && payload !== null)
        return { items: [{ content: JSON.stringify(payload) }], cursor: null, raw: payload };
      return { items: [{ content: payload ?? "" }], cursor: null, raw: payload };
    }
    if (payload === null || typeof payload !== "object")
      throw new ConnectorError("malformed_response", "Google Drive returned a non-JSON body", { retryable: false });
    const body = asRecord(payload);

    if (spec.kind === "start_token") {
      const token = body["startPageToken"];
      if (typeof token !== "string") throw new ConnectorError("malformed_response", "Google Drive response is missing startPageToken", { retryable: false });
      return { items: [{ start_page_token: token }], cursor: null, raw: payload };
    }

    if (!spec.collection) return { items: [normalizeByKind(spec.kind, body)], cursor: null, raw: payload };

    const list = body[spec.collection];
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", `Google Drive response field "${spec.collection}" is not a list`, { retryable: false });
    const next = body["nextPageToken"];
    const items = Array.isArray(list) ? list.map((v) => normalizeByKind(spec.kind, v)) : [];
    // changes.list: the last page carries the official newStartPageToken to persist for the next sync.
    if (spec.kind === "changes" && typeof body["newStartPageToken"] === "string")
      items.push({ type: "sync_state", new_start_page_token: body["newStartPageToken"] });
    return { items, cursor: typeof next === "string" && next.length > 0 ? next : null, raw: payload };
  },
};
