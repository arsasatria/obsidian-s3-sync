import { S3Client } from "@aws-sdk/client-s3";
import { RequestChecksumCalculation, ResponseChecksumValidation } from "@aws-sdk/middleware-flexible-checksums";
import { Platform } from "obsidian";
import type { PluginSettings } from "../types/settings";
import { ObsidianRequestHandler } from "./obsidian-request-handler";

export function createS3Client(settings: PluginSettings): S3Client {
  const useObsidianRequestHandler = Platform.isMobileApp && settings.mobileSafeMode;

  return new S3Client({
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      sessionToken: settings.sessionToken || undefined,
    },
    endpoint: settings.endpoint.trim().replace(/\/+$/, ""),
    forcePathStyle: settings.forcePathStyle,
    maxAttempts: settings.maxRetries,
    ...(useObsidianRequestHandler ? { requestHandler: new ObsidianRequestHandler() } : {}),
    requestChecksumCalculation: RequestChecksumCalculation.WHEN_REQUIRED,
    responseChecksumValidation: ResponseChecksumValidation.WHEN_REQUIRED,
    region: settings.region.trim() || "auto",
  });
}
