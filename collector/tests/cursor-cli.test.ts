import { describe, expect, it } from 'vitest';
import { parseCliStatus } from '../src/providers/cursor/cli';
import { parsePeriodUsage } from '../src/providers/cursor/local-usage';

const observedAt = '2026-09-25T12:00:00.000Z';

describe('Cursor CLI status', () => {
  it('records an authenticated personal account without inventing quota', () => {
    const snapshot = parseCliStatus({ status: 'authenticated', isAuthenticated: true,
      hasAccessToken: true, email: 'private@example.com' }, 'cursor-personal', observedAt);
    expect(snapshot.status).toBe('partial');
    expect(snapshot.limits).toEqual([]);
    expect(snapshot.metadata).toEqual({ diagnostic_code: 'personal_usage_unavailable' });
    expect(JSON.stringify(snapshot)).not.toContain('private@example.com');
  });

  it('reports signed-out and malformed status as errors', () => {
    for (const raw of [{ status: 'unauthenticated', isAuthenticated: false }, {}, null]) {
      const snapshot = parseCliStatus(raw, 'cursor-personal', observedAt);
      expect(snapshot.status).toBe('error');
      expect(snapshot.metadata.diagnostic_code).toBe('cli_not_authenticated');
    }
  });
});

describe('Cursor desktop usage', () => {
  it('maps both provider percentages and monthly reset without retaining credentials', () => {
    const snapshot = parsePeriodUsage({
      billingCycleStart: '1789757616000', billingCycleEnd: '1792349616000',
      planUsage: { autoPercentUsed: 0.07333333333333333, apiPercentUsed: 100,
        totalPercentUsed: 8.48, accessToken: 'private-token' }
    }, 'cursor-personal', observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(limit => [limit.scope, limit.used_fraction, limit.remaining_fraction])).toEqual([
      ['cursor_models', 0.0007333333333333333, 0.9992666666666666],
      ['other_models', 1, 0]
    ]);
    expect(snapshot.limits.map(limit => limit.reset_at)).toEqual([
      '2026-10-18T18:53:36.000Z', '2026-10-18T18:53:36.000Z'
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private-token');
  });

  it('keeps missing percentages unknown and ignores invalid cycle dates', () => {
    const partial = parsePeriodUsage({ billingCycleStart: 'bad', billingCycleEnd: '1792349616000',
      planUsage: { autoPercentUsed: 20 } }, 'cursor-personal', observedAt);
    expect(partial.status).toBe('partial');
    expect(partial.limits).toHaveLength(1);
    expect(partial.limits[0]?.reset_at).toBeNull();
    const missing = parsePeriodUsage({ planUsage: { autoPercentUsed: -1, apiPercentUsed: '100' } },
      'cursor-personal', observedAt);
    expect(missing.status).toBe('error');
    expect(missing.limits).toEqual([]);
  });
});
