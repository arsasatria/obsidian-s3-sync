import type { LastSyncState, LocalFileState, RemoteManifest } from "./manifest";

export type ManualActionType = "push" | "pull";

export interface ManualActionLocalBackup {
  path: string;
  state: LocalFileState;
  backupPath: string;
}

export interface ManualActionRemoteBackup {
  path: string;
  manifestEntry: RemoteManifest["files"][string];
  backupPath: string;
}

export interface ManualActionRecord {
  id: string;
  type: ManualActionType;
  createdAt: string;
  createdLocalPaths: string[];
  createdRemotePaths: string[];
  localBackups: ManualActionLocalBackup[];
  remoteBackups: ManualActionRemoteBackup[];
  lastSyncBefore: LastSyncState;
  remoteManifestBefore: RemoteManifest;
}
