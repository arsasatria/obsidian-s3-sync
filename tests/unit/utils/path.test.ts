import { describe, expect, it } from "vitest";
import { conflictPath, encodeRemotePath, ensureFolderPath, joinRemoteKey, manifestKey, normalizePathSlashes, safetySnapshotPath } from "../../../src/utils/path";

describe("path utils", () => {
  it("normalizes path separators", () => {
    expect(normalizePathSlashes("\\Notes\\a.md")).toBe("Notes/a.md");
  });

  it("joins remote keys and manifest keys", () => {
    expect(joinRemoteKey("vault-a", "Notes/a.md")).toBe("vault-a/Notes/a.md");
    expect(manifestKey("vault-a")).toBe("vault-a/.s3sync/manifest.json");
    expect(joinRemoteKey("", "Notes/a.md")).toBe("Notes/a.md");
    expect(encodeRemotePath("02 📥 Notes/tes.md")).toBe("02%20%F0%9F%93%A5%20Notes/tes.md");
    expect(joinRemoteKey("vault-a", "02 📥 Notes/tes.md")).toBe("vault-a/02%20%F0%9F%93%A5%20Notes/tes.md");
  });

  it("builds folder chains and conflict paths", () => {
    expect(ensureFolderPath("Notes/sub/a.md")).toEqual(["Notes", "Notes/sub"]);
    expect(conflictPath("Notes/a.md", "device-a", "now")).toBe("Notes/a.conflict-device-a-now.md");
    expect(conflictPath("README", "device-a", "now")).toBe("README.conflict-device-a-now");
    expect(safetySnapshotPath("Notes/a.md", "before-download", "now")).toBe(".s3sync-safety/Notes/a.md.snapshot-before-download-now");
  });
});
