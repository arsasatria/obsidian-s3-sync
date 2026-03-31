import { PluginSettingTab, Setting } from "obsidian";
import type ObsidianS3SyncPlugin from "../main";
import type { ConflictRule, ScheduleInterval } from "../types/settings";

type SyncPreset = "safe" | "balanced" | "aggressive";

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
      text: "Connect your storage, choose how sync should behave, and run manual actions from one place.",
    });
    hero.createEl("div", {
      cls: "s3-sync-settings-preset-badge",
      text: `Current profile: ${this.detectPreset(settings)}`,
    });

    const quickSection = this.createSection(containerEl, "Quick Actions", "Use these buttons for everyday sync tasks.");
    new Setting(quickSection)
      .setName("Sync now")
      .setDesc("Run a one-time push, fetch, or full sync.")
      .addButton((button) => button.setButtonText("Push").onClick(async () => this.plugin.runPush()))
      .addButton((button) => button.setButtonText("Fetch").onClick(async () => this.plugin.runPull()))
      .addButton((button) => button.setButtonText("Sync").setCta().onClick(async () => this.plugin.runSync()));

    new Setting(quickSection)
      .setName("Open tools")
      .setDesc("Open the monitor, open the log, or verify the connection.")
      .addButton((button) => button.setButtonText("Test connection").onClick(async () => this.plugin.testConnection()))
      .addButton((button) => button.setButtonText("Monitor").onClick(async () => this.plugin.openMonitorView()))
      .addButton((button) => button.setButtonText("Log").onClick(async () => this.plugin.openLogView()));

    const presetSection = this.createSection(containerEl, "Profiles", "Choose a ready-made profile, then fine-tune only if necessary.");
    const presetGrid = presetSection.createDiv({ cls: "s3-sync-preset-grid" });
    this.createPresetCard(
      presetGrid,
      "Safe",
      "Conservative settings that prioritize stability and avoid aggressive background activity.",
      this.detectPreset(settings) === "safe",
      async () => {
        await this.applyPreset("safe");
        this.display();
      },
    );
    this.createPresetCard(
      presetGrid,
      "Balanced",
      "Recommended defaults for most users. Good reliability without excessive background churn.",
      this.detectPreset(settings) === "balanced",
      async () => {
        await this.applyPreset("balanced");
        this.display();
      },
    );
    this.createPresetCard(
      presetGrid,
      "Aggressive",
      "Faster remote awareness for users who prefer near-realtime behavior and accept more background activity.",
      this.detectPreset(settings) === "aggressive",
      async () => {
        await this.applyPreset("aggressive");
        this.display();
      },
    );

    const essentials = this.createSection(containerEl, "Connection", "Only the essentials are shown here.");
    new Setting(essentials).setName("Server URL").addText((text) =>
      text.setValue(settings.endpoint).onChange(async (value) => {
        settings.endpoint = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Bucket").addText((text) =>
      text.setValue(settings.bucketName).onChange(async (value) => {
        settings.bucketName = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Access key").addText((text) =>
      text.setValue(settings.accessKeyId).onChange(async (value) => {
        settings.accessKeyId = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("Secret key").addText((text) =>
      text.setPlaceholder("Hidden").setValue(settings.secretAccessKey).onChange(async (value) => {
        settings.secretAccessKey = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(essentials).setName("MinIO-style paths").setDesc("Turn this on for MinIO and many self-hosted S3 services.").addToggle((toggle) =>
      toggle.setValue(settings.forcePathStyle).onChange(async (value) => {
        settings.forcePathStyle = value;
        await this.plugin.saveSettings();
      }),
    );

    const behavior = this.createSection(containerEl, "Sync Behavior", "These are the settings most users will care about.");
    new Setting(behavior).setName("Sync after save").addToggle((toggle) =>
      toggle.setValue(settings.syncOnSave).onChange(async (value) => {
        settings.syncOnSave = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(behavior).setName("Sync when Obsidian starts").addToggle((toggle) =>
      toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
        settings.syncOnStartup = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(behavior).setName("Check for remote changes").setDesc("Keep checking S3 in the background for updates from other devices.").addToggle((toggle) =>
      toggle.setValue(settings.remotePollingEnabled).onChange(async (value) => {
        settings.remotePollingEnabled = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(behavior).setName("Background check interval").setDesc("Recommended range: 5 to 15 seconds.").addText((text) =>
      text.setValue(String(settings.remotePollingIntervalSec)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.remotePollingIntervalSec = Number.isFinite(nextValue) ? Math.max(3, nextValue) : 10;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(behavior).setName("When both sides changed").setDesc("Choose what happens when local and remote edits do not match.").addDropdown((dropdown) => {
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

    new Setting(advanced).setName("Region").setDesc("Optional. This can usually be left blank for S3-compatible providers.").addText((text) =>
      text.setPlaceholder("Optional, defaults to auto").setValue(settings.region).onChange(async (value) => {
        settings.region = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Session token").setDesc("Only needed for temporary credentials.").addText((text) =>
      text.setValue(settings.sessionToken).onChange(async (value) => {
        settings.sessionToken = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Bucket subfolder").setDesc("Optional prefix if you want this vault to sync into a subfolder inside the bucket.").addText((text) =>
      text.setValue(settings.prefix).onChange(async (value) => {
        settings.prefix = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Extra-safe mode for phones and tablets").setDesc("Uses more conservative behavior on Android, iPhone, and iPad to reduce runtime-specific failures.").addToggle((toggle) =>
      toggle.setValue(settings.mobileSafeMode).onChange(async (value) => {
        settings.mobileSafeMode = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(advanced).setName("Sync Obsidian settings too").setDesc("Include the `.obsidian` folder so app settings can travel between devices.").addToggle((toggle) =>
      toggle.setValue(settings.syncConfigFolder).onChange(async (value) => {
        settings.syncConfigFolder = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Scheduled sync").setDesc("Run a full sync automatically on a repeating schedule.").addDropdown((dropdown) => {
      const choices: ScheduleInterval[] = ["manual", "5m", "15m", "30m", "1h"];
      choices.forEach((choice) => dropdown.addOption(choice, choice));
      dropdown.setValue(settings.scheduledSyncInterval).onChange(async (value) => {
        settings.scheduledSyncInterval = value as ScheduleInterval;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      });
    });

    new Setting(advanced).setName("Check when returning to Obsidian").setDesc("Fetch remote changes when Obsidian becomes active again.").addToggle((toggle) =>
      toggle.setValue(settings.syncOnWindowFocus).onChange(async (value) => {
        settings.syncOnWindowFocus = value;
        await this.plugin.saveSettings();
        this.plugin.refreshSchedule();
      }),
    );

    new Setting(advanced).setName("Keep safety copies").setDesc("Create local backup copies before overwrite or delete actions.").addToggle((toggle) =>
      toggle.setValue(settings.createSafetySnapshots).onChange(async (value) => {
        settings.createSafetySnapshots = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Safety copies per file").setDesc("Older safety copies are cleaned up automatically.").addText((text) =>
      text.setValue(String(settings.maxSafetySnapshotsPerFile)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "3", 10);
        settings.maxSafetySnapshotsPerFile = Number.isFinite(nextValue) ? Math.max(1, nextValue) : 3;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Save space for text files").setDesc("Compress text files before upload when it meaningfully reduces storage usage.").addToggle((toggle) =>
      toggle.setValue(settings.smartTextCompression).onChange(async (value) => {
        settings.smartTextCompression = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Minimum space savings (%)").setDesc("Only compress when the storage savings are worthwhile.").addText((text) =>
      text.setValue(String(settings.compressionMinSavingsPercent)).onChange(async (value) => {
        const nextValue = Number.parseInt(value.trim() || "10", 10);
        settings.compressionMinSavingsPercent = Number.isFinite(nextValue) ? Math.max(0, Math.min(90, nextValue)) : 10;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Ignore these paths").setDesc("One glob pattern per line. Matching files will not be synced.").addTextArea((text) =>
      text.setValue(settings.excludePatterns.join("\n")).onChange(async (value) => {
        settings.excludePatterns = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Show notifications").setDesc("Display success and error messages as notices.").addToggle((toggle) =>
      toggle.setValue(settings.notifyOnSuccess || settings.notifyOnError).onChange(async (value) => {
        settings.notifyOnSuccess = value;
        settings.notifyOnError = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Verbose logging").setDesc("Store extra low-level scan, queue, and manifest activity in the sync log.").addToggle((toggle) =>
      toggle.setValue(settings.debugLogging).onChange(async (value) => {
        settings.debugLogging = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(advanced).setName("Automatic recovery mode").setDesc("If background sync fails repeatedly, temporarily pause automation so the app stays usable.").addToggle((toggle) =>
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
      .setName("Automatic recovery status")
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

  private createPresetCard(
    containerEl: HTMLElement,
    title: string,
    description: string,
    active: boolean,
    onApply: () => Promise<void>,
  ): void {
    const card = containerEl.createDiv({ cls: `s3-sync-preset-card${active ? " is-active" : ""}` });
    card.createEl("div", { cls: "s3-sync-preset-title", text: title });
    card.createEl("div", { cls: "s3-sync-preset-description", text: description });
    new Setting(card)
      .setName(active ? "Active profile" : "Apply profile")
      .setDesc(active ? "This profile currently matches your sync behavior." : "Replace the current sync behavior settings with this profile.")
      .addButton((button) =>
        button
          .setButtonText(active ? "Applied" : "Apply")
          .setDisabled(active)
          .onClick(async () => onApply()),
      );
  }

  private detectPreset(settings: ObsidianS3SyncPlugin["settings"]): SyncPreset | "custom" {
    if (
      !settings.syncOnStartup &&
      !settings.remotePollingEnabled &&
      !settings.syncOnWindowFocus &&
      settings.mobileSafeMode &&
      settings.createSafetySnapshots &&
      !settings.smartTextCompression &&
      settings.scheduledSyncInterval === "manual"
    ) {
      return "safe";
    }

    if (
      settings.syncOnSave &&
      settings.syncOnStartup &&
      settings.remotePollingEnabled &&
      settings.remotePollingIntervalSec === 10 &&
      settings.syncOnWindowFocus &&
      settings.mobileSafeMode &&
      settings.createSafetySnapshots &&
      settings.smartTextCompression &&
      settings.scheduledSyncInterval === "manual"
    ) {
      return "balanced";
    }

    if (
      settings.syncOnSave &&
      settings.syncOnStartup &&
      settings.remotePollingEnabled &&
      settings.remotePollingIntervalSec === 5 &&
      settings.syncOnWindowFocus &&
      settings.createSafetySnapshots &&
      settings.smartTextCompression &&
      settings.scheduledSyncInterval === "5m"
    ) {
      return "aggressive";
    }

    return "custom";
  }

  private async applyPreset(preset: SyncPreset): Promise<void> {
    const settings = this.plugin.settings;
    if (preset === "safe") {
      settings.syncOnSave = true;
      settings.syncOnStartup = false;
      settings.remotePollingEnabled = false;
      settings.remotePollingIntervalSec = 15;
      settings.syncOnWindowFocus = false;
      settings.mobileSafeMode = true;
      settings.createSafetySnapshots = true;
      settings.maxSafetySnapshotsPerFile = 3;
      settings.smartTextCompression = false;
      settings.scheduledSyncInterval = "manual";
      settings.defaultConflictRule = "keep-both";
      settings.safeBootEnabled = true;
      settings.debugLogging = false;
    } else if (preset === "balanced") {
      settings.syncOnSave = true;
      settings.syncOnStartup = true;
      settings.remotePollingEnabled = true;
      settings.remotePollingIntervalSec = 10;
      settings.syncOnWindowFocus = true;
      settings.mobileSafeMode = true;
      settings.createSafetySnapshots = true;
      settings.maxSafetySnapshotsPerFile = 3;
      settings.smartTextCompression = true;
      settings.scheduledSyncInterval = "manual";
      settings.defaultConflictRule = "keep-both";
      settings.safeBootEnabled = true;
      settings.debugLogging = false;
    } else {
      settings.syncOnSave = true;
      settings.syncOnStartup = true;
      settings.remotePollingEnabled = true;
      settings.remotePollingIntervalSec = 5;
      settings.syncOnWindowFocus = true;
      settings.mobileSafeMode = true;
      settings.createSafetySnapshots = true;
      settings.maxSafetySnapshotsPerFile = 2;
      settings.smartTextCompression = true;
      settings.scheduledSyncInterval = "5m";
      settings.defaultConflictRule = "keep-both";
      settings.safeBootEnabled = true;
      settings.debugLogging = false;
    }

    settings.safeBootUntil = null;
    settings.startupFailureCount = 0;
    settings.startupFailureWindowStartedAt = null;
    await this.plugin.saveSettings();
    this.plugin.refreshSchedule();
  }
}
