import { normalizePathSlashes } from "../../../src/utils/path";
import type { VaultPort, VaultFileRecord } from "../../../src/core/interfaces";

interface MockFile {
  body: Uint8Array;
  mtime: number;
}

export class MockVault implements VaultPort {
  private readonly files = new Map<string, MockFile>();
  private readonly folders = new Set<string>();

  addFile(path: string, content: string | Uint8Array, mtime = Date.now()): void {
    const normalized = normalizePathSlashes(path);
    const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(normalized, { body, mtime });
  }

  hasFile(path: string): boolean {
    return this.files.has(normalizePathSlashes(path));
  }

  listPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  async listFiles(): Promise<VaultFileRecord[]> {
    return [...this.files.entries()].map(([path, file]) => ({
      mtime: file.mtime,
      path,
      size: file.body.byteLength,
    }));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(normalizePathSlashes(path));
    if (!file) {
      throw new Error(`Missing file: ${path}`);
    }
    return file.body.buffer.slice(file.body.byteOffset, file.body.byteOffset + file.body.byteLength) as ArrayBuffer;
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.files.set(normalizePathSlashes(path), {
      body: new Uint8Array(content),
      mtime: Date.now(),
    });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normalizePathSlashes(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizePathSlashes(path)) || this.folders.has(normalizePathSlashes(path));
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.add(normalizePathSlashes(path));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = normalizePathSlashes(oldPath);
    const file = this.files.get(oldKey);
    if (!file) {
      return;
    }
    this.files.delete(oldKey);
    this.files.set(normalizePathSlashes(newPath), file);
  }

  getVaultName(): string {
    return "MockVault";
  }
}
