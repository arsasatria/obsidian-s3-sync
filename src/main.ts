import { Notice, Platform, Plugin } from "obsidian";
import { createS3Client } from "./s3/client";
import { AwsRemoteStore } from "./s3/store";
import { DEFAULT_EXCLUDES, DEFAULT_SETTINGS, type PluginSettings, type SyncLogEntry } from "./types/settings";
import { ObsidianLastSyncStore } from "./obsidian/last-sync-store";
import { ObsidianManualActionStore } from "./obsidian/manual-action-store";
import { ObsidianVaultPort } from "./obsidian/vault-port";
import { SettingsLogger } from "./obsidian/logger";
import { ObsidianNotificationPort } from "./obsidian/notifications";
import { StatusManager } from "./obsidian/status-manager";
import { SyncOrchestrator } from "./sync/orchestrator";
import { S3SyncSettingTab } from "./settings/tab";
import { ConflictModal } from "./ui/conflict-modal";
import { DryRunModal } from "./ui/dry-run-modal";
import { LOG_VIEW_TYPE, SyncLogView } from "./ui/log-view";
import { MONITOR_VIEW_TYPE, SyncMonitorView } from "./ui/monitor-view";
import { VaultWatcher } from "./vault/watcher";
import type { ConflictContext } from "./types/sync";

export default class ObsidianS3SyncPlugin extends Plugin {
  settings!: PluginSettings;
  orchestrator!: SyncOrchestrator;
  private statusManager!: StatusManager;
  private watcher?: VaultWatcher;
  private scheduleTimer: number | null = null;
  private pollingTimer: number | null = null;
  private safeBootResumeTimer: number | null = null;
  private readonly safeBootDurationMs = 30 * 60 * 1000;
  private readonly safeBootFailureThreshold = 3;
  private readonly safeBootFailureWindowMs = 2 * 60 * 1000;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      LOG_VIEW_TYPE,
      (leaf) =>
        new SyncLogView(
          leaf,
          () => this.settings,
          () => void this.clearLogs(),
          {
            pull: () => this.runPull(),
            push: () => this.runPush(),
            sync: () => this.runSync(),
            undo: () => this.undoLastManualAction(),
          },
        ),
    );
    this.registerView(
      MONITOR_VIEW_TYPE,
      (leaf) => new SyncMonitorView(leaf, this),
    );

    this.statusManager = new StatusManager(this, {
      openLog: () => void this.openLogView(),
      openMonitor: () => void this.openMonitorView(),
      pull: () => void this.runPull(),
      push: () => void this.runPush(),
      sync: () => void this.runSync(),
      undo: () => void this.undoLastManualAction(),
    });
    this.addRibbonIcon("activity", "S3 Sync: Live monitor", () => void this.openMonitorView());
    this.createOrchestrator();
    this.addSettingTab(new S3SyncSettingTab(this));

    this.addCommand({
      id: "s3-sync-run-now",
      name: "Run full sync now",
      callback: () => void this.runSync(),
    });

    this.addCommand({
      id: "s3-sync-dry-run",
      name: "Preview sync plan (dry run)",
      callback: () => void this.runSync({ dryRun: true }),
    });
    this.addCommand({
      id: "s3-sync-push-now",
      name: "Push local state to S3",
      callback: () => void this.runPush(),
    });
    this.addCommand({
      id: "s3-sync-fetch-now",
      name: "Pull remote state from S3",
      callback: () => void this.runPull(),
    });
    this.addCommand({
      id: "s3-sync-undo-last-manual-action",
      name: "Undo last force push/pull",
      callback: () => void this.undoLastManualAction(),
    });
    this.addCommand({
      id: "s3-sync-open-monitor",
      name: "Open live sync monitor",
      callback: () => void this.openMonitorView(),
    });

    this.refreshSchedule();

    this.app.workspace.onLayoutReady(() => {
      this.watcher = new VaultWatcher(this.app.vault, this.orchestrator, this.settings);
      this.watcher.register(this);
      this.registerDomEvent(window, "focus", () => {
        if (!this.shouldRunAutomaticSync("window-focus")) {
          return;
        }
        void this.runPull({ silent: true, reason: "window-focus" });
      });
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState !== "visible" || !this.shouldRunAutomaticSync("visibility")) {
          return;
        }
        void this.runPull({ silent: true, reason: "visibility" });
      });
      if (this.shouldRunAutomaticSync("startup")) {
        void this.runSync({ silent: true, reason: "startup" });
      } else if (this.isSafeBootActive()) {
        new Notice("S3 Sync safe boot active: background automation is paused temporarily", 6000);
      }
    });
  }

  onunload(): void {
    if (this.scheduleTimer !== null) {
      window.clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.pollingTimer !== null) {
      window.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.safeBootResumeTimer !== null) {
      window.clearTimeout(this.safeBootResumeTimer);
      this.safeBootResumeTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      excludePatterns: this.mergeDefaultExcludes(loaded?.excludePatterns),
      deviceId: loaded?.deviceId || globalThis.crypto.randomUUID(),
      logs: loaded?.logs ?? [],
    };
    // Safety-first migration: disable smart text compression until the vault path is fully proven stable.
    this.settings.smartTextCompression = false;
    this.applyPlatformSafetyDefaults(loaded ?? {});
    await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private mergeDefaultExcludes(loadedExcludes?: string[]): string[] {
    const merged = [...(loadedExcludes ?? [])];
    for (const pattern of DEFAULT_EXCLUDES) {
      if (!merged.includes(pattern)) {
        merged.push(pattern);
      }
    }
    return merged;
  }

  refreshSchedule(): void {
    if (this.scheduleTimer !== null) {
      window.clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.pollingTimer !== null) {
      window.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.safeBootResumeTimer !== null) {
      window.clearTimeout(this.safeBootResumeTimer);
      this.safeBootResumeTimer = null;
    }
    if (this.isSafeBootActive()) {
      const resumeInMs = Math.max(1000, Date.parse(this.settings.safeBootUntil as string) - Date.now());
      this.safeBootResumeTimer = window.setTimeout(() => {
        this.settings.safeBootUntil = null;
        void this.saveSettings();
        this.refreshSchedule();
      }, resumeInMs);
      this.registerInterval(this.safeBootResumeTimer);
      return;
    }

    const intervalMs = scheduleToMs(this.settings.scheduledSyncInterval);
    if (intervalMs) {
      this.scheduleTimer = window.setInterval(() => {
        void this.runSync({ reason: "scheduled-sync" });
      }, intervalMs);
      this.registerInterval(this.scheduleTimer);
    }
    if (this.settings.remotePollingEnabled && this.settings.remotePollingIntervalSec > 0) {
      this.pollingTimer = window.setInterval(() => {
        void this.runPull({ silent: true, reason: "remote-poll" });
      }, this.settings.remotePollingIntervalSec * 1000);
      this.registerInterval(this.pollingTimer);
    }
  }

  async openLogView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      active: true,
      type: LOG_VIEW_TYPE,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async openMonitorView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MONITOR_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      active: true,
      type: MONITOR_VIEW_TYPE,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async testConnection(): Promise<void> {
    try {
      this.validateConnectionSettings();
      this.createOrchestrator();
      await this.orchestrator.testConnection();
      new Notice("S3 connection successful");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const friendlyMessage =
        message === "Failed to fetch"
          ? "Connection failed: Failed to fetch. This usually means the endpoint is blocked by CORS, TLS/certificate issues, DNS/network reachability, or the server rejects browser-based requests."
          : `Connection failed: ${message}`;
      new Notice(friendlyMessage, 12000);
    }
  }

  async runSync(options?: { dryRun?: boolean; reason?: string; silent?: boolean }): Promise<void> {
    this.createOrchestrator();
    const isManual = !options?.silent;
    let liveNotice: Notice | null = null;
    if (isManual) {
      liveNotice = new Notice("S3 Sync: Starting full sync...", 0);
    }
    if (options?.dryRun || this.settings.dryRunDefault) {
      const dryRun = await this.orchestrator.triggerFullSync({ direction: "bidirectional", dryRun: true, reason: options?.reason });
      const confirmed = await new DryRunModal(this.app, dryRun.operations, dryRun.summary).openAndWait();
      if (!confirmed) {
        liveNotice?.hide();
        return;
      }
    }

    try {
      const result = await this.orchestrator.triggerFullSync({
        direction: "bidirectional",
        notifyErrors: isManual,
        reason: options?.reason,
      });
      await this.trackAutomaticSuccess(options?.reason);
      this.settings.lastSuccessfulSyncAt = new Date().toISOString();
      await this.saveSettings();
      if (isManual) {
        liveNotice?.setMessage(
          `S3 Sync complete: ${result.summary.upload} upload, ${result.summary.download} download, ${result.summary.conflict} conflict`,
        );
        window.setTimeout(() => liveNotice?.hide(), 2500);
      } else if (this.settings.notifyOnSuccess) {
        new Notice(
          `S3 Sync complete: ${result.summary.upload} upload, ${result.summary.download} download, ${result.summary.conflict} conflict`,
        );
      }
    } catch (error) {
      await this.trackAutomaticFailure(options?.reason);
      if (isManual) {
        liveNotice?.setMessage(`S3 Sync failed: ${error instanceof Error ? error.message : String(error)}`);
        window.setTimeout(() => liveNotice?.hide(), 4000);
      }
      throw error;
    }

    const leaves = this.app.workspace.getLeavesOfType(LOG_VIEW_TYPE);
    leaves.forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof SyncLogView) {
        view.render();
      }
    });
    this.refreshMonitorViews();
  }

  async runPush(options?: { dryRun?: boolean; reason?: string; silent?: boolean }): Promise<void> {
    this.createOrchestrator();
    const isManual = !options?.silent;
    const forceMode = isManual;
    const liveNotice = isManual ? new Notice("S3 Sync: Preparing force push...", 0) : null;
    try {
      if (forceMode) {
        const preview = await this.orchestrator.triggerFullSync({
          direction: "push",
          dryRun: true,
          force: forceMode,
          notifyErrors: isManual,
          reason: options?.reason ?? "manual-push",
        });
        const confirmed = await new DryRunModal(this.app, preview.operations, preview.summary, {
          confirmText: "Force Push",
          description: "Replace S3 with the current local vault state. A rollback snapshot will be created first.",
          title: "Force push preview",
        }).openAndWait();
        if (!confirmed) {
          liveNotice?.hide();
          return;
        }
        liveNotice?.setMessage("S3 Sync: Force pushing local vault to S3...");
      }
      const result = await this.orchestrator.triggerFullSync({
        direction: "push",
        dryRun: options?.dryRun,
        force: forceMode,
        notifyErrors: isManual,
        reason: options?.reason ?? "manual-push",
      });
      await this.trackAutomaticSuccess(options?.reason);
      if (!options?.dryRun) {
        this.settings.lastSuccessfulSyncAt = new Date().toISOString();
        await this.saveSettings();
      }
      if (isManual && !options?.dryRun) {
        liveNotice?.setMessage(
          `S3 Push complete: ${result.summary.upload} upload, ${result.summary.deleteRemote} remote delete, undo ready`,
        );
        window.setTimeout(() => liveNotice?.hide(), 2500);
      } else if (this.settings.notifyOnSuccess && !options?.dryRun) {
        new Notice(`S3 Push complete: ${result.summary.upload} upload, ${result.summary.deleteRemote} remote delete, undo ready`);
      }
    } catch (error) {
      await this.trackAutomaticFailure(options?.reason);
      if (isManual) {
        liveNotice?.setMessage(`S3 Push failed: ${error instanceof Error ? error.message : String(error)}`);
        window.setTimeout(() => liveNotice?.hide(), 4000);
      }
      throw error;
    }
    this.refreshMonitorViews();
  }

  async runPull(options?: { dryRun?: boolean; reason?: string; silent?: boolean }): Promise<void> {
    this.createOrchestrator();
    const isManual = !options?.silent;
    const forceMode = isManual;
    const liveNotice = isManual ? new Notice("S3 Sync: Preparing force pull...", 0) : null;
    try {
      if (forceMode) {
        const preview = await this.orchestrator.triggerFullSync({
          direction: "pull",
          dryRun: true,
          force: forceMode,
          notifyErrors: isManual,
          reason: options?.reason ?? "manual-pull",
        });
        const confirmed = await new DryRunModal(this.app, preview.operations, preview.summary, {
          confirmText: "Force Pull",
          description: "Replace the local vault with the latest S3 state. A rollback snapshot will be created first.",
          title: "Force pull preview",
        }).openAndWait();
        if (!confirmed) {
          liveNotice?.hide();
          return;
        }
        liveNotice?.setMessage("S3 Sync: Force pulling S3 into local vault...");
      }
      const result = await this.orchestrator.triggerFullSync({
        direction: "pull",
        dryRun: options?.dryRun,
        force: forceMode,
        notifyErrors: isManual,
        reason: options?.reason ?? "manual-pull",
      });
      await this.trackAutomaticSuccess(options?.reason);
      if (!options?.dryRun) {
        this.settings.lastSuccessfulSyncAt = new Date().toISOString();
        await this.saveSettings();
      }
      if (isManual && !options?.dryRun) {
        liveNotice?.setMessage(
          `S3 Pull complete: ${result.summary.download} download, ${result.summary.deleteLocal} local delete, undo ready`,
        );
        window.setTimeout(() => liveNotice?.hide(), 2500);
      } else if (this.settings.notifyOnSuccess && !options?.dryRun) {
        new Notice(`S3 Pull complete: ${result.summary.download} download, ${result.summary.deleteLocal} local delete, undo ready`);
      }
    } catch (error) {
      await this.trackAutomaticFailure(options?.reason);
      if (isManual) {
        liveNotice?.setMessage(`S3 Pull failed: ${error instanceof Error ? error.message : String(error)}`);
        window.setTimeout(() => liveNotice?.hide(), 4000);
      }
      throw error;
    }
    this.refreshMonitorViews();
  }

  async undoLastManualAction(): Promise<void> {
    this.createOrchestrator();
    const liveNotice = new Notice("S3 Sync: Restoring last manual action...", 0);
    try {
      const action = await this.orchestrator.undoLastManualAction();
      if (!action) {
        liveNotice.setMessage("S3 Sync: No manual push/pull to undo");
        window.setTimeout(() => liveNotice.hide(), 2500);
        return;
      }
      liveNotice.setMessage(`S3 Sync: Undo ${action.type} complete`);
      window.setTimeout(() => liveNotice.hide(), 2500);
    } catch (error) {
      liveNotice.setMessage(`S3 Sync: Undo failed: ${error instanceof Error ? error.message : String(error)}`);
      window.setTimeout(() => liveNotice.hide(), 4000);
      throw error;
    }
  }

  appendLogs(logs: SyncLogEntry[]): void {
    this.settings.logs = logs;
    void this.saveSettings();
  }

  async clearLogs(): Promise<void> {
    this.settings.logs = [];
    await this.saveSettings();
  }

  async clearSafeBoot(): Promise<void> {
    this.settings.safeBootUntil = null;
    this.settings.startupFailureCount = 0;
    this.settings.startupFailureWindowStartedAt = null;
    await this.saveSettings();
    this.refreshSchedule();
  }

  private createOrchestrator(): void {
    const lastSyncStore = new ObsidianLastSyncStore(
      this.app.vault.adapter,
      `${this.app.vault.configDir}/plugins/${this.manifest.id}/last-sync.json`,
    );
    const actionStore = new ObsidianManualActionStore(
      this.app.vault.adapter,
      `${this.app.vault.configDir}/plugins/${this.manifest.id}/last-manual-action.json`,
    );
    const logger = new SettingsLogger(
      () => this.settings,
      (logs) => {
        this.settings.logs = logs;
        void this.saveSettings();
        this.refreshMonitorViews();
      },
    );
    const vault = new ObsidianVaultPort(this.app.vault);
    const notifier = new ObsidianNotificationPort();

    this.orchestrator = new SyncOrchestrator({
      actionStore,
      conflictPrompt: async (context: ConflictContext) => new ConflictModal(this.app, context).openAndWait(),
      deviceId: this.settings.deviceId,
      lastSyncStore,
      logger,
      notifier,
      remote: new AwsRemoteStore(createS3Client(this.settings), this.settings),
      settings: this.settings,
      status: this.statusManager,
      vault,
    });
  }

  private validateConnectionSettings(): void {
    if (!this.settings.endpoint.trim()) {
      throw new Error("Endpoint URL is required");
    }
    if (!this.settings.bucketName.trim()) {
      throw new Error("Bucket name is required");
    }
    if (!this.settings.accessKeyId.trim()) {
      throw new Error("Access key ID is required");
    }
    if (!this.settings.secretAccessKey.trim()) {
      throw new Error("Secret access key is required");
    }
  }

  private refreshMonitorViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(MONITOR_VIEW_TYPE);
    leaves.forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof SyncMonitorView) {
        view.render();
      }
    });
  }

  private applyPlatformSafetyDefaults(loaded: Partial<PluginSettings>): void {
    if (!Platform.isMobileApp || !this.settings.mobileSafeMode) {
      return;
    }

    this.settings.remotePollingEnabled = false;
    this.settings.syncOnWindowFocus = false;
    this.settings.smartTextCompression = false;
    this.settings.createSafetySnapshots = false;
    this.settings.debounceDelayMs = Math.max(this.settings.debounceDelayMs, 5000);
    this.settings.requestTimeoutMs = Math.max(this.settings.requestTimeoutMs, 45000);
    this.settings.maxRetries = Math.max(this.settings.maxRetries, 5);
  }

  private isSafeBootActive(): boolean {
    if (!this.settings.safeBootEnabled || !this.settings.safeBootUntil) {
      return false;
    }
    const until = Date.parse(this.settings.safeBootUntil);
    if (!Number.isFinite(until)) {
      return false;
    }
    return until > Date.now();
  }

  private async trackAutomaticFailure(reason?: string): Promise<void> {
    if (!reason || !this.settings.safeBootEnabled) {
      return;
    }
    const automaticReasons = new Set(["startup", "scheduled-sync", "remote-poll", "window-focus", "visibility"]);
    if (!automaticReasons.has(reason)) {
      return;
    }

    const now = Date.now();
    const windowStartedAt = this.settings.startupFailureWindowStartedAt ? Date.parse(this.settings.startupFailureWindowStartedAt) : Number.NaN;
    const withinWindow = Number.isFinite(windowStartedAt) && now - windowStartedAt <= this.safeBootFailureWindowMs;
    if (!withinWindow) {
      this.settings.startupFailureWindowStartedAt = new Date(now).toISOString();
      this.settings.startupFailureCount = 1;
    } else {
      this.settings.startupFailureCount += 1;
    }

    if (this.settings.startupFailureCount >= this.safeBootFailureThreshold) {
      this.settings.safeBootUntil = new Date(now + this.safeBootDurationMs).toISOString();
      this.settings.startupFailureCount = 0;
      this.settings.startupFailureWindowStartedAt = null;
      await this.saveSettings();
      this.refreshSchedule();
      new Notice("S3 Sync safe boot active: background sync paused temporarily", 8000);
      return;
    }

    await this.saveSettings();
  }

  private async trackAutomaticSuccess(reason?: string): Promise<void> {
    if (!reason) {
      return;
    }
    const automaticReasons = new Set(["startup", "scheduled-sync", "remote-poll", "window-focus", "visibility"]);
    if (!automaticReasons.has(reason)) {
      return;
    }
    if (!this.settings.startupFailureCount && !this.settings.startupFailureWindowStartedAt) {
      return;
    }
    this.settings.startupFailureCount = 0;
    this.settings.startupFailureWindowStartedAt = null;
    await this.saveSettings();
  }

  private shouldRunAutomaticSync(reason: "startup" | "window-focus" | "visibility"): boolean {
    if (this.isSafeBootActive()) {
      return false;
    }
    if (reason === "startup") {
      return this.settings.syncOnStartup;
    }
    return this.settings.syncOnWindowFocus;
  }
}

function scheduleToMs(interval: PluginSettings["scheduledSyncInterval"]): number | null {
  if (interval === "5m") return 5 * 60 * 1000;
  if (interval === "15m") return 15 * 60 * 1000;
  if (interval === "30m") return 30 * 60 * 1000;
  if (interval === "1h") return 60 * 60 * 1000;
  return null;
}
