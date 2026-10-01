import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Google Drive API v3 normalizers (https://developers.google.com/drive/api/reference/rest/v3).
 * Pure functions: no I/O, no credentials, no business logic.
 */

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Google Workspace MIME types handled as Drive files (metadata + export only). */
export const WORKSPACE_MIME = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
  form: "application/vnd.google-apps.form",
  drawing: "application/vnd.google-apps.drawing",
} as const;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function workspaceKind(mimeType: unknown): keyof typeof WORKSPACE_MIME | "folder" | null {
  if (mimeType === DRIVE_FOLDER_MIME) return "folder";
  for (const [kind, mime] of Object.entries(WORKSPACE_MIME)) if (mime === mimeType) return kind as keyof typeof WORKSPACE_MIME;
  return null;
}

function person(value: unknown) {
  const p = asRecord(value);
  return { name: str(p["displayName"]), email: str(p["emailAddress"]), permission_id: str(p["permissionId"]), me: p["me"] === true };
}

export function normalizeDriveFile(value: unknown): Record<string, unknown> {
  const f = asRecord(value);
  const kind = workspaceKind(f["mimeType"]);
  return {
    id: str(f["id"]),
    name: str(f["name"]),
    mime_type: str(f["mimeType"]),
    is_folder: kind === "folder",
    workspace_type: kind && kind !== "folder" ? kind : null,
    parents: Array.isArray(f["parents"]) ? (f["parents"] as unknown[]).map(String) : [],
    drive_id: str(f["driveId"]),
    location: str(f["driveId"]) ? "shared_drive" : "my_drive",
    size: num(f["size"]),
    trashed: f["trashed"] === true,
    starred: f["starred"] === true,
    created_at: str(f["createdTime"]),
    modified_at: str(f["modifiedTime"]),
    web_view_link: str(f["webViewLink"]),
    md5: str(f["md5Checksum"]),
    owners: Array.isArray(f["owners"]) ? (f["owners"] as unknown[]).map(person) : [],
    version: str(f["version"]) ?? (num(f["version"]) === null ? null : String(f["version"])),
  };
}

export function normalizeDriveAbout(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  const q = asRecord(a["storageQuota"]);
  return {
    user: person(a["user"]),
    email: str(asRecord(a["user"])["emailAddress"]),
    storage: { limit: num(q["limit"]), usage: num(q["usage"]), usage_in_drive: num(q["usageInDrive"]), usage_in_trash: num(q["usageInDriveTrash"]) },
    can_create_drives: a["canCreateDrives"] === true,
  };
}

export function normalizeDrivePermission(value: unknown): Record<string, unknown> {
  const p = asRecord(value);
  return {
    id: str(p["id"]),
    type: str(p["type"]),
    role: str(p["role"]),
    email: str(p["emailAddress"]),
    domain: str(p["domain"]),
    display_name: str(p["displayName"]),
    expiration_time: str(p["expirationTime"]),
    deleted: p["deleted"] === true,
  };
}

export function normalizeSharedDrive(value: unknown): Record<string, unknown> {
  const d = asRecord(value);
  return { id: str(d["id"]), name: str(d["name"]), created_at: str(d["createdTime"]), hidden: d["hidden"] === true, location: "shared_drive" };
}

export function normalizeDriveChange(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    change_type: str(c["changeType"]),
    file_id: str(c["fileId"]),
    drive_id: str(c["driveId"]),
    removed: c["removed"] === true,
    time: str(c["time"]),
    file: c["file"] ? normalizeDriveFile(c["file"]) : null,
  };
}

export function normalizeDriveChannel(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  const exp = num(c["expiration"]);
  return {
    channel_id: str(c["id"]),
    resource_id: str(c["resourceId"]),
    resource_uri: str(c["resourceUri"]),
    expiration: exp === null ? null : new Date(exp).toISOString(),
    expiration_ms: exp,
  };
}

/** Official `X-Goog-*` push headers. The body is empty: notifications carry no file data. */
export type DrivePush = {
  channelId?: string;
  token?: string;
  resourceId?: string;
  resourceState?: string;
  resourceUri?: string;
  messageNumber?: string;
  expirationMs?: number;
  changed?: string;
};

export function parseDrivePushHeaders(headers: Record<string, string>): DrivePush {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const g = (name: string) => (h[name] && h[name].trim() ? h[name].trim() : undefined);
  const exp = g("x-goog-channel-expiration");
  const expirationMs = exp ? Date.parse(exp) : NaN;
  const out: DrivePush = {};
  const set = <K extends keyof DrivePush>(k: K, v: DrivePush[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("channelId", g("x-goog-channel-id"));
  set("token", g("x-goog-channel-token"));
  set("resourceId", g("x-goog-resource-id"));
  set("resourceState", g("x-goog-resource-state"));
  set("resourceUri", g("x-goog-resource-uri"));
  set("messageNumber", g("x-goog-message-number"));
  set("changed", g("x-goog-changed"));
  if (Number.isFinite(expirationMs)) out.expirationMs = expirationMs;
  return out;
}

export const DRIVE_RESOURCE_STATES = ["sync", "add", "remove", "update", "trash", "untrash", "change"] as const;
