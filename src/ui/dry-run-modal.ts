import { ButtonComponent, Modal } from "obsidian";
import type { SyncOperation, SyncPlanSummary } from "../types/sync";

export class DryRunModal extends Modal {
  private resolvePromise!: (value: boolean) => void;

  constructor(
    app: Modal["app"],
    private readonly operations: SyncOperation[],
    private readonly summary: SyncPlanSummary,
  ) {
    super(app);
  }

  openAndWait(): Promise<boolean> {
    this.open();
    return new Promise<boolean>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("s3-sync-dry-run-modal");
    contentEl.createEl("h2", { text: "Dry run preview" });
    contentEl.createEl("p", {
      text: `${this.summary.upload} upload, ${this.summary.download} download, ${this.summary.deleteLocal} delete local, ${this.summary.deleteRemote} delete remote, ${this.summary.conflict} conflict`,
    });

    const table = contentEl.createEl("table", { cls: "s3-sync-table" });
    const header = table.createTHead().insertRow();
    header.insertCell().outerHTML = "<th>Operation</th>";
    header.insertCell().outerHTML = "<th>Path</th>";

    const body = table.createTBody();
    for (const operation of this.operations) {
      const row = body.insertRow();
      row.insertCell().setText(operation.type);
      row.insertCell().setText(operation.path);
    }

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => {
      this.resolvePromise(false);
      this.close();
    });
    new ButtonComponent(actions).setButtonText("Run Sync").setCta().onClick(() => {
      this.resolvePromise(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
