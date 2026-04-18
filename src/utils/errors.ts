export function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("file does not exist") ||
    normalized.includes("enoent") ||
    normalized.includes("no such file") ||
    normalized.includes("not found")
  );
}

export function isMissingRemoteObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("nosuchkey") ||
    normalized.includes("status=404") ||
    normalized.includes("404") && normalized.includes("unknownerror") ||
    normalized.includes("missing remote object") ||
    normalized.includes("not found")
  );
}
