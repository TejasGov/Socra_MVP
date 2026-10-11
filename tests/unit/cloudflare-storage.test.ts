import { beforeEach, describe, expect, it, vi } from "vitest";

const { bucket } = vi.hoisted(() => ({
  bucket: { put: vi.fn(), get: vi.fn(), head: vi.fn() },
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { RESEARCH_EXPORTS: bucket } }),
}));

import { R2Storage, sha256Hex } from "@/server/domain/research/storage";

describe("Cloudflare research export storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores UTF-8 bytes and returns the hash and byte count used by export manifests", async () => {
    const data = "participant,answer\np1,café\n";
    const result = await new R2Storage().put("exports/example.csv", data);
    expect(bucket.put).toHaveBeenCalledWith(
      "exports/example.csv",
      new Uint8Array(Buffer.from(data)),
    );
    expect(result).toEqual({
      key: "exports/example.csv",
      bytes: Buffer.byteLength(data),
      sha256: sha256Hex(data),
    });
  });

  it("downloads exactly the stored bytes", async () => {
    const data = new Uint8Array([0, 127, 255]);
    bucket.get.mockResolvedValue({ arrayBuffer: async () => data.buffer });
    expect(await new R2Storage().get("exports/example.zip")).toEqual(Buffer.from(data));
  });

  it("reports missing objects without returning an empty export", async () => {
    bucket.get.mockResolvedValue(null);
    bucket.head.mockResolvedValue(null);
    await expect(new R2Storage().get("missing")).rejects.toThrow("Export file not found");
    expect(await new R2Storage().exists("missing")).toBe(false);
  });

  it("propagates storage failures so failed exports cannot be marked complete", async () => {
    bucket.put.mockRejectedValue(new Error("R2 unavailable"));
    await expect(new R2Storage().put("export", "data")).rejects.toThrow("R2 unavailable");
  });
});
