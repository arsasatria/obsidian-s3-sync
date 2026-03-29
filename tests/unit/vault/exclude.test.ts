import { describe, expect, it } from "vitest";
import { ExcludeFilter } from "../../../src/vault/exclude";

describe("ExcludeFilter", () => {
  const filter = new ExcludeFilter([
    ".obsidian/workspace.json",
    ".trash/**",
    "*.tmp",
    "Private/**",
  ]);

  it("excludes exact matches", () => {
    expect(filter.isExcluded(".obsidian/workspace.json")).toBe(true);
  });

  it("excludes wildcard extensions", () => {
    expect(filter.isExcluded("notes/draft.tmp")).toBe(true);
  });

  it("excludes folder globs", () => {
    expect(filter.isExcluded(".trash/deleted-note.md")).toBe(true);
    expect(filter.isExcluded("Private/secret.md")).toBe(true);
  });

  it("keeps ordinary files", () => {
    expect(filter.isExcluded("Notes/parenting.md")).toBe(false);
    expect(filter.isExcluded(".obsidian/plugins/something/data.json")).toBe(false);
  });
});
