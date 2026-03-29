import { normalizePath, TFile, Vault } from "obsidian";
import type { VaultPort, VaultFileRecord } from "../core/interfaces";

export class ObsidianVaultPort implements VaultPort {
  constructor(private readonly vault: Vault) {}

  async listFiles(): Promise<VaultFileRecord[]> {
    return this.vault.getFiles().map((file) => ({
      mtime: file.stat.mtime,
      path: file.path,
      size: file.stat.size,
    }));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return this.vault.adapter.readBinary(path);
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    await this.vault.adapter.writeBinary(path, content);
  }

  async delete(path: string): Promise<void> {
    const abstractFile = this.vault.getAbstractFileByPath(path);
    if (abstractFile instanceof TFile) {
      await this.vault.delete(abstractFile, true);
    }
  }

  async exists(path: string): Promise<boolean> {
    return Boolean(await this.vault.adapter.exists(path));
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized || normalized === ".") {
      return;
    }
    const exists = await this.vault.adapter.exists(normalized);
    if (!exists) {
      await this.vault.createFolder(normalized);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const abstractFile = this.vault.getAbstractFileByPath(oldPath);
    if (abstractFile instanceof TFile) {
      await this.vault.rename(abstractFile, newPath);
    }
  }

  getVaultName(): string {
    return this.vault.getName();
  }
}
