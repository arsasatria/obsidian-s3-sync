function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(input: ArrayBuffer | Uint8Array): Promise<string> {
  const data = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data.buffer);
    return toHex(digest);
  }
  try {
    const dynamicImport = Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;
    const nodeCrypto = (await dynamicImport("node:crypto")) as
      | { createHash: (algorithm: string) => { update: (value: Uint8Array) => { digest: (encoding: string) => string } } }
      | undefined;
    if (nodeCrypto?.createHash) {
      return nodeCrypto.createHash("sha256").update(data).digest("hex");
    }
  } catch {
    // Ignore and fall through to runtime error below.
  }
  const dynamicRequire = globalThis.eval?.("typeof require !== 'undefined' ? require : undefined") as
    | ((id: string) => { createHash: (algorithm: string) => { update: (value: Uint8Array) => { digest: (encoding: string) => string } } })
    | undefined;
  if (dynamicRequire) {
    const { createHash } = dynamicRequire("crypto");
    return createHash("sha256").update(data).digest("hex");
  }
  throw new Error("SHA-256 is unavailable in this runtime");
}
