import { describe, expect, it } from 'vitest';
import { parseCliUsage } from '../src/providers/anthropic/cli';

const accountId = 'claude-personal';
const observedAt = '2026-09-25T12:00:00.000Z';

describe('Claude CLI /usage', () => {
  it('reads the subscription meters without guessing local reset text', () => {
    const result = parseCliUsage('You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 1% used · resets Sep 25 at 4:20pm (America/New_York)\nCurrent week (all models): 0% used · resets Sep 27 at 1am (America/New_York)', accountId, observedAt);
    expect(result.status).toBe('ok');
    expect(result.limits.map(limit => limit.remaining_fraction)).toEqual([.99, 1]);
    expect(result.limits.every(limit => limit.reset_at === null)).toBe(true);
  });
  it('leaves missing or ambiguous meters unknown', () => {
    expect(parseCliUsage('Current session: 10% used', accountId, observedAt).limits.map(limit => limit.remaining_fraction)).toEqual([.9, null]);
    expect(parseCliUsage('Current session: 10% used\nCurrent session: 20% used', accountId, observedAt)).toMatchObject({ status: 'error', limits: [] });
    expect(parseCliUsage('Please sign in', accountId, observedAt)).toMatchObject({ status: 'error', limits: [] });
  });
});
