import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { Sha256 } from "@aws-crypto/sha256-browser";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { HttpRequest as SmithyHttpRequest } from "@smithy/types";
import { Platform, requestUrl } from "obsidian";
import type { RemoteManifest } from "../types/manifest";
import type { FileEntry } from "../types/manifest";
import type { PluginSettings } from "../types/settings";
import type { RemoteStore, S3ObjectRecord } from "../core/interfaces";
import { manifestKey, joinRemoteKey, normalizePathSlashes, remoteKeyToPath } from "../utils/path";

function describeError(action: string, error: unknown, path?: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const suffix = path ? ` [path=${path}]` : "";
  const metadata = (error as {
    $metadata?: {
      httpStatusCode?: number;
      requestId?: string;
      extendedRequestId?: string;
    };
    $response?: {
      statusCode?: number;
      headers?: Record<string, string>;
    };
    name?: string;
  }) ?? { };
  const statusCode = metadata.$metadata?.httpStatusCode ?? metadata.$response?.statusCode;
  const requestId = metadata.$metadata?.requestId;
  const extendedRequestId = metadata.$metadata?.extendedRequestId;
  const name = metadata.name && metadata.name !== message ? ` name=${metadata.name}` : "";
  const status = statusCode ? ` status=${statusCode}` : "";
  const request = requestId ? ` requestId=${requestId}` : "";
  const extended = extendedRequestId ? ` extendedRequestId=${extendedRequestId}` : "";
  return new Error(`${action} failed${suffix}:${status}${request}${extended}${name} ${message}`.trim());
}

function emptyManifest(): { manifest: RemoteManifest; etag: string } {
  return {
    etag: "",
    manifest: {
      version: "1",
      generated_at: new Date(0).toISOString(),
      device_id: "",
      vault_name: "",
      files: {},
    },
  };
}

function buildPresignedObjectUrl(endpoint: string, bucketName: string, key: string, forcePathStyle: boolean): URL {
  const target = new URL(endpoint);
  const basePath = target.pathname.replace(/\/+$/, "");
  const normalizedKey = normalizePathSlashes(key);
  if (forcePathStyle) {
    target.pathname = `${basePath}/${encodeURIComponent(bucketName)}/${normalizedKey}`.replace(/\/{2,}/g, "/");
    return target;
  }
  target.hostname = `${bucketName}.${target.hostname}`;
  target.pathname = `${basePath}/${normalizedKey}`.replace(/\/{2,}/g, "/");
  return target;
}

function httpRequestToUrl(request: SmithyHttpRequest): string {
  const port = request.port ? `:${request.port}` : "";
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const encodedKey = encodeURIComponent(key);
    if (Array.isArray(value)) {
      for (const item of value) {
        pairs.push(`${encodedKey}=${encodeURIComponent(item)}`);
      }
      continue;
    }
    if (value === null) {
      pairs.push(encodedKey);
      continue;
    }
    pairs.push(`${encodedKey}=${encodeURIComponent(value)}`);
  }
  const query = pairs.length > 0 ? `?${pairs.join("&")}` : "";
  return `${request.protocol}//${request.hostname}${port}${request.path}${query}`;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const sought = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === sought) {
      return value;
    }
  }
  return undefined;
}

function normalizeSignedRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "accept" || lower === "accept-encoding") {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function streamToUint8Array(stream: unknown): Promise<Uint8Array> {
  if (stream instanceof Uint8Array) {
    return stream;
  }
  if (stream instanceof ArrayBuffer) {
    return new Uint8Array(stream);
  }
  if (typeof Blob !== "undefined" && stream instanceof Blob) {
    return new Uint8Array(await stream.arrayBuffer());
  }
  if (typeof ReadableStream !== "undefined" && stream instanceof ReadableStream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      chunks.push(chunk.value);
      total += chunk.value.byteLength;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
  if (stream && typeof (stream as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return (stream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  throw new Error("Unsupported S3 body type");
}

export class AwsRemoteStore implements RemoteStore {
  constructor(
    private readonly client: S3Client,
    private readonly settings: PluginSettings,
  ) {}

  private shouldUsePresignedMutations(): boolean {
    return Platform.isMobileApp && this.settings.mobileSafeMode;
  }

  private shouldUseBrowserPostUpload(key: string): boolean {
    return this.shouldUsePresignedMutations() || key.includes("%");
  }

  private async putObjectViaSignedRequest(
    key: string,
    body: ArrayBuffer,
    contentType?: string,
  ): Promise<{ etag: string }> {
    const objectUrl = buildPresignedObjectUrl(
      this.settings.endpoint.trim().replace(/\/+$/, ""),
      this.settings.bucketName,
      key,
      this.settings.forcePathStyle,
    );
    const signer = new SignatureV4({
      applyChecksum: false,
      credentials: {
        accessKeyId: this.settings.accessKeyId,
        secretAccessKey: this.settings.secretAccessKey,
        sessionToken: this.settings.sessionToken || undefined,
      },
      region: this.settings.region.trim() || "auto",
      service: "s3",
      sha256: Sha256,
      uriEscapePath: true,
    });
    const signedRequest = await signer.sign(
      new HttpRequest({
        headers: {
          ...(contentType ? { "content-type": contentType } : {}),
          host: objectUrl.host,
          "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
        },
        hostname: objectUrl.hostname,
        method: "PUT",
        path: objectUrl.pathname,
        port: objectUrl.port ? Number(objectUrl.port) : undefined,
        protocol: objectUrl.protocol,
        query: {},
      }),
    );

    const response = await requestUrl({
      body,
      contentType,
      headers: {
        ...normalizeSignedRequestHeaders(signedRequest.headers),
        "content-length": String(body.byteLength),
      },
      method: "PUT",
      throw: false,
      url: httpRequestToUrl(signedRequest),
    });
    if (response.status >= 400) {
      throw new Error(`status=${response.status} ${response.text || "UnknownError"}`.trim());
    }
    return { etag: readHeader(response.headers, "etag")?.replace(/"/g, "") ?? "" };
  }

  private async putObjectViaPresignedPost(key: string, body: ArrayBuffer, contentType?: string): Promise<{ etag: string }> {
    const post = await createPresignedPost(this.client, {
      Bucket: this.settings.bucketName,
      Expires: 900,
      Fields: contentType ? { "Content-Type": contentType } : undefined,
      Key: key,
    });
    const form = new FormData();
    for (const [field, value] of Object.entries(post.fields)) {
      form.append(field, value);
    }
    form.append("file", new Blob([body], contentType ? { type: contentType } : undefined));

    if (typeof fetch === "function") {
      const response = await fetch(post.url, {
        body: form,
        method: "POST",
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`status=${response.status} ${text || response.statusText || "UnknownError"}`.trim());
      }
      return { etag: response.headers.get("etag")?.replace(/"/g, "") ?? "" };
    }

    throw new Error("Presigned POST requires fetch support");
  }

  async getManifest(): Promise<{ manifest: RemoteManifest; etag: string }> {
    const key = manifestKey(this.settings.prefix);
    try {
      const listing = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.settings.bucketName,
          MaxKeys: 1,
          Prefix: key,
        }),
      );
      const found = listing.Contents?.some((entry) => entry.Key === key) ?? false;
      if (!found) {
        return emptyManifest();
      }

      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.settings.bucketName,
          Key: key,
        }),
      );
      const body = await streamToUint8Array(response.Body);
      return {
        etag: response.ETag?.replace(/"/g, "") ?? "",
        manifest: JSON.parse(new TextDecoder().decode(body)) as RemoteManifest,
      };
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === "NoSuchKey") {
        return emptyManifest();
      }
      throw describeError("Remote manifest fetch", error, key);
    }
  }

  async listFiles(): Promise<Record<string, FileEntry>> {
    const files: Record<string, FileEntry> = {};
    const prefix = this.settings.prefix ? `${joinRemoteKey(this.settings.prefix, "").replace(/\/+$/, "")}/` : "";
    const manifest = manifestKey(this.settings.prefix);
    let continuationToken: string | undefined;

    try {
      do {
        const response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.settings.bucketName,
            ContinuationToken: continuationToken,
            Prefix: prefix || undefined,
          }),
        );

        for (const entry of response.Contents ?? []) {
          const key = entry.Key;
          if (!key || key === manifest) {
            continue;
          }
          const path = remoteKeyToPath(this.settings.prefix, key);
          if (!path || path.startsWith(".s3sync/")) {
            continue;
          }
          files[path] = {
            deleted: false,
            etag: entry.ETag?.replace(/"/g, "") ?? "",
            mtime: entry.LastModified?.getTime() ?? 0,
            sha256: entry.ETag?.replace(/"/g, "") ?? "",
            size: entry.Size ?? 0,
          };
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      return files;
    } catch (error) {
      throw describeError("Remote list", error, prefix || this.settings.bucketName);
    }
  }

  async putManifest(manifest: RemoteManifest): Promise<string> {
    const key = manifestKey(this.settings.prefix);
    try {
      if (this.shouldUsePresignedMutations()) {
        const manifestBody = new TextEncoder().encode(JSON.stringify(manifest, null, 2)).buffer;
        const response = await this.putObjectViaPresignedPost(key, manifestBody, "application/json").catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/status=403.*accessdenied/i.test(message)) {
            throw error;
          }
          return this.putObjectViaSignedRequest(key, manifestBody, "application/json");
        });
        return response.etag;
      }
      const response = await this.client.send(
        new PutObjectCommand({
          Body: JSON.stringify(manifest, null, 2),
          Bucket: this.settings.bucketName,
          ContentType: "application/json",
          Key: key,
        }),
      );
      return response.ETag?.replace(/"/g, "") ?? "";
    } catch (error) {
      throw describeError("Remote manifest upload", error, key);
    }
  }

  async uploadObject(path: string, body: ArrayBuffer, mtime: number): Promise<{ etag: string }> {
    const key = joinRemoteKey(this.settings.prefix, path);
    const data = new Uint8Array(body);
    try {
      if (this.shouldUseBrowserPostUpload(key)) {
        return await this.putObjectViaPresignedPost(key, body).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/status=403.*accessdenied/i.test(message)) {
            throw error;
          }
          return this.putObjectViaSignedRequest(key, body);
        });
      }
      if (data.byteLength > this.settings.largeFileThresholdBytes) {
        const uploader = new Upload({
          client: this.client,
          params: {
            Body: data,
            Bucket: this.settings.bucketName,
            Key: key,
            Metadata: { mtime: String(mtime) },
          },
        });
        const response = await uploader.done();
        return { etag: response.ETag?.replace(/"/g, "") ?? "" };
      }

      const response = await this.client.send(
        new PutObjectCommand({
          Body: data,
          Bucket: this.settings.bucketName,
          Key: key,
          Metadata: { mtime: String(mtime) },
        }),
      );
      return { etag: response.ETag?.replace(/"/g, "") ?? "" };
    } catch (error) {
      throw describeError("Remote upload", error, key);
    }
  }

  async downloadObject(path: string): Promise<S3ObjectRecord> {
    const key = joinRemoteKey(this.settings.prefix, path);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.settings.bucketName,
          Key: key,
        }),
      );
      const body = await streamToUint8Array(response.Body);
      return {
        body: toArrayBuffer(body),
        etag: response.ETag?.replace(/"/g, "") ?? "",
      };
    } catch (error) {
      throw describeError("Remote download", error, key);
    }
  }

  async deleteObject(path: string): Promise<void> {
    const key = joinRemoteKey(this.settings.prefix, path);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.settings.bucketName,
          Key: key,
        }),
      );
    } catch (error) {
      throw describeError("Remote delete", error, key);
    }
  }

  async testConnection(): Promise<void> {
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.settings.bucketName,
          MaxKeys: 1,
          Prefix: this.settings.prefix || undefined,
        }),
      );
    } catch (error) {
      throw describeError("Remote connection test", error, this.settings.bucketName);
    }
  }
}
