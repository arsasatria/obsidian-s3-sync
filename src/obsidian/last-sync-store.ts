import type { DataAdapter } from "obsidian";
import type { LastSyncState } from "../types/manifest";
import type { LastSyncStore } from "../core/interfaces";

const EMPTY_STATE: LastSyncState = {
  files: {},
  remote_manifest_etag: "",
  synced_at: "",
};

export class ObsidianLastSyncStore implements LastSyncStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly path: string,
  ) {}

  async load(): Promise<LastSyncState> {
    const exists = await this.adapter.exists(this.path);
    if (!exists) {
      return structuredClone(EMPTY_STATE);
    }
    const raw = await this.adapter.read(this.path);
    return {
      ...EMPTY_STATE,
      ...(JSON.parse(raw) as LastSyncState),
    };
  }

  async save(state: LastSyncState): Promise<void> {
    await this.adapter.write(this.path, JSON.stringify(state, null, 2));
  }
}
