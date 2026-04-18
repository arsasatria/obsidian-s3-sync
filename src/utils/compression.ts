const TEXT_EXTENSIONS = new Set([
  "canvas",
  "css",
  "html",
  "js",
  "json",
  "md",
  "mdx",
  "svg",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function extensionOf(path: string): string {
  const lastDot = path.lastIndexOf(".");
  return lastDot === -1 ? "" : path.slice(lastDot + 1).toLowerCase();
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function isCompressibleTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function isGzipData(data: Uint8Array): boolean {
  return data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    return data;
  }
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new CompressionStream("gzip"));
  return readStream(stream);
}

export async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    return data;
  }
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return readStream(stream);
}

export async function prepareCompressedPayload(
  path: string,
  data: Uint8Array,
  enabled: boolean,
  minSavingsPercent: number,
): Promise<{ body: Uint8Array; encoding: "identity" | "gzip" }> {
  if (!enabled || !isCompressibleTextPath(path) || data.byteLength < 1024) {
    return { body: data, encoding: "identity" };
  }
  const compressed = await gzipCompress(data);
  if (compressed.byteLength >= data.byteLength) {
    return { body: data, encoding: "identity" };
  }
  const savingsPercent = ((data.byteLength - compressed.byteLength) / data.byteLength) * 100;
  if (savingsPercent < minSavingsPercent) {
    return { body: data, encoding: "identity" };
  }
  return { body: compressed, encoding: "gzip" };
}
