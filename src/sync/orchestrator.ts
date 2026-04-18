import type { FileEntry, LastSyncState, RemoteManifest } from "../types/manifest";
import type { PluginSettings } from "../types/settings";
import type { ConflictContext, SyncExecutionOptions, SyncOperation, SyncPlanSummary, SyncRunResult } from "../types/sync";
import type { ManualActionRecord } from "../types/action";
import type { ActionStore, LastSyncStore, LoggerPort, NotificationPort, RemoteStore, StatusPort, VaultPort } from "../core/interfaces";
import { ExcludeFilter } from "../vault/exclude";
import { buildLocalState } from "../core/local-state";
import { ThreeWayDiffer } from "./differ";
import { ConflictResolver } from "./conflict-resolver";
import { ensureFolderPath, manualActionBackupPath, manualActionRootPath, normalizePathSlashes, safetySnapshotPath } from "../utils/path";
import { sha256 } from "../utils/hash";
import { gzipDecompress, isCompressibleTextPath, isGzipData, prepareCompressedPayload } from "../utils/compression";
import { isMissingFileError, isMissingRemoteObjectError } from "../utils/errors";

interface SyncOrchestratorDeps {
  deviceId: string;
  actionStore: ActionStore;
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
  private readonly internalMutationIgnores = new Map<string, number>();
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
      const remoteListing = await this.loadRemoteListing();
      const remote = new Map(Object.entries(this.mergeRemoteFiles(remoteResult.manifest.files, remoteListing)));
      this.deps.logger.log({
        level: "info",
        message: `Remote manifest loaded: ${remote.size} item(s), etag=${remoteResult.etag || "none"}`,
        operation: "manifest",
      });
      const lastSyncMap = new Map(Object.entries(lastSync.files));
      const operations = (
        options?.force
          ? this.buildForceOperations(local, remote, options?.direction ?? "bidirectional")
          : this.filterOperations(
              this.differ.diff(local, lastSyncMap, remote).filter((operation) => operation.type !== "noop"),
              options?.direction ?? "bidirectional",
            )
      ).filter((operation) => operation.type !== "noop" && !this.excludeFilter.isExcluded(operation.path));
      const localSafeOperations = options?.localSafe
        ? this.protectLocalOperations(operations, local, lastSyncMap)
        : operations;
      const effectiveOperations = this.summarizeOperationsForDirection(
        localSafeOperations,
        options?.direction ?? "bidirectional",
        options?.force ?? false,
      );
      const summary = summarize(effectiveOperations);

      if (options?.dryRun) {
        this.deps.logger.log({
          level: "info",
          message: `Dry run ready (${options?.direction ?? "bidirectional"}): ${summary.upload} upload, ${summary.download} download, ${summary.deleteLocal + summary.deleteRemote} delete, ${summary.conflict} conflict`,
          operation: "system",
        });
        this.deps.status.setStatus(summary.conflict > 0 ? "conflict" : "idle", "Dry run completed");
        return { applied: false, operations: effectiveOperations, summary };
      }

      const manualAction =
        options?.force && (options?.direction === "push" || options?.direction === "pull")
          ? await this.captureManualActionBackup(options.direction, effectiveOperations, local, remote, lastSync, remoteResult.manifest)
          : null;
      const updatedManifest = await this.executeOperations(
        effectiveOperations,
        local,
        remoteResult.manifest,
        options?.direction ?? "bidirectional",
        options?.force ?? false,
      );
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
      if (manualAction) {
        await this.deps.actionStore.save(manualAction);
      }

      this.deps.status.setStatus(summary.conflict > 0 ? "conflict" : "idle", "Sync complete");
      this.deps.logger.log({
        level: "info",
        message: `Sync complete: ${summary.upload} upload, ${summary.download} download, ${summary.deleteLocal} delete-local, ${summary.deleteRemote} delete-remote, ${summary.conflict} conflict`,
        operation: "system",
      });
      return { applied: true, operations: effectiveOperations, summary };
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
    if (this.shouldIgnoreInternalMutation(path)) {
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
    if (this.excludeFilter.isExcluded(path)) {
      return;
    }
    if (this.shouldIgnoreInternalMutation(path)) {
      return;
    }
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
    if (this.excludeFilter.isExcluded(oldPath) && this.excludeFilter.isExcluded(newPath)) {
      return;
    }
    if (this.shouldIgnoreInternalMutation(oldPath) || this.shouldIgnoreInternalMutation(newPath)) {
      return;
    }
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

  async undoLastManualAction(): Promise<ManualActionRecord | null> {
    const action = await this.deps.actionStore.load();
    if (!action) {
      return null;
    }
    if (this.running) {
      throw new Error("A sync is already running");
    }

    this.running = true;
    this.deps.status.setStatus("syncing", `Undoing last ${action.type}`);
    try {
      if (action.type === "push") {
        await this.undoPush(action);
      } else {
        await this.undoPull(action);
      }
      await this.deps.lastSyncStore.save(action.lastSyncBefore);
      await this.cleanupManualAction(action);
      this.deps.status.setStatus("idle", `Undo ${action.type} complete`);
      this.deps.logger.log({
        level: "info",
        message: `Undo ${action.type} completed`,
        operation: "manual",
      });
      return action;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.log({ level: "error", message: `Undo ${action.type} failed: ${message}`, operation: "manual" });
      this.deps.status.setStatus("error", message);
      throw error;
    } finally {
      this.running = false;
      this.deps.status.setProgress(0, 0);
    }
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
    await this.triggerFullSync({ direction: "push", reason: "incremental" });
  }

  private buildExcludePatterns(settings: PluginSettings): string[] {
    if (settings.syncConfigFolder) {
      return settings.excludePatterns.filter((pattern) => !pattern.startsWith(".obsidian/"));
    }
    return [...settings.excludePatterns];
  }

  private summarizeOperationsForDirection(
    operations: SyncOperation[],
    direction: "bidirectional" | "push" | "pull",
    force: boolean,
  ): SyncOperation[] {
    if (force || direction === "bidirectional") {
      return operations;
    }
    if (direction === "push") {
      return operations.map((operation) => (operation.type === "conflict" ? { ...operation, type: "upload" } : operation));
    }
    return operations.map((operation) => (operation.type === "conflict" ? { ...operation, type: "download" } : operation));
  }

  private protectLocalOperations(
    operations: SyncOperation[],
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    lastSync: Map<string, { mtime: number; size: number; sha256: string } | FileEntry>,
  ): SyncOperation[] {
    const protectedOperations: SyncOperation[] = [];
    for (const operation of operations) {
      if (operation.type === "delete-local") {
        continue;
      }
      if (operation.type === "download") {
        const knownLocally = local.has(operation.path) || lastSync.has(operation.path);
        if (!knownLocally) {
          continue;
        }
        protectedOperations.push(operation);
        continue;
      }
      if (operation.type === "conflict") {
        if (local.has(operation.path)) {
          protectedOperations.push({ ...operation, type: "upload" });
        }
        continue;
      }
      protectedOperations.push(operation);
    }
    return protectedOperations;
  }

  private async executeOperations(
    operations: SyncOperation[],
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    remoteManifest: RemoteManifest,
    direction: "bidirectional" | "push" | "pull",
    force: boolean,
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
          if (force) {
            throw new Error(`Force ${direction} should not produce conflicts (${operation.path})`);
          }
          const resolution =
            direction === "push"
              ? { type: "upload", path: operation.path } as const
              : direction === "pull"
                ? { type: "download", path: operation.path } as const
                : await this.resolver.resolve({
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
            const remoteDownload = await this.fetchRemoteDownload(operation.path, manifestFiles);
            if (!remoteDownload) {
              this.deps.logger.log({
                level: "warning",
                message: "Skipped keep-both conflict copy because remote object disappeared before download",
                operation: "conflict",
                path: operation.path,
              });
              continue;
            }
            try {
              const currentLocal = await this.deps.vault.readBinary(operation.path);
              await this.ensureFolders(resolution.conflictPath);
              this.markInternalMutation(resolution.conflictPath);
              await this.deps.vault.writeBinary(resolution.conflictPath, currentLocal);
            } catch (error) {
              if (!isMissingFileError(error)) {
                throw error;
              }
            }
            await this.applyDownloadedFile(operation.path, manifestFiles, remoteDownload);
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

  private async loadRemoteListing(): Promise<Record<string, FileEntry>> {
    try {
      const files = await this.deps.remote.listFiles();
      this.deps.logger.log({
        level: "info",
        message: `Remote bucket listing loaded: ${Object.keys(files).length} object(s)`,
        operation: "manifest",
      });
      return files;
    } catch (error) {
      this.deps.logger.log({
        level: "warning",
        message: `Remote bucket listing unavailable, continuing with manifest only: ${error instanceof Error ? error.message : String(error)}`,
        operation: "manifest",
      });
      return {};
    }
  }

  private mergeRemoteFiles(manifestFiles: Record<string, FileEntry>, listedFiles: Record<string, FileEntry>): Record<string, FileEntry> {
    const merged: Record<string, FileEntry> = {};

    for (const [path, file] of Object.entries(manifestFiles)) {
      if (file.deleted) {
        merged[path] = { ...file };
      }
    }

    for (const [path, listed] of Object.entries(listedFiles)) {
      const manifestFile = manifestFiles[path];
      merged[path] = manifestFile
        ? {
            ...listed,
            ...manifestFile,
            deleted: false,
            etag: listed.etag || manifestFile.etag,
            mtime: listed.mtime || manifestFile.mtime,
            size: listed.size || manifestFile.size,
          }
        : { ...listed, deleted: false };
    }

    return merged;
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
    const remoteDownload = await this.fetchRemoteDownload(path, manifestFiles);
    if (!remoteDownload) {
      return;
    }
    await this.applyDownloadedFile(path, manifestFiles, remoteDownload);
  }

  private async fetchRemoteDownload(
    path: string,
    manifestFiles: Record<string, FileEntry>,
  ): Promise<{ etag: string; restored: Uint8Array } | null> {
    const remoteMeta = manifestFiles[path];
    try {
      const remoteObject = await this.deps.remote.downloadObject(path);
      const rawBytes = new Uint8Array(remoteObject.body);
      const shouldDecompress =
        remoteMeta?.encoding === "gzip" ||
        (isCompressibleTextPath(path) && isGzipData(rawBytes));
      let restored = rawBytes;
      if (shouldDecompress) {
        try {
          restored = await gzipDecompress(rawBytes);
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          const canFallbackToPlainText =
            isCompressibleTextPath(path) &&
            remoteMeta?.encoding === "gzip" &&
            !isGzipData(rawBytes) &&
            (message.includes("incorrect header check") || message.includes("invalid"));
          if (!canFallbackToPlainText) {
            throw error;
          }
          restored = rawBytes;
          manifestFiles[path] = {
            ...(manifestFiles[path] ?? {
              deleted: false,
              etag: remoteObject.etag,
              mtime: Date.now(),
              sha256: "",
              size: rawBytes.byteLength,
            }),
            deleted: false,
            encoding: "identity",
            etag: remoteObject.etag,
            mtime: manifestFiles[path]?.mtime ?? Date.now(),
            sha256: manifestFiles[path]?.sha256 ?? "",
            size: rawBytes.byteLength,
          };
          this.deps.logger.log({
            level: "info",
            message: "Remote encoding metadata said gzip, but payload was plain text. Falling back to identity.",
            operation: "download",
            path,
          });
        }
      }
      if (remoteMeta?.encoding !== "gzip" && shouldDecompress) {
        this.deps.logger.log({
          level: "warning",
          message: "Recovered gzip-compressed text using byte signature because remote encoding metadata was missing or stale",
          operation: "download",
          path,
        });
      }
      return {
        etag: remoteObject.etag,
        restored,
      };
    } catch (error) {
      if (!isMissingRemoteObjectError(error)) {
        throw error;
      }
      manifestFiles[path] = {
        ...(manifestFiles[path] ?? {
          etag: "",
          mtime: Date.now(),
          sha256: "",
          size: 0,
        }),
        deleted: true,
        encoding: "identity",
        etag: "",
        mtime: Date.now(),
        sha256: "",
        size: 0,
      };
      this.deps.logger.log({
        level: "warning",
        message: "Remote object missing during download; keeping local copy and writing tombstone",
        operation: "download",
        path,
      });
      return null;
    }
  }

  private async applyDownloadedFile(
    path: string,
    manifestFiles: Record<string, FileEntry>,
    remoteDownload: { etag: string; restored: Uint8Array },
  ): Promise<void> {
    await this.createSafetySnapshot(path, "before-download");
    const remoteMeta = manifestFiles[path];
    const { restored } = remoteDownload;
    await this.ensureFolders(path);
    this.markInternalMutation(path);
    await this.deps.vault.writeBinary(
      path,
      restored.buffer.slice(restored.byteOffset, restored.byteOffset + restored.byteLength) as ArrayBuffer,
    );
    const sha = await sha256(restored);
    manifestFiles[path] = {
      ...(manifestFiles[path] ?? { mtime: Date.now(), size: restored.byteLength, deleted: false }),
      deleted: false,
      encoding: remoteMeta?.encoding ?? "identity",
      etag: remoteDownload.etag,
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
        this.markInternalMutation(path);
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

  private buildForceOperations(
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    remote: Map<string, FileEntry>,
    direction: "bidirectional" | "push" | "pull",
  ): SyncOperation[] {
    if (direction === "bidirectional") {
      return this.differ.diff(local, new Map(), remote).filter((operation) => operation.type !== "noop");
    }

    if (direction === "push") {
      const operations: SyncOperation[] = [];
      const paths = new Set([...local.keys(), ...remote.keys()]);
      for (const path of [...paths].sort()) {
        const localEntry = local.get(path);
        const remoteEntry = remote.get(path);
        const remoteExists = Boolean(remoteEntry && !remoteEntry.deleted);
        if (localEntry) {
          if (!remoteExists || remoteEntry?.sha256 !== localEntry.sha256) {
            operations.push({ type: "upload", path });
          }
          continue;
        }
        if (remoteExists) {
          operations.push({ type: "delete-remote", path });
        }
      }
      return operations;
    }

    if (direction === "pull") {
      const operations: SyncOperation[] = [];
      const paths = new Set([...local.keys(), ...remote.keys()]);
      for (const path of [...paths].sort()) {
        const localEntry = local.get(path);
        const remoteEntry = remote.get(path);
        const remoteExists = Boolean(remoteEntry && !remoteEntry.deleted);
        if (remoteExists) {
          if (!localEntry || localEntry.sha256 !== remoteEntry?.sha256) {
            operations.push({ type: "download", path });
          }
          continue;
        }
        if (localEntry) {
          operations.push({ type: "delete-local", path });
        }
      }
      return operations;
    }

    return [];
  }

  private async captureManualActionBackup(
    direction: "push" | "pull",
    operations: SyncOperation[],
    local: Map<string, { mtime: number; size: number; sha256: string }>,
    remote: Map<string, FileEntry>,
    lastSync: LastSyncState,
    remoteManifest: RemoteManifest,
  ): Promise<ManualActionRecord> {
    const previous = await this.deps.actionStore.load();
    if (previous) {
      await this.cleanupManualAction(previous);
    }

    const actionId = globalThis.crypto.randomUUID();
    const action: ManualActionRecord = {
      id: actionId,
      type: direction,
      createdAt: new Date().toISOString(),
      createdLocalPaths: [],
      createdRemotePaths: [],
      localBackups: [],
      remoteBackups: [],
      lastSyncBefore: structuredClone(lastSync),
      remoteManifestBefore: structuredClone(remoteManifest),
    };

    if (direction === "push") {
      for (const operation of operations) {
        if (operation.type === "upload") {
          const remoteEntry = remote.get(operation.path);
          if (!remoteEntry || remoteEntry.deleted) {
            action.createdRemotePaths.push(operation.path);
            continue;
          }
          const backupPath = manualActionBackupPath(actionId, "remote", operation.path);
          const body = await this.readRemoteBackupBody(operation.path, action.remoteManifestBefore);
          if (!body) {
            continue;
          }
          await this.writeBackupFile(backupPath, body);
          action.remoteBackups.push({ backupPath, manifestEntry: { ...remoteEntry }, path: operation.path });
          continue;
        }
        if (operation.type === "delete-remote") {
          const remoteEntry = remote.get(operation.path);
          if (!remoteEntry || remoteEntry.deleted) {
            continue;
          }
          const backupPath = manualActionBackupPath(actionId, "remote", operation.path);
          const body = await this.readRemoteBackupBody(operation.path, action.remoteManifestBefore);
          if (!body) {
            continue;
          }
          await this.writeBackupFile(backupPath, body);
          action.remoteBackups.push({ backupPath, manifestEntry: { ...remoteEntry }, path: operation.path });
        }
      }
    } else {
      for (const operation of operations) {
        if (operation.type === "download") {
          const localEntry = local.get(operation.path);
          if (!localEntry) {
            action.createdLocalPaths.push(operation.path);
            continue;
          }
          const backupPath = manualActionBackupPath(actionId, "local", operation.path);
          await this.writeBackupFile(backupPath, new Uint8Array(await this.deps.vault.readBinary(operation.path)));
          action.localBackups.push({ backupPath, path: operation.path, state: { ...localEntry } });
          continue;
        }
        if (operation.type === "delete-local") {
          const localEntry = local.get(operation.path);
          if (!localEntry) {
            continue;
          }
          const backupPath = manualActionBackupPath(actionId, "local", operation.path);
          await this.writeBackupFile(backupPath, new Uint8Array(await this.deps.vault.readBinary(operation.path)));
          action.localBackups.push({ backupPath, path: operation.path, state: { ...localEntry } });
        }
      }
    }

    this.deps.logger.log({
      level: "info",
      message: `Prepared rollback data for force ${direction}`,
      operation: "manual",
    });
    return action;
  }

  private async readRemoteBackupBody(path: string, manifestBefore: RemoteManifest): Promise<Uint8Array | null> {
    try {
      return new Uint8Array((await this.deps.remote.downloadObject(path)).body);
    } catch (error) {
      if (!isMissingRemoteObjectError(error)) {
        throw error;
      }
      manifestBefore.files[path] = {
        ...(manifestBefore.files[path] ?? {
          deleted: true,
          etag: "",
          mtime: Date.now(),
          sha256: "",
          size: 0,
        }),
        deleted: true,
        encoding: "identity",
        etag: "",
        mtime: Date.now(),
        sha256: "",
        size: 0,
      };
      this.deps.logger.log({
        level: "warning",
        message: "Skipped remote rollback backup because the object was already missing; proceeding with push using a repaired tombstone",
        operation: "manual",
        path,
      });
      return null;
    }
  }

  private async undoPush(action: ManualActionRecord): Promise<void> {
    for (const path of action.createdRemotePaths) {
      await this.deps.remote.deleteObject(path);
    }
    for (const backup of action.remoteBackups) {
      const body = await this.deps.vault.readBinary(backup.backupPath);
      await this.deps.remote.uploadObject(backup.path, body, backup.manifestEntry.mtime);
    }
    await this.deps.remote.putManifest(action.remoteManifestBefore);
  }

  private async undoPull(action: ManualActionRecord): Promise<void> {
    for (const path of action.createdLocalPaths) {
      await this.safeDeleteLocal(path);
    }
    for (const backup of action.localBackups) {
      await this.ensureFolders(backup.path);
      this.markInternalMutation(backup.path);
      await this.deps.vault.writeBinary(backup.path, await this.deps.vault.readBinary(backup.backupPath));
    }
  }

  private async cleanupManualAction(action: ManualActionRecord): Promise<void> {
    const root = manualActionRootPath(action.id);
    const files = await this.deps.vault.listFiles();
    for (const file of files.filter((entry) => entry.path.startsWith(`${root}/`)).sort((left, right) => right.path.localeCompare(left.path))) {
      await this.deps.vault.delete(file.path);
    }
    await this.deps.actionStore.clear();
  }

  private async writeBackupFile(path: string, body: Uint8Array): Promise<void> {
    await this.ensureFolders(path);
    this.markInternalMutation(path);
    await this.deps.vault.writeBinary(
      path,
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    );
  }

  private markInternalMutation(path: string): void {
    this.internalMutationIgnores.set(normalizePathSlashes(path), Date.now() + 15000);
  }

  private shouldIgnoreInternalMutation(path: string): boolean {
    const now = Date.now();
    for (const [trackedPath, expiresAt] of this.internalMutationIgnores.entries()) {
      if (expiresAt <= now) {
        this.internalMutationIgnores.delete(trackedPath);
      }
    }
    const normalized = normalizePathSlashes(path);
    const expiresAt = this.internalMutationIgnores.get(normalized);
    if (!expiresAt) {
      return false;
    }
    if (expiresAt <= now) {
      this.internalMutationIgnores.delete(normalized);
      return false;
    }
    return true;
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
