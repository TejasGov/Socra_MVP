import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Minimal storage abstraction for research export files. LocalStorage writes under LOCAL_STORAGE_DIR; S3Storage is a
 * stub (STORAGE_DRIVER=s3 is recognised but not implemented in V1 and fails loudly instead of silently writing locally).
 */

export interface StoredObject {
  key: string;
  bytes: number;
  sha256: string;
}

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer | string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(rootDir: string = env().LOCAL_STORAGE_DIR) {
    this.root = path.resolve(rootDir);
  }

  /** Resolve a key inside the root; rejects traversal. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return full;
  }

  async put(key: string, data: Buffer | string): Promise<StoredObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await writeFile(full, buf);
    return { key, bytes: buf.byteLength, sha256: sha256Hex(buf) };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  private fail(): never {
    throw new Error("S3 storage is not implemented in this build. Set STORAGE_DRIVER=local.");
  }
  async put(): Promise<StoredObject> {
    return this.fail();
  }
  async get(): Promise<Buffer> {
    return this.fail();
  }
  async exists(): Promise<boolean> {
    return this.fail();
  }
}

export function getStorage(): ObjectStorage {
  return env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage();
}
