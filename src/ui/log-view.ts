import { ButtonComponent, ItemView, WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "../types/settings";

export const LOG_VIEW_TYPE = "s3-sync-log-view";

export class SyncLogView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly clearLogs: () => void,
    private readonly actions: {
      push: () => Promise<void>;
      pull: () => Promise<void>;
      sync: () => Promise<void>;
    },
  ) {
    super(leaf);
  }

  getViewType(): string {
    return LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "S3 Sync Log";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "S3 Sync Log" });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(actions).setButtonText("Push").onClick(async () => this.actions.push());
    new ButtonComponent(actions).setButtonText("Fetch").onClick(async () => this.actions.pull());
    new ButtonComponent(actions).setButtonText("Sync").setCta().onClick(async () => this.actions.sync());
    new ButtonComponent(actions).setButtonText("Clear log").onClick(() => {
      this.clearLogs();
      this.render();
    });

    const table = contentEl.createEl("table", { cls: "s3-sync-table" });
    const head = table.createTHead().insertRow();
    head.insertCell().outerHTML = "<th>Time</th>";
    head.insertCell().outerHTML = "<th>Level</th>";
    head.insertCell().outerHTML = "<th>Operation</th>";
    head.insertCell().outerHTML = "<th>Path</th>";
    head.insertCell().outerHTML = "<th>Message</th>";

    const body = table.createTBody();
    for (const entry of this.getSettings().logs) {
      const row = body.insertRow();
      row.insertCell().setText(new Date(entry.timestamp).toLocaleString());
      row.insertCell().setText(entry.level);
      row.insertCell().setText(entry.operation);
      row.insertCell().setText(entry.path ?? "-");
      row.insertCell().setText(entry.message);
      row.addClass(`s3-sync-log-level-${entry.level}`);
    }
  }
}
