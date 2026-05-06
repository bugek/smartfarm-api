import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const HASH_PREFIX = "scrypt";

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;

  const [prefix, saltValue, digestValue] = storedHash.split("$");
  if (prefix !== HASH_PREFIX || !saltValue || !digestValue) {
    return false;
  }

  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(digestValue, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
