import { TAbstractFile, TFile, Vault } from "obsidian";
import { debounce } from "../utils/debounce";
import { SyncOrchestrator } from "../sync/orchestrator";
import type { PluginSettings } from "../types/settings";
import type ObsidianS3SyncPlugin from "../main";

export class VaultWatcher {
  private readonly debouncedQueue: (path: string) => void;

  constructor(
    private readonly vault: Vault,
    private readonly orchestrator: SyncOrchestrator,
    private readonly settings: PluginSettings,
  ) {
    this.debouncedQueue = debounce((path: string) => this.orchestrator.queueFileSync(path), settings.debounceDelayMs);
  }

  register(plugin: ObsidianS3SyncPlugin): void {
    plugin.registerEvent(
      this.vault.on("create", (file: TAbstractFile) => {
        if (file instanceof TFile && this.settings.syncOnSave) {
          this.debouncedQueue(file.path);
        }
      }),
    );

    plugin.registerEvent(
      this.vault.on("modify", (file: TAbstractFile) => {
        if (file instanceof TFile && this.settings.syncOnSave) {
          this.debouncedQueue(file.path);
        }
      }),
    );

    plugin.registerEvent(
      this.vault.on("delete", (file: TAbstractFile) => {
        if (file instanceof TFile && this.settings.syncOnSave) {
          this.orchestrator.queueFileDelete(file.path);
        }
      }),
    );

    plugin.registerEvent(
      this.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile && this.settings.syncOnSave) {
          this.orchestrator.queueFileRename(oldPath, file.path);
        }
      }),
    );
  }
}
