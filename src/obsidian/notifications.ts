import { Notice } from "obsidian";
import type { NotificationPort } from "../core/interfaces";

export class ObsidianNotificationPort implements NotificationPort {
  private lastErrorAt = 0;
  private lastErrorMessage = "";

  notify(message: string): void {
    new Notice(message, 5000);
  }

  error(message: string): void {
    const now = Date.now();
    const isDuplicate = this.lastErrorMessage === message && now - this.lastErrorAt < 60000;
    if (isDuplicate) {
      return;
    }
    this.lastErrorAt = now;
    this.lastErrorMessage = message;
    new Notice(message, 8000);
  }
}
