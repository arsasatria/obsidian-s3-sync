import { describe, expect, it, beforeEach, vi } from "vitest";
import { HttpRequest } from "@smithy/protocol-http";
import { requestUrl } from "obsidian";
import { ObsidianRequestHandler } from "../../../src/s3/obsidian-request-handler";

describe("ObsidianRequestHandler", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("serializes the request for Obsidian and returns a Blob-backed response", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce({
      arrayBuffer: new TextEncoder().encode("{\"ok\":true}").buffer,
      headers: { etag: "\"abc\"" },
      json: { ok: true },
      status: 200,
      text: "{\"ok\":true}",
    });

    const handler = new ObsidianRequestHandler();
    const result = await handler.handle(
      new HttpRequest({
        body: new Uint8Array([1, 2, 3]),
        headers: {
          "content-type": "application/octet-stream",
          "x-test": "1",
        },
        hostname: "s3.example.com",
        method: "PUT",
        path: "/bucket/object.txt",
        protocol: "https:",
        query: {
          partNumber: "1",
          uploads: null,
        },
      }),
    );

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        contentType: "application/octet-stream",
        headers: expect.objectContaining({
          "content-type": "application/octet-stream",
          "x-test": "1",
        }),
        method: "PUT",
        throw: false,
        url: "https://s3.example.com/bucket/object.txt?partNumber=1&uploads",
      }),
    );

    expect(result.response.statusCode).toBe(200);
    expect(result.response.body).toBeInstanceOf(Blob);
  });

  it("retries requests with minimal headers when the native request layer throws UnknownError", async () => {
    vi.mocked(requestUrl)
      .mockRejectedValueOnce(new Error("UnknownError"))
      .mockResolvedValueOnce({
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
        json: {},
        status: 200,
        text: "",
      });

    const handler = new ObsidianRequestHandler();
    await handler.handle(
      new HttpRequest({
        body: new Uint8Array([1]),
        headers: {
          accept: "application/xml",
          authorization: "AWS4-HMAC-SHA256 SignedHeaders=amz-sdk-request;host;x-amz-date, Signature=abc",
          "amz-sdk-request": "attempt=1; max=3",
          "content-length": "1",
          host: "s3.example.com",
          "x-amz-date": "20260328T102400Z",
          "x-test": "drop-me",
        },
        hostname: "s3.example.com",
        method: "GET",
        path: "/bucket/tes.md",
        protocol: "https:",
        query: {},
      }),
    );

    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestUrl).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "amz-sdk-request": "attempt=1; max=3",
        }),
      }),
    );
    expect(vi.mocked(requestUrl).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          accept: "application/xml",
          "content-length": "1",
        }),
      }),
    );
    expect(vi.mocked(requestUrl).mock.calls[1][0]).toEqual(
      expect.objectContaining({
        headers: {
          "amz-sdk-request": "attempt=1; max=3",
          authorization: "AWS4-HMAC-SHA256 SignedHeaders=amz-sdk-request;host;x-amz-date, Signature=abc",
          host: "s3.example.com",
          "x-amz-date": "20260328T102400Z",
        },
      }),
    );
  });
});
