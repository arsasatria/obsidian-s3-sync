import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../../src/utils/hash";

describe("sha256", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    vi.restoreAllMocks();
  });

  it("uses Web Crypto when available", async () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 255]).buffer),
        },
      },
    });

    await expect(sha256(new Uint8Array([1, 2, 3]))).resolves.toBe("0102ff");
  });
});
