import { describe, expect, it, vi } from 'vitest';
import { parseUsage } from '../src/providers/anthropic/parse';
import { publish } from '../src/publish';
import { loadWriteToken } from '../src/write-token';

const accountId = 'claude-personal';
const observedAt = '2026-09-24T10:00:00.000Z';
describe('Claude usage parsing', () => {
  it('uses displayed percentages without guessing reset times', () => {
    const result = parseUsage('Plan usage limits\nCurrent session\n32% used\nResets in 3 hours\nWeekly limits\nAll models\n61% used\nResets Monday', accountId, observedAt);
    expect(result.status).toBe('ok');
    expect(result.limits[0]?.remaining_fraction).toBeCloseTo(.68);
    expect(result.limits[1]?.remaining_fraction).toBeCloseTo(.39);
    expect(result.limits.every(b => b.reset_at === null)).toBe(true);
  });
  it('keeps an unknown bucket when one meter is missing, so routing cannot treat it as free', () => {
    const result = parseUsage('Current session\n15% used', accountId, observedAt);
    expect(result.status).toBe('partial');
    expect(result.limits.map(b => b.remaining_fraction)).toEqual([.85, null]);
    expect(parseUsage('Please log in', accountId, observedAt)).toMatchObject({ status: 'error', limits: [] });
    expect(parseUsage('Weekly limits\nAll models\n150% used', accountId, observedAt).status).toBe('error');
  });
  it('reads the current Claude page layout with a reset label before the weekly percentage', () => {
    const result = parseUsage('Your usage\nCurrent session\nStarts with your first message\n0% used\nThis week\nResets Sunday 1:00 AM\n0% used\nResets\nUsage credits', accountId, observedAt);
    expect(result.status).toBe('ok');
    expect(result.limits.map(b => b.remaining_fraction)).toEqual([1, 1]);
    expect(result.limits.every(b => b.reset_at === null)).toBe(true);
  });
});
describe('collector publishing', () => {
  it('uses a stable idempotency key and requires HTTPS away from localhost', async () => {
    const snapshot = parseUsage('Current session\n15% used', accountId, observedAt);
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
