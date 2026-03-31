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
    containerEl.addClass("s3-sync-settings");

    const hero = containerEl.createDiv({ cls: "s3-sync-settings-hero" });
    hero.createEl("h2", { text: "S3 Sync" });
    hero.createEl("p", {
      text: "Configure connection, choose how synchronization behaves, and access manual actions from one place.",
    });

    const quickSection = this.createSection(containerEl, "Quick Actions", "Use these actions for day-to-day operation.");
    new Setting(quickSection)
      .setName("Manual actions")
      .setDesc("Run a one-off push, fetch, or full sync.")
      .addButton((button) => button.setButtonText("Push").onClick(async () => this.plugin.runPush()))
      .addButton((button) => button.setButtonText("Fetch").onClick(async () => this.plugin.runPull()))
      .addButton((button) => button.setButtonText("Sync").setCta().onClick(async () => this.plugin.runSync()));

    new Setting(quickSection)
      .setName("Utilities")
      .setDesc("Open the live monitor or sync log, or validate your connection.")
      .addButton((button) => button.setButtonText("Test connection").onClick(async () => this.plugin.testConnection()))
      .addButton((button) => button.setButtonText("Monitor").onClick(async () => this.plugin.openMonitorView()))
      .addButton((button) => button.setButtonText("Log").onClick(async () => this.plugin.openLogView()));

    const essentials = this.createSection(containerEl, "Connection", "Only the required connection details are shown here.");
    new Setting(essentials).setName("Endpoint URL").addText((text) =>
      text.setValue(settings.endpoint).onChange(async (value) => {
        settings.endpoint = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Bucket name").addText((text) =>
      text.setValue(settings.bucketName).onChange(async (value) => {
        settings.bucketName = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Access key ID").addText((text) =>
      text.setValue(settings.accessKeyId).onChange(async (value) => {
        settings.accessKeyId = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Secret access key").addText((text) =>
      text.setPlaceholder("Hidden").setValue(settings.secretAccessKey).onChange(async (value) => {
        settings.secretAccessKey = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Force path style").setDesc("Enable this for MinIO and many self-hosted S3 services.").addToggle((toggle) =>
      toggle.setValue(settings.forcePathStyle).onChange(async (value) => {
        settings.forcePathStyle = value;
        await this.plugin.saveSettings();
      }),
    );

    const behavior = this.createSection(containerEl, "Sync Behavior", "Recommended settings for normal use.");
    new Setting(behavior).setName("Sync on save").addToggle((toggle) =>
      toggle.setValue(settings.syncOnSave).onChange(async (value) => {
        settings.syncOnSave = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(behavior).setName("Sync on startup").addToggle((toggle) =>
      toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
        settings.syncOnStartup = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(behavior).setName("Realtime remote polling").setDesc("Continuously check S3 for remote changes.").addToggle((toggle) =>
      toggle.setValue(settings.remotePollingEnabled).onChange(async (value) => {
        settings.remotePollingEnabled = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(behavior).setName("Polling interval").setDesc("Recommended range: 5 to 15 seconds.").addText((text) =>
      text.setValue(String(settings.remotePollingIntervalSec)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.remotePollingIntervalSec = Number.isFinite(nextValue) ? Math.max(3, nextValue) : 10;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(behavior).setName("Conflict rule").setDesc("Choose how the plugin handles competing local and remote edits.").addDropdown((dropdown) => {
      const choices: ConflictRule[] = ["keep-local", "keep-remote", "keep-both", "ask-user"];
      choices.forEach((choice) => dropdown.addOption(choice, choice));
      dropdown.setValue(settings.defaultConflictRule).onChange(async (value) => {
        settings.defaultConflictRule = value as ConflictRule;
        await this.plugin.saveSettings();
      });
    });

    const advanced = containerEl.createEl("details", { cls: "s3-sync-settings-advanced" });
    if (settings.debugLogging || settings.safeBootUntil) {
      advanced.open = true;
    }
    advanced.createEl("summary", { text: "Advanced Options" });
    advanced.createEl("p", {
      cls: "s3-sync-settings-advanced-note",
      text: "Less frequently used options are grouped here to keep the main setup simple.",
    });

    new Setting(advanced).setName("Region").setDesc("Optional. Leave blank for many S3-compatible providers.").addText((text) =>
      text.setPlaceholder("Optional, defaults to auto").setValue(settings.region).onChange(async (value) => {
        settings.region = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Session token").addText((text) =>
      text.setValue(settings.sessionToken).onChange(async (value) => {
        settings.sessionToken = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Prefix").setDesc("Optional bucket prefix for multi-vault sync.").addText((text) =>
      text.setValue(settings.prefix).onChange(async (value) => {
        settings.prefix = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Mobile safe mode").setDesc("Use more conservative defaults on Android and iOS to reduce runtime-specific sync failures.").addToggle((toggle) =>
      toggle.setValue(settings.mobileSafeMode).onChange(async (value) => {
        settings.mobileSafeMode = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(advanced).setName("Sync .obsidian folder").addToggle((toggle) =>
      toggle.setValue(settings.syncConfigFolder).onChange(async (value) => {
        settings.syncConfigFolder = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Scheduled sync").addDropdown((dropdown) => {
      const choices: ScheduleInterval[] = ["manual", "5m", "15m", "30m", "1h"];
      choices.forEach((choice) => dropdown.addOption(choice, choice));
      dropdown.setValue(settings.scheduledSyncInterval).onChange(async (value) => {
        settings.scheduledSyncInterval = value as ScheduleInterval;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      });
    });

    new Setting(advanced).setName("Fetch on focus").setDesc("Pull remote changes whenever Obsidian regains focus.").addToggle((toggle) =>
      toggle.setValue(settings.syncOnWindowFocus).onChange(async (value) => {
        settings.syncOnWindowFocus = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(advanced).setName("Create safety snapshots").setDesc("Keep local safety copies before overwrite or delete.").addToggle((toggle) =>
      toggle.setValue(settings.createSafetySnapshots).onChange(async (value) => {
        settings.createSafetySnapshots = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Safety snapshots per file").setDesc("Older safety snapshots are pruned automatically.").addText((text) =>
      text.setValue(String(settings.maxSafetySnapshotsPerFile)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "3", 10);
        settings.maxSafetySnapshotsPerFile = Number.isFinite(nextValue) ? Math.max(1, nextValue) : 3;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Smart text compression").setDesc("Store compressible text files in S3 as gzip when it materially saves space.").addToggle((toggle) =>
      toggle.setValue(settings.smartTextCompression).onChange(async (value) => {
        settings.smartTextCompression = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Compression minimum savings (%)").setDesc("Only compress when the space savings are worthwhile.").addText((text) =>
      text.setValue(String(settings.compressionMinSavingsPercent)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.compressionMinSavingsPercent = Number.isFinite(nextValue) ? Math.max(0, Math.min(90, nextValue)) : 10;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Exclude patterns").setDesc("One glob pattern per line.").addTextArea((text) =>
      text.setValue(settings.excludePatterns.join("\n")).onChange(async (value) => {
        settings.excludePatterns = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Desktop notifications").addToggle((toggle) =>
      toggle.setValue(settings.notifyOnSuccess || settings.notifyOnError).onChange(async (value) => {
        settings.notifyOnSuccess = value;
        settings.notifyOnError = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Debug logging").setDesc("Store low-level scan, queue, and manifest activity in the sync log.").addToggle((toggle) =>
      toggle.setValue(settings.debugLogging).onChange(async (value) => {
        settings.debugLogging = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Safe boot mode").setDesc("If background sync fails repeatedly during startup, focus, or polling, pause automation temporarily so the UI remains usable.").addToggle((toggle) =>
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
    new Setting(advanced)
      .setName("Safe boot status")
      .setDesc(safeBootDesc)
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          await this.plugin.clearSafeBoot();
          this.display();
        }),
      );
  }

  private createSection(containerEl: HTMLElement, title: string, description: string): HTMLDivElement {
    const section = containerEl.createDiv({ cls: "s3-sync-settings-section" });
    section.createEl("h3", { text: title });
    section.createEl("p", {
      cls: "s3-sync-settings-section-note",
      text: description,
    });
    return section;
  }
}
