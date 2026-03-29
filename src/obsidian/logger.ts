import type { LoggerPort } from "../core/interfaces";
import type { PluginSettings, SyncLogEntry } from "../types/settings";

export class SettingsLogger implements LoggerPort {
  constructor(
    private readonly getSettings: () => PluginSettings,
    private readonly persist: (logs: SyncLogEntry[]) => void,
  ) {}

  log(entry: Omit<SyncLogEntry, "id" | "timestamp">): void {
    const settings = this.getSettings();
    if (!this.shouldPersist(entry, settings)) {
      return;
    }
    const logs = [
      {
        ...entry,
        id: globalThis.crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      ...settings.logs,
    ].slice(0, settings.maxLogEntries);
    this.persist(logs);
  }

  private shouldPersist(entry: Omit<SyncLogEntry, "id" | "timestamp">, settings: PluginSettings): boolean {
    if (settings.debugLogging) {
      return true;
    }
    if (entry.level === "error" || entry.level === "warning") {
      return true;
    }
    if (entry.operation === "queue" || entry.operation === "scan-local") {
      return false;
    }
    if (entry.operation === "manifest") {
      return entry.message.startsWith("Remote manifest loaded") || entry.message.startsWith("Uploading updated remote manifest");
    }
    return true;
  }
}
