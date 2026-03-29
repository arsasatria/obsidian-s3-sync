export interface FileEntry {
  mtime: number;
  size: number;
  etag: string;
  sha256: string;
  deleted: boolean;
  encoding?: "identity" | "gzip";
}

export interface LocalFileState {
  mtime: number;
  size: number;
  sha256: string;
}

export interface RemoteManifest {
  version: string;
  generated_at: string;
  device_id: string;
  vault_name: string;
  files: Record<string, FileEntry>;
}

export interface LastSyncState {
  synced_at: string;
  remote_manifest_etag: string;
  files: Record<string, LocalFileState>;
}
