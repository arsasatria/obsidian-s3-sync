import type { LastSyncState } from "../types/manifest";
import type { LastSyncStore } from "./interfaces";

export class MemoryLastSyncStore implements LastSyncStore {
  private state: LastSyncState = {
    synced_at: "",
    remote_manifest_etag: "",
    files: {},
  };

  async load(): Promise<LastSyncState> {
    return structuredClone(this.state);
  }

  async save(state: LastSyncState): Promise<void> {
    this.state = structuredClone(state);
  }
}
