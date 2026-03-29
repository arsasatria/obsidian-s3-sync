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
