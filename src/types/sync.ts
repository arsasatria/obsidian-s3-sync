import type { ConflictRule } from "./settings";
import type { FileEntry, LocalFileState } from "./manifest";

export type SyncOperationType =
  | "noop"
  | "upload"
  | "download"
  | "delete-local"
  | "delete-remote"
  | "conflict";

export interface SyncOperation {
  type: SyncOperationType;
  path: string;
  localMtime?: number;
  remoteMtime?: number;
}

export interface ResolvedConflict {
  type: "upload" | "download" | "keep-both";
  path: string;
  conflictPath?: string;
}

export interface ConflictContext {
  path: string;
  local?: LocalFileState;
  remote?: FileEntry;
  lastSync?: LocalFileState | FileEntry;
}

export interface ConflictDecision {
  rule: ConflictRule;
}

export interface SyncPlanSummary {
  upload: number;
  download: number;
  deleteLocal: number;
  deleteRemote: number;
  conflict: number;
}

export interface SyncRunResult {
  applied: boolean;
  operations: SyncOperation[];
  summary: SyncPlanSummary;
}

export interface SyncExecutionOptions {
  direction?: "bidirectional" | "push" | "pull";
  dryRun?: boolean;
  notifyErrors?: boolean;
  reason?: string;
  force?: boolean;
  localSafe?: boolean;
}
