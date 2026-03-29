import { describe, expect, it } from "vitest";
import { ConflictResolver } from "../../../src/sync/conflict-resolver";

describe("ConflictResolver", () => {
  it("keeps local when configured", async () => {
    const resolver = new ConflictResolver("keep-local", "device-a");
    await expect(resolver.resolve({ path: "a.md" })).resolves.toEqual({
      path: "a.md",
      type: "upload",
    });
  });

  it("keeps remote when configured", async () => {
    const resolver = new ConflictResolver("keep-remote", "device-a");
    await expect(resolver.resolve({ path: "a.md" })).resolves.toEqual({
      path: "a.md",
      type: "download",
    });
  });

  it("creates a conflict path when keeping both", async () => {
    const resolver = new ConflictResolver("keep-both", "device-a");
    const result = await resolver.resolve({ path: "folder/a.md" });
    expect(result.type).toBe("keep-both");
    expect(result.conflictPath).toContain("folder/a.conflict-device-a-");
  });

  it("uses prompt when ask-user is enabled", async () => {
    const resolver = new ConflictResolver("ask-user", "device-a", async () => "keep-remote");
    await expect(resolver.resolve({ path: "a.md" })).resolves.toEqual({
      path: "a.md",
      type: "download",
    });
  });
});
