import type { FileEntry, LastSyncState, RemoteManifest } from "../types/manifest";
import type { PluginSettings } from "../types/settings";
import type { ConflictContext, SyncExecutionOptions, SyncOperation, SyncPlanSummary, SyncRunResult } from "../types/sync";
import type { LastSyncStore, LoggerPort, NotificationPort, RemoteStore, StatusPort, VaultPort } from "../core/interfaces";
import { ExcludeFilter } from "../vault/exclude";
import { buildLocalState } from "../core/local-state";
import { ThreeWayDiffer } from "./differ";
import { ConflictResolver } from "./conflict-resolver";
import { conflictPath, ensureFolderPath, normalizePathSlashes, safetySnapshotPath } from "../utils/path";
import { sha256 } from "../utils/hash";
import { gzipDecompress, prepareCompressedPayload } from "../utils/compression";
import { isMissingFileError } from "../utils/errors";

interface SyncOrchestratorDeps {
  deviceId: string;
  lastSyncStore: LastSyncStore;
  logger: LoggerPort;
  notifier: NotificationPort;
  remote: RemoteStore;
  settings: PluginSettings;
  status: StatusPort;
  vault: VaultPort;
  conflictPrompt?: (context: ConflictContext) => Promise<PluginSettings["defaultConflictRule"]>;
}

export class SyncOrchestrator {
  private readonly differ = new ThreeWayDiffer();
  private readonly excludeFilter: ExcludeFilter;
  private readonly resolver: ConflictResolver;
  private readonly queuedPaths = new Set<string>();
  private running = false;

  constructor(private readonly deps: SyncOrchestratorDeps) {
    this.excludeFilter = new ExcludeFilter(this.buildExcludePatterns(deps.settings));
    this.resolver = new ConflictResolver(deps.settings.defaultConflictRule, deps.deviceId, deps.conflictPrompt);
  }

  async triggerFullSync(options?: SyncExecutionOptions): Promise<SyncRunResult> {
    if (this.running) {
      return { applied: false, operations: [], summary: emptySummary() };
    }

    this.running = true;
    this.deps.status.setStatus("syncing", "Preparing sync plan");
    try {
      this.deps.logger.log({
        level: "info",
        message: `Starting ${options?.direction ?? "bidirectional"} sync${options?.reason ? ` (${options.reason})` : ""}; mobileSafeMode=${this.deps.settings.mobileSafeMode}; polling=${this.deps.settings.remotePollingEnabled}; snapshots=${this.deps.settings.createSafetySnapshots}; compression=${this.deps.settings.smartTextCompression}`,
        operation: "system",
      });
      this.deps.logger.log({
        level: "info",
        message: "Scanning local vault state",
        operation: "scan-local",
      });
      const local = await buildLocalState(this.deps.vault, this.excludeFilter);
      this.deps.logger.log({
        level: "info",
        message: `Local scan complete: ${local.size} tracked file(s)`,
        operation: "scan-local",
      });
      const lastSync = await this.deps.lastSyncStore.load();
      this.deps.logger.log({
        level: "info",
        message: "Fetching remote manifest",
        operation: "manifest",
      });
      const remoteResult = await this.deps.remote.getManifest();
      const remote = new Map(Object.entries(remoteResult.manifest.files));
      this.deps.logger.log({
        level: "info",
        message: `Remote manifest loaded: ${remote.size} item(s), etag=${remoteResult.etag || "none"}`,
        operation: "manifest",
      });
      const lastSyncMap = new Map(Object.entries(lastSync.files));
      const operations = this.filterOperations(
        this.differ.diff(local, lastSyncMap, remote).filter((operation) => operation.type !== "noop"),
        options?.direction ?? "bidirectional",
      );
      const summary = summarize(operations);

      if (options?.dryRun) {
        this.deps.logger.log({
          level: "info",
          message: `Dry run ready (${options?.direction ?? "bidirectional"}): ${summary.upload} upload, ${summary.download} download, ${summary.deleteLocal + summary.deleteRemote} delete, ${summary.conflict} conflict`,
          operation: "system",
        });
        this.deps.status.setStatus(summary.conflict > 0 ? "conflict" : "idle", "Dry run completed");
        return { applied: false, operations, summary };
      }

      const updatedManifest = await this.executeOperations(operations, local, remoteResult.manifest, options?.direction ?? "bidirectional");
      this.deps.logger.log({
        level: "info",
        message: "Uploading updated remote manifest",
        operation: "manifest",
      });
      const remoteManifestEtag = await this.deps.remote.putManifest(updatedManifest);
      await this.deps.lastSyncStore.save({
        files: toLastSyncFiles(updatedManifest.files),
        remote_manifest_etag: remoteManifestEtag,
        synced_at: new Date().toISOString(),
      });

      this.deps.status.setStatus(summary.conflict > 0 ? "conflict" : "idle", "Sync complete");
      this.deps.logger.log({
        level: "info",
        message: `Sync complete: ${summary.upload} upload, ${summary.download} download, ${summary.deleteLocal} delete-local, ${summary.deleteRemote} delete-remote, ${summary.conflict} conflict`,
        operation: "system",
      });
      return { applied: true, operations, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.log({ level: "error", message, operation: "system" });
      this.deps.status.setStatus("error", message);
      if (options?.notifyErrors !== false) {
        this.deps.notifier.error(`S3 Sync failed: ${message}`);
      }
      throw error;
    } finally {
      this.running = false;
      this.deps.status.setProgress(0, 0);
      if (this.queuedPaths.size > 0) {
        void this.flushQueue();
      }
    }
  }

  queueFileSync(path: string): void {
    if (this.excludeFilter.isExcluded(path)) {
      return;
    }
    this.queuedPaths.add(path);
    this.deps.logger.log({
      level: "info",
      message: "Queued file sync",
      operation: "queue",
      path,
    });
    void this.flushQueue();
  }

  queueFileDelete(path: string): void {
    this.queuedPaths.add(path);
    this.deps.logger.log({
      level: "info",
      message: "Queued file delete sync",
      operation: "queue",
      path,
    });
    void this.flushQueue();
  }

  queueFileRename(oldPath: string, newPath: string): void {
    this.queuedPaths.add(oldPath);
    this.queuedPaths.add(newPath);
    this.deps.logger.log({
      level: "info",
      message: `Queued rename sync: ${oldPath} -> ${newPath}`,
      operation: "queue",
      path: newPath,
    });
    void this.flushQueue();
  }

  async testConnection(): Promise<void> {
    await this.deps.remote.testConnection();
  }

  private async flushQueue(): Promise<void> {
    if (this.running || this.queuedPaths.size === 0) {
      return;
    }
    const pending = [...this.queuedPaths];
    this.queuedPaths.clear();
    this.deps.logger.log({
      level: "info",
      message: `Processing incremental sync for ${pending.length} path(s)`,
      operation: "queue",
    });
    await this.triggerFullSync({ direction: "bidirectional", reason: "incremental" });
  }

  private buildExcludePatterns(settings: PluginSettings): string[] {
    if (settings.syncConfigFolder) {
      return settings.excludePatterns.filter((pattern) => !pattern.startsWith(".obsidian/"));
    }
    return [...settings.excludePatterns];
  }

  private async executeOperations(
    operations: SyncOperation[],
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    remoteManifest: RemoteManifest,
    direction: "bidirectional" | "push" | "pull",
  ): Promise<RemoteManifest> {
    const manifestFiles: Record<string, FileEntry> = { ...remoteManifest.files };
    const remoteMap = new Map(Object.entries(remoteManifest.files));

    let completed = 0;
    for (const operation of operations) {
      completed += 1;
      this.deps.status.setProgress(completed, operations.length);
      try {
        if (operation.type === "upload") {
          await this.uploadPath(operation.path, local, manifestFiles);
          continue;
        }
        if (operation.type === "download") {
          await this.downloadPath(operation.path, manifestFiles);
          continue;
        }
        if (operation.type === "delete-local") {
          await this.createSafetySnapshot(operation.path, "remote-delete");
          await this.safeDeleteLocal(operation.path);
          manifestFiles[operation.path] = { ...(remoteMap.get(operation.path) as FileEntry), deleted: true };
          this.deps.logger.log({ level: "info", message: "Deleted local file", operation: "delete-local", path: operation.path });
          continue;
        }
        if (operation.type === "delete-remote") {
          await this.deps.remote.deleteObject(operation.path);
          manifestFiles[operation.path] = {
            deleted: true,
            etag: "",
            mtime: Date.now(),
            sha256: "",
            size: 0,
          };
          this.deps.logger.log({ level: "info", message: "Deleted remote file", operation: "delete-remote", path: operation.path });
          continue;
        }
        if (operation.type === "conflict") {
          const resolution = await this.resolver.resolve({
            path: operation.path,
            lastSync: undefined,
            local: local.get(operation.path),
            remote: remoteMap.get(operation.path),
          });
          this.deps.logger.log({
            level: "warning",
            message: `Conflict resolved as ${resolution.type} during ${direction} sync`,
            operation: "conflict",
            path: operation.path,
          });

          if (resolution.type === "upload") {
            await this.uploadPath(operation.path, local, manifestFiles);
            continue;
          }
          if (resolution.type === "download") {
            await this.downloadPath(operation.path, manifestFiles);
            continue;
          }
          if (resolution.conflictPath) {
            try {
              const currentLocal = await this.deps.vault.readBinary(operation.path);
              await this.ensureFolders(resolution.conflictPath);
              await this.deps.vault.writeBinary(resolution.conflictPath, currentLocal);
            } catch (error) {
              if (!isMissingFileError(error)) {
                throw error;
              }
            }
            await this.downloadPath(operation.path, manifestFiles);
          }
        }
      } catch (error) {
        this.deps.logger.log({
          level: "error",
          message: `${operation.type} failed for ${operation.path}: ${error instanceof Error ? error.message : String(error)}`,
          operation: "system",
          path: operation.path,
        });
        throw error;
      }
    }

    return {
      ...remoteManifest,
      device_id: this.deps.deviceId,
      files: manifestFiles,
      generated_at: new Date().toISOString(),
      vault_name: this.deps.vault.getVaultName(),
      version: "1",
    };
  }

  private async uploadPath(
    path: string,
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    manifestFiles: Record<string, FileEntry>,
  ): Promise<void> {
    const localState = local.get(path);
    if (!localState) {
      return;
    }
    let rawBody: Uint8Array;
    try {
      rawBody = new Uint8Array(await this.deps.vault.readBinary(path));
    } catch (error) {
      if (isMissingFileError(error)) {
        this.deps.logger.log({
          level: "warning",
          message: "Skipped upload because local file disappeared before read",
          operation: "upload",
          path,
        });
        return;
      }
      throw error;
    }
    const prepared = await prepareCompressedPayload(
      path,
      rawBody,
      this.deps.settings.smartTextCompression,
      this.deps.settings.compressionMinSavingsPercent,
    );
    const result = await this.deps.remote.uploadObject(
      path,
      prepared.body.buffer.slice(prepared.body.byteOffset, prepared.body.byteOffset + prepared.body.byteLength) as ArrayBuffer,
      localState.mtime,
    );
    manifestFiles[path] = {
      deleted: false,
      encoding: prepared.encoding,
      etag: result.etag,
      mtime: localState.mtime,
      sha256: localState.sha256,
      size: localState.size,
    };
    const compressionNote =
      prepared.encoding === "gzip" ? ` (compressed ${rawBody.byteLength}B -> ${prepared.body.byteLength}B)` : "";
    this.deps.logger.log({ level: "info", message: `Uploaded file${compressionNote}`, operation: "upload", path });
  }

  private async downloadPath(path: string, manifestFiles: Record<string, FileEntry>): Promise<void> {
    await this.createSafetySnapshot(path, "before-download");
    const remoteObject = await this.deps.remote.downloadObject(path);
    const remoteMeta = manifestFiles[path];
    const rawBytes = new Uint8Array(remoteObject.body);
    const restored =
      remoteMeta?.encoding === "gzip"
        ? await gzipDecompress(rawBytes)
        : rawBytes;
    await this.ensureFolders(path);
    await this.deps.vault.writeBinary(
      path,
      restored.buffer.slice(restored.byteOffset, restored.byteOffset + restored.byteLength) as ArrayBuffer,
    );
    const sha = await sha256(restored);
    manifestFiles[path] = {
      ...(manifestFiles[path] ?? { mtime: Date.now(), size: restored.byteLength, deleted: false }),
      deleted: false,
      encoding: remoteMeta?.encoding ?? "identity",
      etag: remoteObject.etag,
      sha256: sha,
      size: restored.byteLength,
      mtime: Date.now(),
    };
    this.deps.logger.log({ level: "info", message: "Downloaded file", operation: "download", path });
  }

  private async safeDeleteLocal(path: string): Promise<void> {
    try {
      const exists = await this.deps.vault.exists(path);
      if (exists) {
        await this.deps.vault.delete(path);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  private async ensureFolders(path: string): Promise<void> {
    for (const folder of ensureFolderPath(path)) {
      await this.deps.vault.ensureFolder(folder);
    }
  }

  private filterOperations(
    operations: SyncOperation[],
    direction: "bidirectional" | "push" | "pull",
  ): SyncOperation[] {
    if (direction === "bidirectional") {
      return operations;
    }
    if (direction === "push") {
      return operations.filter((operation) =>
        operation.type === "upload" ||
        operation.type === "delete-remote" ||
        operation.type === "conflict",
      );
    }
    return operations.filter((operation) =>
      operation.type === "download" ||
      operation.type === "delete-local" ||
      operation.type === "conflict",
    );
  }

  private async createSafetySnapshot(path: string, reason: string): Promise<void> {
    if (!this.deps.settings.createSafetySnapshots) {
      return;
    }
    try {
      const exists = await this.deps.vault.exists(path);
      if (!exists) {
        return;
      }
      const body = await this.deps.vault.readBinary(path);
      const snapshotPath = safetySnapshotPath(path, reason, new Date().toISOString().replace(/[:.]/g, "-"));
      await this.ensureFolders(snapshotPath);
      await this.deps.vault.writeBinary(snapshotPath, body);
      await this.pruneSafetySnapshots(path);
      this.deps.logger.log({
        level: "info",
        message: `Created safety snapshot (${reason})`,
        operation: "system",
        path: snapshotPath,
      });
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  private async pruneSafetySnapshots(path: string): Promise<void> {
    const keep = Math.max(1, this.deps.settings.maxSafetySnapshotsPerFile);
    const prefix = `.s3sync-safety/${normalizePathSlashes(path)}.snapshot-`;
    const files = await this.deps.vault.listFiles();
    const snapshots = files
      .filter((file) => file.path.startsWith(prefix))
      .sort((left, right) => right.mtime - left.mtime);
    for (const snapshot of snapshots.slice(keep)) {
      try {
        await this.deps.vault.delete(snapshot.path);
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
    }
  }
}

function emptySummary(): SyncPlanSummary {
  return { upload: 0, download: 0, deleteLocal: 0, deleteRemote: 0, conflict: 0 };
}

function summarize(operations: SyncOperation[]): SyncPlanSummary {
  return operations.reduce<SyncPlanSummary>(
    (summary, operation) => {
      if (operation.type === "upload") summary.upload += 1;
      if (operation.type === "download") summary.download += 1;
      if (operation.type === "delete-local") summary.deleteLocal += 1;
      if (operation.type === "delete-remote") summary.deleteRemote += 1;
      if (operation.type === "conflict") summary.conflict += 1;
      return summary;
    },
    emptySummary(),
  );
}

function toLastSyncFiles(files: Record<string, FileEntry>): LastSyncState["files"] {
  const output: LastSyncState["files"] = {};
  for (const [path, file] of Object.entries(files)) {
    if (file.deleted) {
      continue;
    }
    output[path] = {
      mtime: file.mtime,
      sha256: file.sha256,
      size: file.size,
    };
  }
  return output;
}
