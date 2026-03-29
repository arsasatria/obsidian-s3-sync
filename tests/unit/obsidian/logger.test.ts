import { describe, expect, it, vi } from "vitest";
import { SettingsLogger } from "../../../src/obsidian/logger";
import { DEFAULT_SETTINGS, type PluginSettings, type SyncLogEntry } from "../../../src/types/settings";

describe("SettingsLogger", () => {
  it("suppresses noisy scan and queue entries when debug logging is off", () => {
    const persist = vi.fn();
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      debugLogging: false,
    };
    const logger = new SettingsLogger(() => settings, persist);

    logger.log({
      level: "info",
      operation: "scan-local",
      message: "Scanning local vault state",
    });
    logger.log({
      level: "info",
      operation: "queue",
      message: "Queued path for incremental sync",
    });

    expect(persist).not.toHaveBeenCalled();
  });

  it("persists noisy entries when debug logging is on", () => {
    const persisted: SyncLogEntry[][] = [];
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      debugLogging: true,
    };
    const logger = new SettingsLogger(() => settings, (logs) => persisted.push(logs));

    logger.log({
      level: "info",
      operation: "scan-local",
      message: "Scanning local vault state",
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.[0]?.operation).toBe("scan-local");
  });
});
