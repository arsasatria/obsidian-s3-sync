import { beforeEach, describe, expect, it } from "vitest";
import { SyncOrchestrator } from "../../src/sync/orchestrator";
import { DEFAULT_SETTINGS, type PluginSettings, type SyncLogEntry } from "../../src/types/settings";
import { MemoryActionStore, MemoryLastSyncStore } from "../../src/core/memory-store";
import type { LoggerPort, NotificationPort, StatusPort } from "../../src/core/interfaces";
import { MockVault } from "./setup/mock-vault";
import { MockS3 } from "./setup/mock-s3";
import { sha256 } from "../../src/utils/hash";

class SilentLogger implements LoggerPort {
  readonly entries: SyncLogEntry[] = [];

  log(entry: Omit<SyncLogEntry, "id" | "timestamp">): void {
    this.entries.push({
      ...entry,
      id: String(this.entries.length + 1),
      timestamp: new Date().toISOString(),
    });
  }
}

class SilentNotifier implements NotificationPort {
  notify(): void {}

  error(): void {}
}

class SilentStatus implements StatusPort {
  setProgress(): void {}

  setStatus(): void {}
}

describe("Full sync integration", () => {
  let vault: MockVault;
  let s3: MockS3;
  let orchestrator: SyncOrchestrator;
  let store: MemoryLastSyncStore;
  let actionStore: MemoryActionStore;

  beforeEach(() => {
    vault = new MockVault();
    s3 = new MockS3();
    store = new MemoryLastSyncStore();
    actionStore = new MemoryActionStore();
    orchestrator = createOrchestrator();
  });

  it("uploads local files on first sync", async () => {
    vault.addFile("Notes/note1.md", "# Note 1", 1000);
    vault.addFile("Notes/note2.md", "# Note 2", 1000);

    await orchestrator.triggerFullSync();

    expect(s3.hasObject("Notes/note1.md")).toBe(true);
    expect(s3.hasObject("Notes/note2.md")).toBe(true);
  });

  it("downloads remote files when local is empty", async () => {
    s3.putObject("Notes/remote.md", new TextEncoder().encode("# Remote"));
    s3.seedManifest({
      "Notes/remote.md": {
        deleted: false,
        etag: "abc",
        mtime: 1000,
        sha256: await sha256(new TextEncoder().encode("# Remote")),
        size: 8,
      },
    });

    await orchestrator.triggerFullSync();

    expect(vault.hasFile("Notes/remote.md")).toBe(true);
  });

  it("handles bidirectional sync", async () => {
    vault.addFile("local-only.md", "# Local", 2000);
    s3.putObject("remote-only.md", new TextEncoder().encode("# Remote"));
    s3.seedManifest({
      "remote-only.md": {
        deleted: false,
        etag: "r1",
        mtime: 1000,
        sha256: await sha256(new TextEncoder().encode("# Remote")),
        size: 8,
      },
    });

    await orchestrator.triggerFullSync();

    expect(s3.hasObject("local-only.md")).toBe(true);
    expect(vault.hasFile("remote-only.md")).toBe(true);
  });

  it("creates conflict copies when keep-both is selected", async () => {
    const originalHash = await sha256(new TextEncoder().encode("base"));
    const remoteBody = new TextEncoder().encode("# Remote Version");
    s3.putObject("conflict.md", remoteBody);
    s3.seedManifest({
      "conflict.md": {
        deleted: false,
        etag: "rh",
        mtime: 1500,
        sha256: await sha256(remoteBody),
        size: remoteBody.byteLength,
      },
    });
    await store.save({
      files: {
        "conflict.md": {
          mtime: 1000,
          sha256: originalHash,
          size: 4,
        },
      },
      remote_manifest_etag: "etag-1",
      synced_at: new Date().toISOString(),
    });
    vault.addFile("conflict.md", "# Local Version", 2000);

    orchestrator = createOrchestrator({ defaultConflictRule: "keep-both" });
    await orchestrator.triggerFullSync();

    const conflictFile = vault.listPaths().find((path) => path.includes(".conflict-device-a-"));
    expect(conflictFile).toBeTruthy();
    expect(vault.hasFile("conflict.md")).toBe(true);
  });

  function createOrchestrator(overrides?: Partial<PluginSettings>): SyncOrchestrator {
    return new SyncOrchestrator({
      deviceId: "device-a",
      actionStore,
      lastSyncStore: store,
      logger: new SilentLogger(),
      notifier: new SilentNotifier(),
      remote: s3,
      settings: {
        ...DEFAULT_SETTINGS,
        bucketName: "bucket",
        endpoint: "https://example.com",
        ...overrides,
      },
      status: new SilentStatus(),
      vault,
    });
  }
});
