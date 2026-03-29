import { describe, expect, it } from "vitest";
import { isCompressibleTextPath, prepareCompressedPayload } from "../../../src/utils/compression";

describe("compression utils", () => {
  it("recognizes compressible text files", () => {
    expect(isCompressibleTextPath("Notes/a.md")).toBe(true);
    expect(isCompressibleTextPath("Attachments/image.png")).toBe(false);
  });

  it("keeps identity when compression is disabled", async () => {
    const result = await prepareCompressedPayload("Notes/a.md", new TextEncoder().encode("hello world"), false, 10);
    expect(result.encoding).toBe("identity");
  });

  it("keeps identity for non-text files", async () => {
    const result = await prepareCompressedPayload("Attachments/a.png", new Uint8Array(2048), true, 10);
    expect(result.encoding).toBe("identity");
  });
});
