import { describe, expect, it } from "vitest";
import { ThreeWayDiffer } from "../../../src/sync/differ";
import type { FileEntry, LocalFileState } from "../../../src/types/manifest";

describe("ThreeWayDiffer", () => {
  const differ = new ThreeWayDiffer();

  const localFile = (sha256: string, mtime = 1000): LocalFileState => ({ mtime, sha256, size: 100 });
  const remoteFile = (sha256: string, mtime = 1000): FileEntry => ({
    deleted: false,
    etag: sha256,
    mtime,
    sha256,
    size: 100,
  });
  const deletedRemote = (): FileEntry => ({ deleted: true, etag: "", mtime: 0, sha256: "", size: 0 });

  it("returns noop when all states match", () => {
    const result = differ.diff(
      new Map([["notes/a.md", localFile("hash1")]]),
      new Map([["notes/a.md", remoteFile("hash1")]]),
      new Map([["notes/a.md", remoteFile("hash1")]]),
    );
    expect(result).toEqual([{ path: "notes/a.md", type: "noop" }]);
  });

  it("uploads a new local file", () => {
    const result = differ.diff(new Map([["new.md", localFile("hash1")]]), new Map(), new Map());
    expect(result).toEqual([{ path: "new.md", type: "upload" }]);
  });

  it("downloads a new remote file", () => {
    const result = differ.diff(new Map(), new Map(), new Map([["remote.md", remoteFile("hash1")]]));
    expect(result).toEqual([{ path: "remote.md", type: "download" }]);
  });

  it("deletes remote when file was deleted locally without remote changes", () => {
    const result = differ.diff(
      new Map(),
      new Map([["a.md", remoteFile("hash1")]]),
      new Map([["a.md", remoteFile("hash1")]]),
    );
    expect(result).toEqual([{ path: "a.md", type: "delete-remote" }]);
  });

  it("deletes local when file was deleted remotely without local changes", () => {
    const result = differ.diff(
      new Map([["a.md", localFile("hash1")]]),
      new Map([["a.md", remoteFile("hash1")]]),
      new Map([["a.md", deletedRemote()]]),
    );
    expect(result).toEqual([{ path: "a.md", type: "delete-local" }]);
  });

  it("detects conflict when both local and remote changed differently", () => {
    const result = differ.diff(
      new Map([["a.md", localFile("local", 2000)]]),
      new Map([["a.md", remoteFile("base", 1000)]]),
      new Map([["a.md", remoteFile("remote", 1500)]]),
    );
    expect(result[0]).toMatchObject({
      localMtime: 2000,
      path: "a.md",
      remoteMtime: 1500,
      type: "conflict",
    });
  });

  it("handles mixed operations", () => {
    const result = differ.diff(
      new Map([
        ["upload-me.md", localFile("new")],
        ["same.md", localFile("same")],
      ]),
      new Map([
        ["deleted-locally.md", remoteFile("old")],
        ["same.md", remoteFile("same")],
      ]),
      new Map([
        ["deleted-locally.md", remoteFile("old")],
        ["download-me.md", remoteFile("remote")],
        ["same.md", remoteFile("same")],
      ]),
    );

    const byPath = Object.fromEntries(result.map((entry) => [entry.path, entry.type]));
    expect(byPath["upload-me.md"]).toBe("upload");
    expect(byPath["download-me.md"]).toBe("download");
    expect(byPath["deleted-locally.md"]).toBe("delete-remote");
    expect(byPath["same.md"]).toBe("noop");
  });
});
