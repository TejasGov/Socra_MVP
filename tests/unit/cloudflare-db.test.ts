import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: undefined as object | undefined,
  adapter: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.context) throw new Error("No Cloudflare context");
    return { ctx: mocks.context };
  },
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(options: unknown) {
      mocks.adapter(options);
    }
  },
}));
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      mocks.client();
    }
    $disconnect = vi.fn();
  },
}));

import { disconnectPrisma, getPrisma } from "@/server/db";

describe("Cloudflare database request isolation", () => {
  afterEach(async () => {
    mocks.context = undefined;
    await disconnectPrisma();
    vi.clearAllMocks();
  });

  it("shares a client within a request but never across requests", () => {
    mocks.context = {};
    const first = getPrisma();
    expect(getPrisma()).toBe(first);
    mocks.context = {};
    expect(getPrisma()).not.toBe(first);
    expect(mocks.client).toHaveBeenCalledTimes(2);
    expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({ maxUses: 1 }));
  });

  it("keeps the process-wide pool for Node.js and the background worker", () => {
    const first = getPrisma();
    expect(getPrisma()).toBe(first);
    expect(mocks.client).toHaveBeenCalledTimes(1);
    expect(mocks.adapter.mock.calls[0]?.[0]).not.toHaveProperty("maxUses");
  });
});
