import { ButtonComponent, ItemView, WorkspaceLeaf } from "obsidian";
import type ObsidianS3SyncPlugin from "../main";

export const MONITOR_VIEW_TYPE = "s3-sync-monitor-view";

export class SyncMonitorView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianS3SyncPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return MONITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "S3 Sync Monitor";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    const settings = this.plugin.settings;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Live Sync Monitor" });
    contentEl.createEl("p", {
      text: `Last successful sync: ${settings.lastSuccessfulSyncAt ? new Date(settings.lastSuccessfulSyncAt).toLocaleString() : "Never"}`,
    });
    contentEl.createEl("p", {
      text: `Realtime polling: ${settings.remotePollingEnabled ? `On every ${settings.remotePollingIntervalSec}s` : "Off"}`,
    });
    contentEl.createEl("p", {
      text: `Conflict rule: ${settings.defaultConflictRule} | Compression: ${settings.smartTextCompression ? "Smart gzip" : "Off"}`,
    });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(actions).setButtonText("Push").onClick(async () => this.plugin.runPush());
    new ButtonComponent(actions).setButtonText("Fetch").onClick(async () => this.plugin.runPull());
    new ButtonComponent(actions).setButtonText("Sync").setCta().onClick(async () => this.plugin.runSync());

    contentEl.createEl("h3", { text: "Recent Activity" });
    const table = contentEl.createEl("table", { cls: "s3-sync-table" });
    const head = table.createTHead().insertRow();
    head.insertCell().outerHTML = "<th>Time</th>";
    head.insertCell().outerHTML = "<th>Operation</th>";
    head.insertCell().outerHTML = "<th>Path</th>";
    head.insertCell().outerHTML = "<th>Message</th>";
    const body = table.createTBody();
    for (const entry of settings.logs.slice(0, 10)) {
      const row = body.insertRow();
      row.insertCell().setText(new Date(entry.timestamp).toLocaleTimeString());
      row.insertCell().setText(entry.operation);
      row.insertCell().setText(entry.path ?? "-");
      row.insertCell().setText(entry.message);
    }
  }
}
