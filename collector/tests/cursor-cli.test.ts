import { describe, expect, it } from 'vitest';
import { parseCliStatus } from '../src/providers/cursor/cli';

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
