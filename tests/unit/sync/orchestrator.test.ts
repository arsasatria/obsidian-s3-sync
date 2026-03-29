import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryLastSyncStore } from "../../../src/core/memory-store";
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
  let logger: TestLogger;
  let notifier: TestNotifier;
  let status: TestStatus;

  beforeEach(() => {
    vault = new MockVault();
    remote = new FakeRemoteStore();
    store = new MemoryLastSyncStore();
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

  function createOrchestrator(overrides?: Partial<PluginSettings>, remoteStore: RemoteStore = remote): SyncOrchestrator {
    return new SyncOrchestrator({
      deviceId: "device-a",
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
