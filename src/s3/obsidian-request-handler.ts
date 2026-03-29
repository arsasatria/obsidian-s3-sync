import { requestUrl } from "obsidian";
import { HttpResponse, type HttpHandler, type HttpRequest } from "@smithy/protocol-http";
import type { HttpHandlerOptions } from "@smithy/types";

const UNSAFE_TRANSPORT_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "x-amzn-trace-id",
  "x-amz-user-agent",
  "amz-sdk-invocation-id",
  "amz-sdk-request",
]);

function parseSignedHeaders(headers: HttpRequest["headers"]): Set<string> {
  const authorization = headers.authorization ?? headers.Authorization;
  if (!authorization) {
    return new Set();
  }
  const match = authorization.match(/SignedHeaders=([^,]+)/i);
  if (!match) {
    return new Set();
  }
  return new Set(
    match[1]
      .split(";")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function serializeQueryValue(value: string | null): string {
  return value === null ? "" : `=${encodeURIComponent(value)}`;
}

function serializeQuery(query: HttpRequest["query"]): string {
  const parts: string[] = [];
  for (const [key, rawValue] of Object.entries(query)) {
    const encodedKey = encodeURIComponent(key);
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        parts.push(`${encodedKey}=${encodeURIComponent(value)}`);
      }
      continue;
    }
    parts.push(`${encodedKey}${serializeQueryValue(rawValue)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function buildUrl(request: HttpRequest): string {
  const port = request.port ? `:${request.port}` : "";
  const query = serializeQuery(request.query);
  const fragment = request.fragment ? `#${request.fragment}` : "";
  return `${request.protocol}//${request.hostname}${port}${request.path}${query}${fragment}`;
}

function normalizeHeaders(headers: HttpRequest["headers"]): Record<string, string> {
  const signedHeaders = parseSignedHeaders(headers);
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = key.toLowerCase();
    if (UNSAFE_TRANSPORT_HEADERS.has(lower) && !signedHeaders.has(lower)) {
      continue;
    }
    normalized[key] = String(value);
  }
  return normalized;
}

function essentialHeaders(headers: Record<string, string>): Record<string, string> {
  const signedHeaders = parseSignedHeaders(headers);
  const essential: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "content-type" ||
      lower === "range" ||
      lower === "if-match" ||
      lower === "if-none-match" ||
      signedHeaders.has(lower) ||
      lower.startsWith("x-amz-")
    ) {
      essential[key] = value;
    }
  }
  return essential;
}

function toRequestBody(body: unknown): string | ArrayBuffer | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  throw new Error(`Unsupported request body type: ${typeof body}`);
}

export class ObsidianRequestHandler implements HttpHandler {
  async handle(request: HttpRequest, _options?: HttpHandlerOptions): Promise<{ response: HttpResponse }> {
    const headers = normalizeHeaders(request.headers);
    const url = buildUrl(request);
    const body = toRequestBody(request.body);
    let response;

    try {
      response = await requestUrl({
        body,
        contentType: headers["content-type"] || headers["Content-Type"],
        headers,
        method: request.method,
        throw: false,
        url,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canRetryWithMinimalHeaders = /unknownerror|failed to fetch/i.test(message);
      if (!canRetryWithMinimalHeaders) {
        throw new Error(
          `Obsidian request failed [${request.method} ${url}] headers=[${Object.keys(headers).sort().join(",")}]: ${message}`,
        );
      }

      const retryHeaders = essentialHeaders(headers);
      response = await requestUrl({
        body,
        contentType: retryHeaders["content-type"] || retryHeaders["Content-Type"],
        headers: retryHeaders,
        method: request.method,
        throw: false,
        url,
      }).catch((retryError: unknown) => {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(
          `Obsidian request failed [${request.method} ${url}] headers=[${Object.keys(headers).sort().join(",")}]; retry headers=[${Object.keys(retryHeaders).sort().join(",")}]: ${message}; retry with minimal headers failed: ${retryMessage}`,
        );
      });
    }

    return {
      response: new HttpResponse({
        body: new Blob([response.arrayBuffer]),
        headers: response.headers,
        statusCode: response.status,
      }),
    };
  }

  updateHttpClientConfig(): void {}

  httpHandlerConfigs(): Record<string, never> {
    return {};
  }
}
