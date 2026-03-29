import { describe, expect, it } from "vitest";
import { buildLocalState } from "../../../src/core/local-state";
import { ExcludeFilter } from "../../../src/vault/exclude";
import { MockVault } from "../../integration/setup/mock-vault";

describe("buildLocalState", () => {
  it("builds hashes for included files only", async () => {
    const vault = new MockVault();
    vault.addFile("Notes/a.md", "hello", 1000);
    vault.addFile(".trash/deleted.md", "skip", 1000);

    const state = await buildLocalState(vault, new ExcludeFilter([".trash/**"]));

    expect([...state.keys()]).toEqual(["Notes/a.md"]);
    expect(state.get("Notes/a.md")?.size).toBe(5);
  });

  it("skips transiently unreadable files instead of failing the whole scan", async () => {
    class FlakyVault extends MockVault {
      override async readBinary(path: string): Promise<ArrayBuffer> {
        if (path === "Notes/b.md") {
          throw new Error("file is busy");
        }
        return super.readBinary(path);
      }
    }

    const vault = new FlakyVault();
    vault.addFile("Notes/a.md", "hello", 1000);
    vault.addFile("Notes/b.md", "later", 1000);

    const state = await buildLocalState(vault, new ExcludeFilter([]));

    expect(state.has("Notes/a.md")).toBe(true);
    expect(state.has("Notes/b.md")).toBe(false);
  });
});
