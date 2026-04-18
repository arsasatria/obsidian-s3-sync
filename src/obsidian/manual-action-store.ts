import type { DataAdapter } from "obsidian";
import type { ActionStore } from "../core/interfaces";
import type { ManualActionRecord } from "../types/action";

export class ObsidianManualActionStore implements ActionStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly path: string,
  ) {}

  async load(): Promise<ManualActionRecord | null> {
    const exists = await this.adapter.exists(this.path);
    if (!exists) {
      return null;
    }
    return JSON.parse(await this.adapter.read(this.path)) as ManualActionRecord;
  }

  async save(record: ManualActionRecord): Promise<void> {
    await this.adapter.write(this.path, JSON.stringify(record, null, 2));
  }

  async clear(): Promise<void> {
    const exists = await this.adapter.exists(this.path);
    if (exists) {
      await this.adapter.remove(this.path);
    }
  }
}
