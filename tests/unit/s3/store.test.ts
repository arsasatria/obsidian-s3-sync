import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoSuchKey } from "@aws-sdk/client-s3";
import { Platform, requestUrl } from "obsidian";
import { AwsRemoteStore } from "../../../src/s3/store";
import { DEFAULT_SETTINGS } from "../../../src/types/settings";

const uploadDone = vi.fn();

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: vi.fn().mockImplementation(() => ({
    done: uploadDone,
  })),
}));

describe("AwsRemoteStore", () => {
  const send = vi.fn();
  const client = { send } as never;
  const settings = {
    ...DEFAULT_SETTINGS,
    bucketName: "bucket",
    endpoint: "https://s3.example.com",
    prefix: "vault-a",
  };
  let store: AwsRemoteStore;

  beforeEach(() => {
    send.mockReset();
    uploadDone.mockReset();
    Platform.isMobileApp = false;
    vi.mocked(requestUrl).mockReset();
    vi.mocked(requestUrl).mockResolvedValue({
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
      json: {},
      status: 200,
      text: "",
    });
    globalThis.fetch = vi.fn(async () =>
      ({
        headers: new Headers({ etag: '"etag-fetch"' }),
        ok: true,
        status: 200,
        text: async () => "",
      }) as Response,
    ) as typeof fetch;
    store = new AwsRemoteStore(client, settings);
  });

  it("returns an empty manifest when the manifest key does not exist", async () => {
    send.mockResolvedValueOnce({ Contents: [] });

    const result = await store.getManifest();

    expect(result.manifest.files).toEqual({});
    expect(result.etag).toBe("");
  });

  it("reads a remote manifest", async () => {
    send.mockResolvedValueOnce({
      Contents: [{ Key: "vault-a/.s3sync/manifest.json" }],
    });
    send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () =>
          new TextEncoder().encode(JSON.stringify({ version: "1", generated_at: "now", device_id: "d1", vault_name: "v", files: {} })),
      },
      ETag: '"etag-1"',
    });

    const result = await store.getManifest();
    expect(result.etag).toBe("etag-1");
    expect(result.manifest.vault_name).toBe("v");
  });

  it("lists remote files from object storage", async () => {
    send.mockResolvedValueOnce({
      Contents: [
        {
          ETag: '"etag-a"',
          Key: "vault-a/Notes/a.md",
          LastModified: new Date(1000),
          Size: 5,
        },
        {
          ETag: '"etag-manifest"',
          Key: "vault-a/.s3sync/manifest.json",
          LastModified: new Date(1000),
          Size: 10,
        },
      ],
      IsTruncated: false,
    });

    const result = await store.listFiles();

    expect(result).toEqual({
      "Notes/a.md": {
        deleted: false,
        etag: "etag-a",
        mtime: 1000,
        sha256: "etag-a",
        size: 5,
      },
    });
  });

  it("writes a manifest", async () => {
    send.mockResolvedValueOnce({ ETag: '"etag-2"' });
    const etag = await store.putManifest({
      device_id: "device-a",
      files: {},
      generated_at: new Date().toISOString(),
      vault_name: "vault",
      version: "1",
    });
    expect(etag).toBe("etag-2");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("uploads small files with PutObject", async () => {
    send.mockResolvedValueOnce({ ETag: '"etag-3"' });
    const result = await store.uploadObject("Notes/a.md", new TextEncoder().encode("hello").buffer, 1000);
    expect(result.etag).toBe("etag-3");
  });

  it("uses signed mobile upload on mobile safe mode", async () => {
    Platform.isMobileApp = true;
    store = new AwsRemoteStore(client, settings);

    const result = await store.uploadObject("Notes/mobile.md", new TextEncoder().encode("hello").buffer, 1000);

    expect(result.etag).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses browser post upload for encoded remote keys on desktop", async () => {
    store = new AwsRemoteStore(client, settings);

    const result = await store.uploadObject("02 📥 Notes/tes.md", new TextEncoder().encode("hello").buffer, 1000);

    expect(result.etag).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it("uploads large files with multipart upload", async () => {
    uploadDone.mockResolvedValueOnce({ ETag: '"etag-4"' });
    store = new AwsRemoteStore(client, { ...settings, largeFileThresholdBytes: 2 });
    const result = await store.uploadObject("big.bin", new Uint8Array([1, 2, 3]).buffer, 1000);
    expect(result.etag).toBe("etag-4");
  });

  it("downloads remote objects", async () => {
    send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3]),
      },
      ETag: '"etag-5"',
    });
    const result = await store.downloadObject("Notes/a.md");
    expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.etag).toBe("etag-5");
  });

  it("downloads Blob-backed remote objects", async () => {
    send.mockResolvedValueOnce({
      Body: new Blob([new Uint8Array([4, 5, 6])]),
      ETag: '"etag-blob"',
    });
    const result = await store.downloadObject("Notes/blob.md");
    expect(new Uint8Array(result.body)).toEqual(new Uint8Array([4, 5, 6]));
    expect(result.etag).toBe("etag-blob");
  });

  it("deletes remote objects and tests connectivity", async () => {
    send.mockResolvedValue({});
    await store.deleteObject("Notes/a.md");
    await store.testConnection();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("includes status metadata in wrapped errors", async () => {
    send.mockResolvedValueOnce({
      Contents: [{ Key: "vault-a/.s3sync/manifest.json" }],
    });
    send.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 403, requestId: "req-1" },
      message: "UnknownError",
      name: "UnknownError",
    });

    await expect(store.getManifest()).rejects.toThrow(/status=403.*requestId=req-1|requestId=req-1.*status=403/);
  });
});
