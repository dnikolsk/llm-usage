import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** SESSION_KEY: 64 hex characters (32 bytes). Only the web service holds it; sealed values are useless without it. */
function key(): Buffer {
  const value = process.env.SESSION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('session_key_required');
  return Buffer.from(value, 'hex');
}
export const sessionKeyConfigured = () => /^[0-9a-fA-F]{64}$/.test(process.env.SESSION_KEY ?? '');

export function seal(value: unknown, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function open<T = unknown>(sealed: string, purpose: string): T {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('sealed_value_invalid');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1]!, 'base64url'));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'));
  try {
    const text = Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString('utf8');
    return JSON.parse(text) as T;
  } catch { throw new Error('sealed_value_invalid'); }
}
