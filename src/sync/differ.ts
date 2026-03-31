import type { FileEntry, LocalFileState } from "../types/manifest";
import type { SyncOperation } from "../types/sync";

export class ThreeWayDiffer {
  diff(
    local: Map<string, LocalFileState>,
    lastSync: Map<string, LocalFileState | FileEntry>,
    remote: Map<string, FileEntry>,
  ): SyncOperation[] {
    const paths = new Set([...local.keys(), ...lastSync.keys(), ...remote.keys()]);
    return [...paths].sort().map((path) => this.diffOne(path, local.get(path), lastSync.get(path), remote.get(path)));
  }

  private diffOne(
    path: string,
    local?: LocalFileState,
    lastSync?: LocalFileState | FileEntry,
    remote?: FileEntry,
  ): SyncOperation {
    const localExists = Boolean(local);
    const lastSyncExists = Boolean(lastSync);
    const remoteExists = Boolean(remote && !remote.deleted);
    const remoteDeleted = Boolean(remote?.deleted);

    if (localExists && !lastSyncExists && !remoteExists) {
      return { type: "upload", path };
    }

    if (!localExists && !lastSyncExists && remoteExists) {
      return { type: "download", path };
    }

    if (!localExists && !lastSyncExists && !remoteExists) {
      return { type: "noop", path };
    }

    if (!localExists && lastSyncExists && remoteExists) {
      const lastHash = lastSync?.sha256 ?? "";
      if (remote?.sha256 === lastHash) {
        return { type: "delete-remote", path };
      }
      return { type: "conflict", path, localMtime: 0, remoteMtime: remote?.mtime };
    }

    if (localExists && lastSyncExists && !remoteExists) {
      const lastHash = lastSync?.sha256 ?? "";
      if (remoteDeleted && local?.sha256 === lastHash) {
        return { type: "delete-local", path };
      }
      if (!remoteDeleted && local?.sha256 === lastHash) {
        return { type: "noop", path };
      }
      return { type: "conflict", path, localMtime: local?.mtime, remoteMtime: 0 };
    }

    if (localExists && remoteExists) {
      const lastHash = lastSync?.sha256;
      const localChanged = !lastSyncExists || local?.sha256 !== lastHash;
      const remoteChanged = !lastSyncExists || remote?.sha256 !== lastHash;

      if (!localChanged && !remoteChanged) {
        return { type: "noop", path };
      }

      if (local?.sha256 === remote?.sha256) {
        return { type: "noop", path };
      }

      if (localChanged && !remoteChanged) {
        return { type: "upload", path };
      }

      if (!localChanged && remoteChanged) {
        return { type: "download", path };
      }

      return {
        type: "conflict",
        path,
        localMtime: local?.mtime,
        remoteMtime: remote?.mtime,
      };
    }

    return { type: "noop", path };
  }
}
