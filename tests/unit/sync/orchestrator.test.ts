import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryActionStore, MemoryLastSyncStore } from "../../../src/core/memory-store";
import { SyncOrchestrator } from "../../../src/sync/orchestrator";
import { DEFAULT_SETTINGS, type PluginSettings, type SyncLogEntry } from "../../../src/types/settings";
import type { LoggerPort, NotificationPort, RemoteStore, StatusPort } from "../../../src/core/interfaces";
import type { FileEntry, RemoteManifest } from "../../../src/types/manifest";
import { MockVault } from "../../integration/setup/mock-vault";
import { sha256 } from "../../../src/utils/hash";

class TestLogger implements LoggerPort {
  readonly entries: SyncLogEntry[] = [];

  log(entry: Omit<SyncLogEntry, "id" | "timestamp">): void {
    this.entries.push({
      ...entry,
      id: String(this.entries.length + 1),
      timestamp: new Date().toISOString(),
    });
  }
}

class TestNotifier implements NotificationPort {
  readonly infos: string[] = [];
  readonly errors: string[] = [];

  notify(message: string): void {
    this.infos.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

class TestStatus implements StatusPort {
  readonly states: Array<{ status: string; detail?: string }> = [];
  readonly progress: Array<{ current: number; total: number }> = [];

  setStatus(status: "idle" | "syncing" | "conflict" | "error", detail?: string): void {
    this.states.push({ detail, status });
  }

  setProgress(current: number, total: number): void {
    this.progress.push({ current, total });
  }
}

class FakeRemoteStore implements RemoteStore {
  readonly files = new Map<string, Uint8Array>();
  manifest: RemoteManifest = {
    device_id: "",
    files: {},
    generated_at: new Date(0).toISOString(),
    vault_name: "MockVault",
    version: "1",
  };
  testConnection = vi.fn(async () => {});

  async getManifest(): Promise<{ manifest: RemoteManifest; etag: string }> {
    return { etag: "etag-1", manifest: structuredClone(this.manifest) };
  }

  async listFiles(): Promise<Record<string, FileEntry>> {
    const files: Record<string, FileEntry> = {};
    for (const [path, body] of this.files.entries()) {
      files[path] = {
        deleted: false,
        etag: await sha256(body),
        mtime: Date.now(),
        sha256: await sha256(body),
        size: body.byteLength,
      };
    }
    return files;
  }

  async putManifest(manifest: RemoteManifest): Promise<string> {
    this.manifest = structuredClone(manifest);
    return "etag-2";
  }

  async uploadObject(path: string, body: ArrayBuffer): Promise<{ etag: string }> {
    this.files.set(path, new Uint8Array(body));
    return { etag: await sha256(body) };
  }

  async downloadObject(path: string): Promise<{ body: ArrayBuffer; etag: string }> {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing ${path}`);
    return {
      body: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
      etag: await sha256(file),
    };
  }

  async deleteObject(path: string): Promise<void> {
    this.files.delete(path);
  }
}

describe("SyncOrchestrator", () => {
  let vault: MockVault;
  let remote: FakeRemoteStore;
  let store: MemoryLastSyncStore;
  let actionStore: MemoryActionStore;
  let logger: TestLogger;
  let notifier: TestNotifier;
  let status: TestStatus;

  beforeEach(() => {
    vault = new MockVault();
    remote = new FakeRemoteStore();
    store = new MemoryLastSyncStore();
    actionStore = new MemoryActionStore();
    logger = new TestLogger();
    notifier = new TestNotifier();
    status = new TestStatus();
  });

  it("returns a dry-run plan without applying changes", async () => {
    vault.addFile("Notes/a.md", "hello", 1000);
    const orchestrator = createOrchestrator();

    const result = await orchestrator.triggerFullSync({ dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.summary.upload).toBe(1);
    expect(remote.files.size).toBe(0);
  });

  it("deletes local files when remote tombstone wins", async () => {
    const hash = await sha256(new TextEncoder().encode("same"));
    vault.addFile("gone.md", "same", 1000);
    await store.save({
      files: {
        "gone.md": { mtime: 1000, sha256: hash, size: 4 },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });
    remote.manifest.files["gone.md"] = { deleted: true, etag: "", mtime: 0, sha256: "", size: 0 };

    const orchestrator = createOrchestrator();
    await orchestrator.triggerFullSync();

    expect(vault.hasFile("gone.md")).toBe(false);
  });

  it("deletes remote files when local deletion wins", async () => {
    const body = new TextEncoder().encode("same");
    const hash = await sha256(body);
    remote.files.set("gone.md", body);
    remote.manifest.files["gone.md"] = { deleted: false, etag: "etag", mtime: 1000, sha256: hash, size: body.byteLength };
    await store.save({
      files: {
        "gone.md": { mtime: 1000, sha256: hash, size: body.byteLength },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });

    const orchestrator = createOrchestrator();
    await orchestrator.triggerFullSync();

    expect(remote.files.has("gone.md")).toBe(false);
    expect(remote.manifest.files["gone.md"]?.deleted).toBe(true);
  });

  it("processes queued file sync requests", async () => {
    vault.addFile("queued.md", "hello", 1000);
    const orchestrator = createOrchestrator();

    orchestrator.queueFileSync("queued.md");
    await vi.waitFor(() => expect(remote.files.has("queued.md")).toBe(true));

    expect(logger.entries.some((entry) => entry.message.includes("Processing incremental sync"))).toBe(true);
  });

  it("does not delete local files during incremental sync when remote has a tombstone", async () => {
    const body = new TextEncoder().encode("same");
    const hash = await sha256(body);
    vault.addFile("draft.md", body, 1000);
    await store.save({
      files: {
        "draft.md": { mtime: 1000, sha256: hash, size: body.byteLength },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });
    remote.manifest.files["draft.md"] = { deleted: true, etag: "", mtime: 0, sha256: "", size: 0 };
    const orchestrator = createOrchestrator();

    orchestrator.queueFileSync("draft.md");
    await vi.waitFor(() => {
      expect(logger.entries.some((entry) => entry.message.includes("Processing incremental sync"))).toBe(true);
    });

    expect(vault.hasFile("draft.md")).toBe(true);
    expect(logger.entries.some((entry) => entry.operation === "delete-local" && entry.path === "draft.md")).toBe(false);
  });

  it("ignores excluded conflict-copy deletes from the watcher queue", async () => {
    const orchestrator = createOrchestrator();

    orchestrator.queueFileDelete("Notes/draft.conflict-device-a-now.md");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(logger.entries.some((entry) => entry.path === "Notes/draft.conflict-device-a-now.md")).toBe(false);
  });

  it("flushes queued changes that arrive during an active sync", async () => {
    const slowRemote = Object.assign(new FakeRemoteStore(), remote, {
      async getManifest() {
        const current = this as FakeRemoteStore;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { etag: "etag-1", manifest: structuredClone(current.manifest) };
      },
    }) as RemoteStore;
    const orchestrator = createOrchestrator({}, slowRemote);

    vault.addFile("first.md", "one", 1000);
    const syncPromise = orchestrator.triggerFullSync();
    vault.addFile("second.md", "two", 1000);
    orchestrator.queueFileSync("second.md");

    await syncPromise;
    await vi.waitFor(() => expect((slowRemote as FakeRemoteStore).files.has("second.md")).toBe(true));
  });

  it("delegates connection tests to remote store", async () => {
    const orchestrator = createOrchestrator();
    await orchestrator.testConnection();
    expect(remote.testConnection).toHaveBeenCalledTimes(1);
  });

  it("downloads remote objects that exist in bucket listing even when missing from manifest", async () => {
    const body = new TextEncoder().encode("listed only");
    remote.files.set("listed.md", body);
    const orchestrator = createOrchestrator();

    await orchestrator.triggerFullSync({ direction: "pull" });

    expect(vault.hasFile("listed.md")).toBe(true);
  });

  it("local-safe sync does not create remote-only files locally", async () => {
    const body = new TextEncoder().encode("ghost remote note");
    remote.files.set("Untitled.md", body);
    remote.manifest.files["Untitled.md"] = {
      deleted: false,
      etag: "etag-untitled",
      mtime: 1000,
      sha256: await sha256(body),
      size: body.byteLength,
    };
    const orchestrator = createOrchestrator();

    const result = await orchestrator.triggerFullSync({ direction: "bidirectional", localSafe: true });

    expect(vault.hasFile("Untitled.md")).toBe(false);
    expect(result.summary.download).toBe(0);
  });

  it("force push deletes remote-only files and can undo the action", async () => {
    const remoteBody = new TextEncoder().encode("remote-only");
    remote.files.set("old.md", remoteBody);
    remote.manifest.files["old.md"] = {
      deleted: false,
      etag: "etag-old",
      mtime: 1000,
      sha256: await sha256(remoteBody),
      size: remoteBody.byteLength,
    };
    vault.addFile("new.md", "local-only", 2000);
    const orchestrator = createOrchestrator();

    await orchestrator.triggerFullSync({ direction: "push", force: true });

    expect(remote.files.has("old.md")).toBe(false);
    expect(remote.files.has("new.md")).toBe(true);

    await orchestrator.undoLastManualAction();

    expect(remote.files.has("old.md")).toBe(true);
    expect(remote.files.has("new.md")).toBe(false);
  });

  it("force push does not fail when remote manifest points to a missing object", async () => {
    const localBody = new TextEncoder().encode("fresh local");
    vault.addFile("Templates/MOC - Map of Content.md", localBody, 2000);
    const staleRemote = Object.assign(new FakeRemoteStore(), remote, {
      async listFiles() {
        return {
          "Templates/MOC - Map of Content.md": {
            deleted: false,
            etag: "etag-stale",
            mtime: 1000,
            sha256: "stale-hash",
            size: 123,
          },
        };
      },
      async getManifest() {
        return {
          etag: "etag-1",
          manifest: {
            device_id: "device-b",
            files: {
              "Templates/MOC - Map of Content.md": {
                deleted: false,
                etag: "etag-stale",
                mtime: 1000,
                sha256: "stale-hash",
                size: 123,
              },
            },
            generated_at: new Date().toISOString(),
            vault_name: "MockVault",
            version: "1",
          },
        };
      },
      async downloadObject() {
        throw new Error("Remote download failed [path=Templates/MOC - Map of Content.md]: status=404 name=NoSuchKey UnknownError");
      },
    });
    const orchestrator = createOrchestrator({}, staleRemote as RemoteStore);

    const result = await orchestrator.triggerFullSync({ direction: "push", force: true });

    expect(result.summary.upload).toBe(1);
    expect(staleRemote.files.has("Templates/MOC - Map of Content.md")).toBe(true);
    expect(logger.entries.some((entry) => entry.message.includes("Skipped remote rollback backup because the object was already missing"))).toBe(true);
  });

  it("force pull deletes local-only files and can undo the action", async () => {
    const remoteBody = new TextEncoder().encode("server");
    remote.files.set("server.md", remoteBody);
    remote.manifest.files["server.md"] = {
      deleted: false,
      etag: "etag-server",
      mtime: 1000,
      sha256: await sha256(remoteBody),
      size: remoteBody.byteLength,
    };
    vault.addFile("local.md", "mine", 2000);
    const orchestrator = createOrchestrator();

    await orchestrator.triggerFullSync({ direction: "pull", force: true });

    expect(vault.hasFile("local.md")).toBe(false);
    expect(vault.hasFile("server.md")).toBe(true);

    await orchestrator.undoLastManualAction();

    expect(vault.hasFile("local.md")).toBe(true);
    expect(vault.hasFile("server.md")).toBe(false);
  });

  it("resolves push conflicts by keeping local content without creating conflict copies", async () => {
    const localBody = new TextEncoder().encode("local version");
    const remoteBody = new TextEncoder().encode("remote version");
    const baseBody = new TextEncoder().encode("base");
    const baseHash = await sha256(baseBody);
    vault.addFile("Notes/live.md", localBody, 2000);
    remote.files.set("Notes/live.md", remoteBody);
    remote.manifest.files["Notes/live.md"] = {
      deleted: false,
      etag: "etag-remote",
      mtime: 3000,
      sha256: await sha256(remoteBody),
      size: remoteBody.byteLength,
    };
    await store.save({
      files: {
        "Notes/live.md": { mtime: 1000, sha256: baseHash, size: baseBody.byteLength },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });
    const orchestrator = createOrchestrator({ defaultConflictRule: "keep-both" });

    await orchestrator.triggerFullSync({ direction: "push", reason: "incremental" });

    expect(vault.listPaths().some((path) => path.includes(".conflict-"))).toBe(false);
    expect(logger.entries.some((entry) => entry.operation === "upload" && entry.path === "Notes/live.md")).toBe(true);
  });

  it("reports directional push conflicts as synced uploads in summary and status", async () => {
    const localBody = new TextEncoder().encode("local version");
    const remoteBody = new TextEncoder().encode("remote version");
    const baseBody = new TextEncoder().encode("base");
    const baseHash = await sha256(baseBody);
    vault.addFile("Notes/status.md", localBody, 2000);
    remote.files.set("Notes/status.md", remoteBody);
    remote.manifest.files["Notes/status.md"] = {
      deleted: false,
      etag: "etag-remote",
      mtime: 3000,
      sha256: await sha256(remoteBody),
      size: remoteBody.byteLength,
    };
    await store.save({
      files: {
        "Notes/status.md": { mtime: 1000, sha256: baseHash, size: baseBody.byteLength },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });
    const orchestrator = createOrchestrator({ defaultConflictRule: "keep-both" });

    const result = await orchestrator.triggerFullSync({ direction: "push", reason: "incremental" });

    expect(result.summary.conflict).toBe(0);
    expect(result.summary.upload).toBe(1);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ path: "Notes/status.md", type: "upload", localMtime: 2000 });
    expect(status.states.at(-1)?.status).toBe("idle");
  });

  it("reports sync errors", async () => {
    const brokenRemote = Object.assign(new FakeRemoteStore(), remote, {
      async getManifest() {
        throw new Error("boom");
      },
    }) as RemoteStore;
    const orchestrator = createOrchestrator({}, brokenRemote);

    await expect(orchestrator.triggerFullSync()).rejects.toThrow("boom");
    expect(notifier.errors[0]).toContain("boom");
    expect(status.states.at(-1)?.status).toBe("error");
  });

  it("does not create conflict copies when remote download returns NoSuchKey", async () => {
    const localBody = new TextEncoder().encode("local version");
    const baseBody = new TextEncoder().encode("base");
    const baseHash = await sha256(baseBody);
    vault.addFile("Notes/conflict.md", localBody, 2000);
    await store.save({
      files: {
        "Notes/conflict.md": { mtime: 1000, sha256: baseHash, size: baseBody.byteLength },
      },
      remote_manifest_etag: "etag",
      synced_at: new Date().toISOString(),
    });
    const missingDownloadRemote = Object.assign(new FakeRemoteStore(), remote, {
      async listFiles() {
        return {
          "Notes/conflict.md": {
            deleted: false,
            etag: "etag-remote",
            mtime: 3000,
            sha256: "remote-hash",
            size: 25,
          },
        };
      },
      async getManifest() {
        return {
          etag: "etag-1",
          manifest: {
            device_id: "device-b",
            files: {
              "Notes/conflict.md": {
                deleted: false,
                etag: "etag-remote",
                mtime: 3000,
                sha256: "remote-hash",
                size: 25,
              },
            },
            generated_at: new Date().toISOString(),
            vault_name: "MockVault",
            version: "1",
          },
        };
      },
      async downloadObject() {
        throw new Error("Remote download failed [path=Notes/conflict.md]: status=404 name=NoSuchKey UnknownError");
      },
    }) as RemoteStore;
    const orchestrator = createOrchestrator({ defaultConflictRule: "keep-both" }, missingDownloadRemote);

    await expect(orchestrator.triggerFullSync()).resolves.toBeDefined();

    expect(vault.hasFile("Notes/conflict.md")).toBe(true);
    expect(vault.listPaths().some((path) => path.includes(".conflict-"))).toBe(false);
    expect(logger.entries.some((entry) => entry.message.includes("Remote object missing during download"))).toBe(true);
  });

  it("recovers gzip-compressed markdown when remote encoding metadata is missing", async () => {
    const compression = await import("../../../src/utils/compression");
    const originalText = "# Important Journal\n\nThis should stay readable.";
    const compressed = await compression.gzipCompress(new TextEncoder().encode(originalText));
    const encodedRemote = Object.assign(new FakeRemoteStore(), remote, {
      async listFiles() {
        return {
          "Notes/journal.md": {
            deleted: false,
            etag: "etag-journal",
            mtime: 3000,
            sha256: "remote-hash",
            size: compressed.byteLength,
          },
        };
      },
      async getManifest() {
        return {
          etag: "etag-1",
          manifest: {
            device_id: "device-b",
            files: {
              "Notes/journal.md": {
                deleted: false,
                etag: "etag-journal",
                mtime: 3000,
                sha256: "remote-hash",
                size: compressed.byteLength,
              },
            },
            generated_at: new Date().toISOString(),
            vault_name: "MockVault",
            version: "1",
          },
        };
      },
      async downloadObject() {
        return {
          body: compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer,
          etag: "etag-journal",
        };
      },
    }) as RemoteStore;
    const orchestrator = createOrchestrator({}, encodedRemote);

    await orchestrator.triggerFullSync({ direction: "pull" });

    const restored = new TextDecoder().decode(await vault.readBinary("Notes/journal.md"));
    expect(restored).toBe(originalText);
    expect(logger.entries.some((entry) => entry.message.includes("Recovered gzip-compressed text using byte signature"))).toBe(true);
  });

  it("falls back to plain text when gzip metadata is stale", async () => {
    const originalText = "# Atlas Parenting\n\nPlain text body.";
    const raw = new TextEncoder().encode(originalText);
    const staleEncodingRemote = Object.assign(new FakeRemoteStore(), remote, {
      async listFiles() {
        return {
          "01 Atlas/Atlas - Parenting.md": {
            deleted: false,
            etag: "etag-parenting",
            mtime: 3000,
            sha256: "remote-hash",
            size: raw.byteLength,
            encoding: "gzip",
          },
        };
      },
      async getManifest() {
        return {
          etag: "etag-1",
          manifest: {
            device_id: "device-b",
            files: {
              "01 Atlas/Atlas - Parenting.md": {
                deleted: false,
                etag: "etag-parenting",
                mtime: 3000,
                sha256: "remote-hash",
                size: raw.byteLength,
                encoding: "gzip",
              },
            },
            generated_at: new Date().toISOString(),
            vault_name: "MockVault",
            version: "1",
          },
        };
      },
      async downloadObject() {
        return {
          body: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
          etag: "etag-parenting",
        };
      },
    }) as RemoteStore;
    const orchestrator = createOrchestrator({}, staleEncodingRemote);

    await orchestrator.triggerFullSync({ direction: "pull" });

    const restored = new TextDecoder().decode(await vault.readBinary("01 Atlas/Atlas - Parenting.md"));
    expect(restored).toBe(originalText);
    expect(status.states.at(-1)?.status).toBe("idle");
    expect(logger.entries.some((entry) => entry.message.includes("payload was plain text. Falling back to identity"))).toBe(true);
  });

  function createOrchestrator(overrides?: Partial<PluginSettings>, remoteStore: RemoteStore = remote): SyncOrchestrator {
    return new SyncOrchestrator({
      deviceId: "device-a",
      actionStore,
      lastSyncStore: store,
      logger,
      notifier,
      remote: remoteStore,
      settings: {
        ...DEFAULT_SETTINGS,
        bucketName: "bucket",
        endpoint: "https://example.com",
        ...overrides,
      },
      status,
      vault,
    });
  }
});
