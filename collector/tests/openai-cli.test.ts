import { describe, expect, it } from 'vitest';
import { parseRateLimits } from '../src/providers/openai/app-server';

const observedAt = '2026-09-25T12:00:00.000Z';
const accountId = 'chatgpt-personal';

describe('Codex app-server rate limits', () => {
  it('uses window duration rather than primary/secondary position and preserves UTC resets', () => {
    const snapshot = parseRateLimits({ rateLimits: { limitId: 'codex',
      primary: { usedPercent: 72, windowDurationMins: 10_080, resetsAt: 1790427409 },
      secondary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1790352892 }
    } }, accountId, observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(limit => limit.kind)).toEqual(['session', 'weekly']);
    expect(snapshot.limits[0]?.remaining_fraction).toBeCloseTo(.72);
    expect(snapshot.limits[1]?.remaining_fraction).toBeCloseTo(.28);
    expect(snapshot.limits.every(limit => limit.reset_at?.endsWith('Z'))).toBe(true);
  });
  it('fails closed when a window or the Codex bucket is unavailable', () => {
    const partial = parseRateLimits({ rateLimits: { limitId: 'codex', primary: {
      usedPercent: 25, windowDurationMins: 300, resetsAt: null
    } } }, accountId, observedAt);
    expect(partial.status).toBe('partial');
    expect(partial.limits.map(limit => limit.remaining_fraction)).toEqual([.75, null]);
    expect(parseRateLimits({ rateLimits: { limitId: 'api', primary: {
      usedPercent: 25, windowDurationMins: 300
    } } }, accountId, observedAt)).toMatchObject({ status: 'error', limits: [] });
  });
});
