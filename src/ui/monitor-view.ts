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
    contentEl.addClass("s3-sync-panel");

    const hero = contentEl.createDiv({ cls: "s3-sync-panel-hero" });
    hero.createEl("h2", { text: "Live Sync Monitor" });
    hero.createEl("p", {
      text: "Check sync status, review recent activity, and run manual actions.",
    });

    const statGrid = contentEl.createDiv({ cls: "s3-sync-stat-grid" });
    this.createStatCard(
      statGrid,
      "Last successful sync",
      settings.lastSuccessfulSyncAt ? new Date(settings.lastSuccessfulSyncAt).toLocaleString() : "Never",
    );
    this.createStatCard(
      statGrid,
      "Background checks",
      settings.remotePollingEnabled ? `Every ${settings.remotePollingIntervalSec}s` : "Off",
    );
    this.createStatCard(
      statGrid,
      "Conflict handling",
      settings.defaultConflictRule,
    );
    this.createStatCard(
      statGrid,
      "Compression",
      settings.smartTextCompression ? "Smart gzip" : "Off",
    );

    const actions = contentEl.createDiv({ cls: "s3-sync-action-row" });
    new ButtonComponent(actions).setButtonText("Push").onClick(async () => this.plugin.runPush());
    new ButtonComponent(actions).setButtonText("Fetch").onClick(async () => this.plugin.runPull());
    new ButtonComponent(actions).setButtonText("Sync").setCta().onClick(async () => this.plugin.runSync());

    const tableCard = contentEl.createDiv({ cls: "s3-sync-table-card" });
    tableCard.createEl("h3", { text: "Recent Activity" });
    const tableWrap = tableCard.createDiv({ cls: "s3-sync-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "s3-sync-table" });
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

  private createStatCard(container: HTMLElement, label: string, value: string): void {
    const card = container.createDiv({ cls: "s3-sync-stat-card" });
    card.createEl("div", { cls: "s3-sync-stat-label", text: label });
    card.createEl("div", { cls: "s3-sync-stat-value", text: value });
  }
}
