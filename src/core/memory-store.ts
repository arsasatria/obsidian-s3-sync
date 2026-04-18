import type { LastSyncState } from "../types/manifest";
import type { ManualActionRecord } from "../types/action";
import type { ActionStore, LastSyncStore } from "./interfaces";

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

export class MemoryActionStore implements ActionStore {
  private record: ManualActionRecord | null = null;

  async load(): Promise<ManualActionRecord | null> {
    return structuredClone(this.record);
  }

  async save(record: ManualActionRecord): Promise<void> {
    this.record = structuredClone(record);
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}
