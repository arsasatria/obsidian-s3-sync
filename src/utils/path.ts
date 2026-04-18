export function normalizePathSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function decodePathSegment(segment: string): string {
  return decodeURIComponent(segment);
}

export function encodeRemotePath(path: string): string {
  return normalizePathSlashes(path)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodePathSegment)
    .join("/");
}

export function joinRemoteKey(prefix: string, path: string): string {
  const safePrefix = encodeRemotePath(prefix).replace(/\/?$/, "/");
  const normalizedPath = encodeRemotePath(path);
  if (!prefix) {
    return normalizedPath;
  }
  return `${safePrefix}${normalizedPath}`.replace(/\/{2,}/g, "/");
}

export function remoteKeyToPath(prefix: string, key: string): string | null {
  const normalizedKey = normalizePathSlashes(key);
  const normalizedPrefix = prefix ? `${encodeRemotePath(prefix).replace(/\/+$/, "")}/` : "";
  if (normalizedPrefix && !normalizedKey.startsWith(normalizedPrefix)) {
    return null;
  }
  const relativeKey = normalizedPrefix ? normalizedKey.slice(normalizedPrefix.length) : normalizedKey;
  return relativeKey
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodePathSegment)
    .join("/");
}

export function manifestKey(prefix: string): string {
  return joinRemoteKey(prefix, ".s3sync/manifest.json");
}

export function ensureFolderPath(path: string): string[] {
  const parts = normalizePathSlashes(path).split("/").slice(0, -1);
  const folders: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    folders.push(parts.slice(0, index + 1).join("/"));
  }
  return folders;
}

export function conflictPath(originalPath: string, deviceId: string, timestamp: string): string {
  const normalized = normalizePathSlashes(originalPath);
  const lastDot = normalized.lastIndexOf(".");
  const suffix = `.conflict-${deviceId}-${timestamp}`;
  if (lastDot <= 0) {
    return `${normalized}${suffix}`;
  }
  return `${normalized.slice(0, lastDot)}${suffix}${normalized.slice(lastDot)}`;
}

export function safetySnapshotPath(originalPath: string, reason: string, timestamp: string): string {
  const normalized = normalizePathSlashes(originalPath);
  return `.s3sync-safety/${normalized}.snapshot-${reason}-${timestamp}`;
}

export function manualActionBackupPath(actionId: string, side: "local" | "remote", originalPath: string): string {
  const normalized = normalizePathSlashes(originalPath);
  return `.s3sync-actions/${actionId}/${side}/${normalized}`;
}

export function manualActionRootPath(actionId: string): string {
  return `.s3sync-actions/${actionId}`;
}
