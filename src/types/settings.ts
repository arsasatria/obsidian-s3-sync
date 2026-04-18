export type ConflictRule = "keep-local" | "keep-remote" | "keep-both" | "ask-user";
export type ScheduleInterval = "manual" | "5m" | "15m" | "30m" | "1h";
export type SyncStatus = "idle" | "syncing" | "conflict" | "error";
export type SyncDirection = "bidirectional" | "push" | "pull";

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  operation:
    | "upload"
    | "download"
    | "delete-local"
    | "delete-remote"
    | "conflict"
    | "manual"
    | "manifest"
    | "system"
    | "scan-local"
    | "queue"
    | "manual";
  path?: string;
  message: string;
  durationMs?: number;
}

export interface PluginSettings {
  endpoint: string;
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  prefix: string;
  forcePathStyle: boolean;
  syncOnSave: boolean;
  scheduledSyncInterval: ScheduleInterval;
  syncOnStartup: boolean;
  syncConfigFolder: boolean;
  defaultConflictRule: ConflictRule;
  excludePatterns: string[];
  requestTimeoutMs: number;
  maxRetries: number;
  debounceDelayMs: number;
  largeFileThresholdBytes: number;
  dryRunDefault: boolean;
  remotePollingEnabled: boolean;
  remotePollingIntervalSec: number;
  syncOnWindowFocus: boolean;
  mobileSafeMode: boolean;
  createSafetySnapshots: boolean;
  maxSafetySnapshotsPerFile: number;
  smartTextCompression: boolean;
  compressionMinSavingsPercent: number;
  notifyOnSuccess: boolean;
  notifyOnError: boolean;
  debugLogging: boolean;
  safeBootEnabled: boolean;
  safeBootUntil: string | null;
  startupFailureCount: number;
  startupFailureWindowStartedAt: string | null;
  maxLogEntries: number;
  deviceId: string;
  logs: SyncLogEntry[];
  lastSuccessfulSyncAt: string | null;
}

export const DEFAULT_EXCLUDES = [
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  "*.conflict-*",
  ".trash/**",
  ".s3sync-actions/**",
  ".s3sync-safety/**",
];

export const DEFAULT_SETTINGS: PluginSettings = {
  endpoint: "",
  bucketName: "",
  region: "",
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
  prefix: "",
  forcePathStyle: true,
  syncOnSave: true,
  scheduledSyncInterval: "manual",
  syncOnStartup: false,
  syncConfigFolder: false,
  defaultConflictRule: "keep-both",
  excludePatterns: [...DEFAULT_EXCLUDES],
  requestTimeoutMs: 30000,
  maxRetries: 3,
  debounceDelayMs: 3000,
  largeFileThresholdBytes: 5 * 1024 * 1024,
  dryRunDefault: false,
  remotePollingEnabled: true,
  remotePollingIntervalSec: 10,
  syncOnWindowFocus: true,
  mobileSafeMode: true,
  createSafetySnapshots: true,
  maxSafetySnapshotsPerFile: 3,
  smartTextCompression: true,
  compressionMinSavingsPercent: 10,
  notifyOnSuccess: false,
  notifyOnError: true,
  debugLogging: false,
  safeBootEnabled: true,
  safeBootUntil: null,
  startupFailureCount: 0,
  startupFailureWindowStartedAt: null,
  maxLogEntries: 500,
  deviceId: "",
  logs: [],
  lastSuccessfulSyncAt: null,
};
