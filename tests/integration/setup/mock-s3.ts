import { sha256 } from "../../../src/utils/hash";
import { normalizePathSlashes } from "../../../src/utils/path";
import type { RemoteStore } from "../../../src/core/interfaces";
import type { FileEntry, RemoteManifest } from "../../../src/types/manifest";

export class MockS3 implements RemoteStore {
  private readonly objects = new Map<string, Uint8Array>();
  private manifest: RemoteManifest = {
    device_id: "",
    files: {},
    generated_at: new Date(0).toISOString(),
    vault_name: "MockVault",
    version: "1",
  };
  private manifestEtag = "";

  putObject(path: string, body: Uint8Array): void {
    this.objects.set(normalizePathSlashes(path), body);
  }

  seedManifest(files: Record<string, FileEntry>): void {
    this.manifest = {
      ...this.manifest,
      files,
      generated_at: new Date().toISOString(),
    };
  }

  hasObject(path: string): boolean {
    return this.objects.has(normalizePathSlashes(path));
  }

  async getManifest(): Promise<{ manifest: RemoteManifest; etag: string }> {
    return {
      etag: this.manifestEtag,
      manifest: structuredClone(this.manifest),
    };
  }

  async putManifest(manifest: RemoteManifest): Promise<string> {
    this.manifest = structuredClone(manifest);
    this.manifestEtag = `${Date.now()}`;
    return this.manifestEtag;
  }

  async uploadObject(path: string, body: ArrayBuffer): Promise<{ etag: string }> {
    const normalized = normalizePathSlashes(path);
    const bytes = new Uint8Array(body);
    this.objects.set(normalized, bytes);
    return { etag: await sha256(bytes) };
  }

  async downloadObject(path: string): Promise<{ body: ArrayBuffer; etag: string }> {
    const normalized = normalizePathSlashes(path);
    const body = this.objects.get(normalized);
    if (!body) {
      throw new Error(`Missing remote object: ${path}`);
    }
    return {
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      etag: await sha256(body),
    };
  }

  async deleteObject(path: string): Promise<void> {
    this.objects.delete(normalizePathSlashes(path));
  }

  async testConnection(): Promise<void> {
    return;
  }
}
