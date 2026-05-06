import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

export type StorageProviderName = "local_disk";

export type PresignedTarget = {
  url: string;
  method: "PUT" | "GET";
  headers: Record<string, string>;
  expiresAt: string;
};

export type StoredBlobStat = {
  size: number;
  sha256: string;
};

const DEFAULT_BASE_DIR = path.resolve(process.cwd(), "data", "storage");
const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes
const SIGNING_SECRET =
  process.env.DOCUMENT_SIGNING_SECRET ?? "smartfarm-dev-document-signing-secret";

export function buildStorageKey(organizationId: string, documentId: string): string {
  // Random suffix preserves immutability if the same documentId is ever reissued in tests.
  const suffix = randomUUID();
  return `org/${organizationId}/documents/${documentId}/${suffix}`;
}

function getBaseDir(): string {
  return process.env.DOCUMENT_STORAGE_DIR
    ? path.resolve(process.env.DOCUMENT_STORAGE_DIR)
    : DEFAULT_BASE_DIR;
}

function resolvePath(storageKey: string): string {
  const baseDir = getBaseDir();
  // Normalize and refuse traversal.
  const normalized = path.posix.normalize(storageKey).replace(/^([./\\])+/, "");
  if (normalized.includes("..")) {
    throw new Error("invalid_storage_key");
  }
  return path.join(baseDir, normalized);
}

export type SignedTokenPayload = {
  k: string; // storage key
  o: "put" | "get";
  d: string; // documentId
  e: number; // expiry epoch seconds
};

function signToken(payload: SignedTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): SignedTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("invalid_token");
  }
  const [body, sig] = parts;
  const expected = createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("invalid_token_signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedTokenPayload;
  if (typeof payload.e !== "number" || payload.e * 1000 < Date.now()) {
    throw new Error("token_expired");
  }
  return payload;
}

function buildPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? `http://localhost:${process.env.PORT ?? 3200}`;
}

export function presignUpload(
  storageKey: string,
  documentId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): PresignedTarget {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signToken({ k: storageKey, o: "put", d: documentId, e: expiresAt });
  return {
    url: `${buildPublicBaseUrl()}/api/v1/documents/_blob/${encodeURIComponent(token)}`,
    method: "PUT",
    headers: {},
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

export function presignDownload(
  storageKey: string,
  documentId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): PresignedTarget {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signToken({ k: storageKey, o: "get", d: documentId, e: expiresAt });
  return {
    url: `${buildPublicBaseUrl()}/api/v1/documents/_blob/${encodeURIComponent(token)}`,
    method: "GET",
    headers: {},
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

export async function writeBlob(storageKey: string, body: Buffer): Promise<StoredBlobStat> {
  const target = resolvePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  // Refuse overwrite to keep blob references immutable.
  try {
    await stat(target);
    throw new Error("blob_already_exists");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  await writeFile(target, body);
  return {
    size: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

export async function statBlob(storageKey: string): Promise<StoredBlobStat | null> {
  const target = resolvePath(storageKey);
  try {
    const s = await stat(target);
    // sha256 is computed lazily by validate job; here just return size with empty hash.
    return { size: s.size, sha256: "" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function hashBlob(storageKey: string): Promise<StoredBlobStat | null> {
  const target = resolvePath(storageKey);
  try {
    const s = await stat(target);
    return await new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream: Readable = createReadStream(target);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve({ size: s.size, sha256: hash.digest("hex") }));
      stream.on("error", reject);
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export function readBlobStream(storageKey: string) {
  return createReadStream(resolvePath(storageKey));
}

export async function deleteBlob(storageKey: string): Promise<void> {
  await rm(resolvePath(storageKey), { force: true });
}
