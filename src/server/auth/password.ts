import "server-only";
import bcrypt from "bcryptjs";

/** bcrypt cost factor (pure-JS bcryptjs; no native build needed on Windows). */
export const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | undefined;

/** Spend comparable time when the account does not exist, to reduce user-enumeration timing signals. */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash("socra-timing-equalizer", BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash).catch(() => false);
}
