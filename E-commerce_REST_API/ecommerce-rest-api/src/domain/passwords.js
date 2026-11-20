import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const settings = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const keyLength = 64;

export const dummyPasswordHash = `${'0'.repeat(32)}:${'0'.repeat(keyLength * 2)}`;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, keyLength, settings);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [salt, expected] = storedHash.split(':').map(part => Buffer.from(part, 'hex'));
  const actual = await deriveKey(password, salt, keyLength, settings);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
