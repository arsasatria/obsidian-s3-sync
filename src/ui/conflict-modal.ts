import { ButtonComponent, Modal } from "obsidian";
import type { ConflictContext } from "../types/sync";
import type { ConflictRule } from "../types/settings";

export class ConflictModal extends Modal {
  private resolvePromise!: (value: ConflictRule) => void;

  constructor(
    app: Modal["app"],
    private readonly context: ConflictContext,
  ) {
    super(app);
  }

  openAndWait(): Promise<ConflictRule> {
    this.open();
    return new Promise<ConflictRule>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("s3-sync-conflict-modal");
    contentEl.createEl("h2", { text: "Resolve sync conflict" });
    contentEl.createEl("p", {
      text: `Path: ${this.context.path}`,
    });
    contentEl.createEl("p", {
      text: `Local mtime: ${this.context.local?.mtime ?? 0} | Remote mtime: ${this.context.remote?.mtime ?? 0}`,
    });
    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

    this.addChoice(buttonRow, "Keep Local", "keep-local");
    this.addChoice(buttonRow, "Keep Remote", "keep-remote");
    this.addChoice(buttonRow, "Keep Both", "keep-both");
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addChoice(container: HTMLElement, label: string, rule: ConflictRule): void {
    new ButtonComponent(container).setButtonText(label).setCta().onClick(() => {
      this.resolvePromise(rule);
      this.close();
    });
  }
}
