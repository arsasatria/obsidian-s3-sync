import { PluginSettingTab, Setting } from "obsidian";
import type ObsidianS3SyncPlugin from "../main";
import type { ConflictRule, ScheduleInterval } from "../types/settings";

export class S3SyncSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ObsidianS3SyncPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "S3 Sync Settings" });

    new Setting(containerEl).setName("Endpoint URL").addText((text) =>
      text.setValue(settings.endpoint).onChange(async (value) => {
        settings.endpoint = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Bucket name").addText((text) =>
      text.setValue(settings.bucketName).onChange(async (value) => {
        settings.bucketName = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Region").addText((text) =>
      text.setPlaceholder("Optional, defaults to auto").setValue(settings.region).onChange(async (value) => {
        settings.region = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Access key ID").addText((text) =>
      text.setValue(settings.accessKeyId).onChange(async (value) => {
        settings.accessKeyId = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Secret access key").addText((text) =>
      text.setPlaceholder("Hidden").setValue(settings.secretAccessKey).onChange(async (value) => {
        settings.secretAccessKey = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Session token").addText((text) =>
      text.setValue(settings.sessionToken).onChange(async (value) => {
        settings.sessionToken = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Prefix").setDesc("Optional bucket prefix for multi-vault sync").addText((text) =>
      text.setValue(settings.prefix).onChange(async (value) => {
        settings.prefix = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Force path style").setDesc("Required for MinIO and many self-hosted S3 services").addToggle((toggle) =>
      toggle.setValue(settings.forcePathStyle).onChange(async (value) => {
        settings.forcePathStyle = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Sync on save").addToggle((toggle) =>
      toggle.setValue(settings.syncOnSave).onChange(async (value) => {
        settings.syncOnSave = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Mobile safe mode").setDesc("Use more conservative defaults on Android/iOS to reduce sync failures caused by mobile filesystem/runtime quirks").addToggle((toggle) =>
      toggle.setValue(settings.mobileSafeMode).onChange(async (value) => {
        settings.mobileSafeMode = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(containerEl).setName("Sync on startup").addToggle((toggle) =>
      toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
        settings.syncOnStartup = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Sync .obsidian folder").addToggle((toggle) =>
      toggle.setValue(settings.syncConfigFolder).onChange(async (value) => {
        settings.syncConfigFolder = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Conflict rule").addDropdown((dropdown) => {
      const choices: ConflictRule[] = ["keep-local", "keep-remote", "keep-both", "ask-user"];
      choices.forEach((choice) => dropdown.addOption(choice, choice));
      dropdown.setValue(settings.defaultConflictRule).onChange(async (value) => {
        settings.defaultConflictRule = value as ConflictRule;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Scheduled sync").addDropdown((dropdown) => {
      const choices: ScheduleInterval[] = ["manual", "5m", "15m", "30m", "1h"];
      choices.forEach((choice) => dropdown.addOption(choice, choice));
      dropdown.setValue(settings.scheduledSyncInterval).onChange(async (value) => {
        settings.scheduledSyncInterval = value as ScheduleInterval;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      });
    });

    new Setting(containerEl).setName("Near-realtime remote polling").setDesc("Continuously fetch remote changes on a short interval").addToggle((toggle) =>
      toggle.setValue(settings.remotePollingEnabled).onChange(async (value) => {
        settings.remotePollingEnabled = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(containerEl).setName("Remote polling interval (seconds)").setDesc("Recommended 5-15 seconds for aggressive collaboration").addText((text) =>
      text.setValue(String(settings.remotePollingIntervalSec)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.remotePollingIntervalSec = Number.isFinite(nextValue) ? Math.max(3, nextValue) : 10;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(containerEl).setName("Fetch on focus").setDesc("Pull remote changes whenever Obsidian regains focus").addToggle((toggle) =>
      toggle.setValue(settings.syncOnWindowFocus).onChange(async (value) => {
        settings.syncOnWindowFocus = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(containerEl).setName("Create safety snapshots").setDesc("Keep local safety copies before overwrite or delete").addToggle((toggle) =>
      toggle.setValue(settings.createSafetySnapshots).onChange(async (value) => {
        settings.createSafetySnapshots = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Safety snapshots per file").setDesc("Old safety snapshots are pruned automatically").addText((text) =>
      text.setValue(String(settings.maxSafetySnapshotsPerFile)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "3", 10);
        settings.maxSafetySnapshotsPerFile = Number.isFinite(nextValue) ? Math.max(1, nextValue) : 3;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Smart text compression").setDesc("Store compressible text files in S3 as gzip when it meaningfully saves space").addToggle((toggle) =>
      toggle.setValue(settings.smartTextCompression).onChange(async (value) => {
        settings.smartTextCompression = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Compression minimum savings (%)").setDesc("Only compress when the space saving is worth it").addText((text) =>
      text.setValue(String(settings.compressionMinSavingsPercent)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.compressionMinSavingsPercent = Number.isFinite(nextValue) ? Math.max(0, Math.min(90, nextValue)) : 10;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Exclude patterns").setDesc("One glob pattern per line").addTextArea((text) =>
      text.setValue(settings.excludePatterns.join("\n")).onChange(async (value) => {
        settings.excludePatterns = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Desktop notifications").addToggle((toggle) =>
      toggle.setValue(settings.notifyOnSuccess || settings.notifyOnError).onChange(async (value) => {
        settings.notifyOnSuccess = value;
        settings.notifyOnError = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Debug logging").setDesc("Store low-level scan, queue, and manifest activity in the sync log").addToggle((toggle) =>
      toggle.setValue(settings.debugLogging).onChange(async (value) => {
        settings.debugLogging = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(containerEl).setName("Safe boot mode").setDesc("If background sync fails repeatedly during startup/focus/polling, pause automation temporarily so the UI stays usable").addToggle((toggle) =>
      toggle.setValue(settings.safeBootEnabled).onChange(async (value) => {
        settings.safeBootEnabled = value;
        if (!value) {
          settings.safeBootUntil = null;
          settings.startupFailureCount = 0;
          settings.startupFailureWindowStartedAt = null;
        }
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
        this.display();
      }),
    );

    const safeBootDesc = settings.safeBootUntil
      ? `Background sync paused until ${new Date(settings.safeBootUntil).toLocaleString()}`
      : "No active safe boot pause";
    new Setting(containerEl)
      .setName("Safe boot status")
      .setDesc(safeBootDesc)
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          await this.plugin.clearSafeBoot();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Validate endpoint and credentials")
      .addButton((button) =>
        button.setButtonText("Run").setCta().onClick(async () => {
          await this.plugin.testConnection();
        }),
      );

    new Setting(containerEl)
      .setName("Manual actions")
      .setDesc("Quick access to push, fetch, and full sync")
      .addButton((button) => button.setButtonText("Push").onClick(async () => this.plugin.runPush()))
      .addButton((button) => button.setButtonText("Fetch").onClick(async () => this.plugin.runPull()))
      .addButton((button) => button.setButtonText("Sync").setCta().onClick(async () => this.plugin.runSync()));

    new Setting(containerEl)
      .setName("Open sync log")
      .addButton((button) => button.setButtonText("Open").onClick(async () => this.plugin.openLogView()));

    new Setting(containerEl)
      .setName("Open live monitor")
      .addButton((button) => button.setButtonText("Open").setCta().onClick(async () => this.plugin.openMonitorView()));
  }
}
