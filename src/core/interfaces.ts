import type { LastSyncState, LocalFileState, RemoteManifest } from "../types/manifest";
import type { SyncLogEntry } from "../types/settings";

export interface VaultFileRecord {
  path: string;
  mtime: number;
  size: number;
}

export interface VaultPort {
  listFiles(): Promise<VaultFileRecord[]>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  getVaultName(): string;
}

export interface LastSyncStore {
  load(): Promise<LastSyncState>;
  save(state: LastSyncState): Promise<void>;
}

export interface S3ObjectRecord {
  body: ArrayBuffer;
  etag: string;
}

export interface RemoteStore {
  getManifest(): Promise<{ manifest: RemoteManifest; etag: string }>;
  putManifest(manifest: RemoteManifest): Promise<string>;
  uploadObject(path: string, body: ArrayBuffer, mtime: number): Promise<{ etag: string }>;
  downloadObject(path: string): Promise<S3ObjectRecord>;
  deleteObject(path: string): Promise<void>;
  testConnection(): Promise<void>;
}

export interface LoggerPort {
  log(entry: Omit<SyncLogEntry, "id" | "timestamp">): void;
}

export interface StatusPort {
  setStatus(status: "idle" | "syncing" | "conflict" | "error", detail?: string): void;
  setProgress(current: number, total: number): void;
}

export interface NotificationPort {
  notify(message: string): void;
  error(message: string): void;
}

export type LocalStateMap = Map<string, LocalFileState>;
