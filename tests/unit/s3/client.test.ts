import { Platform } from "obsidian";
import { describe, expect, it } from "vitest";
import { createS3Client } from "../../../src/s3/client";
import { DEFAULT_SETTINGS } from "../../../src/types/settings";

describe("createS3Client", () => {
  it("builds an S3 client with plugin settings", () => {
    Platform.isMobileApp = false;
    const client = createS3Client({
      ...DEFAULT_SETTINGS,
      accessKeyId: "key",
      bucketName: "bucket",
      endpoint: "https://s3.example.com",
      region: "auto",
      secretAccessKey: "secret",
      sessionToken: "token",
    });

    const config = client.config;
    expect(config.endpoint).toBeDefined();
    expect(config.region).toBeDefined();
    expect(config.forcePathStyle).toBe(true);
    expect(config.maxAttempts).toBeDefined();
    expect(config.requestChecksumCalculation).toBeDefined();
    expect(config.responseChecksumValidation).toBeDefined();
    expect(config.requestHandler).toBeDefined();
  });

  it("uses the custom Obsidian request handler only on mobile safe mode", () => {
    Platform.isMobileApp = true;
    const client = createS3Client({
      ...DEFAULT_SETTINGS,
      accessKeyId: "key",
      bucketName: "bucket",
      endpoint: "https://s3.example.com",
      mobileSafeMode: true,
      secretAccessKey: "secret",
    });

    expect(client.config.requestHandler).toBeDefined();
  });
});
