import { describe, expect, it, vi } from 'vitest';
import { parseCliUsage } from '../src/providers/anthropic/cli';
import { publish } from '../src/publish';
import { loadWriteToken } from '../src/write-token';

const accountId = 'claude-personal';
const observedAt = '2026-09-24T10:00:00.000Z';

describe('collector publishing', () => {
  it('uses a stable idempotency key and requires HTTPS away from localhost', async () => {
    const snapshot = parseCliUsage('Current session: 15% used', accountId, observedAt);
    const keys: string[] = [];
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
      return new Response('{}', { status: 201 });
    });
    await publish(snapshot, 'https://example.com', 'x'.repeat(40), fetcher as typeof fetch);
    await publish(snapshot, 'https://example.com', 'x'.repeat(40), fetcher as typeof fetch);
    expect(keys[0]).toBe(keys[1]);
    await expect(publish(snapshot, 'http://example.com', 'x'.repeat(40), fetcher as typeof fetch)).rejects.toThrow('HTTPS');
  });
});

describe('collector token loading', () => {
  it('uses an environment override or the Mac Keychain without logging the secret', async () => {
    const keychain = vi.fn(async () => 'k'.repeat(40));
    expect(await loadWriteToken('e'.repeat(40), 'darwin', keychain)).toBe('e'.repeat(40));
    expect(keychain).not.toHaveBeenCalled();
    expect(await loadWriteToken(undefined, 'darwin', keychain)).toBe('k'.repeat(40));
    await expect(loadWriteToken(undefined, 'linux', keychain)).rejects.toThrow('LLM_USAGE_WRITE_TOKEN');
  });
});
