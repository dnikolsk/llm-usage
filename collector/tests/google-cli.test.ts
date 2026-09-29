import { describe, expect, it } from 'vitest';
import { collect, parseQuotaSummary, parseQuotaText } from '../src/providers/google/quota';

const accountId = 'google-ai-pro-personal';
const observedAt = '2026-09-29T12:00:00.000Z';

const geminiSummary = {
  groups: [
    {
      displayName: 'Gemini Models',
      description: 'Models within this group: Gemini Flash, Gemini Pro',
      buckets: [
        { bucketId: 'gemini-weekly', displayName: 'Weekly Limit', window: '1w', remainingFraction: 0.95, resetTime: '2026-10-05T21:46:37Z' },
        { bucketId: 'gemini-5h', displayName: 'Five Hour Limit', window: '5h', remainingFraction: 0.625, resetTime: '2026-09-29T16:07:00Z' }
      ]
    },
    {
      displayName: 'Claude and GPT Models',
      buckets: [
        { displayName: 'Weekly Limit', window: '1w', remainingFraction: 0.1, resetTime: '2026-10-05T21:46:37Z' }
      ]
    }
  ]
};

const agyFixture = {
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.99, reset_time: '2026-10-06T11:28:42Z' },
            { id: 'gemini-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.98, reset_time: '2026-09-29T16:28:42Z' }
          ]
        },
        {
          name: 'Claude and GPT models',
          buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 1 }]
        }
      ]
    }
  }
};

describe('Google AI Pro quota', () => {
  it('maps Gemini Apps five-hour and weekly remaining fractions and ignores other model groups', () => {
    const snapshot = parseQuotaSummary(geminiSummary, accountId, observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.provider).toBe('google');
    expect(snapshot.limits.map(limit => [limit.id, limit.kind, limit.scope, limit.remaining_fraction, limit.reset_at])).toEqual([
      ['session-gemini-apps', 'session', 'gemini_apps', 0.625, '2026-09-29T16:07:00.000Z'],
      ['weekly-gemini-apps', 'weekly', 'gemini_apps', 0.95, '2026-10-05T21:46:37.000Z']
    ]);
    expect(snapshot.limits[0]?.window_seconds).toBe(18_000);
    expect(snapshot.limits[1]?.window_seconds).toBe(604_800);
  });

  it('never treats Gemini API billing fields as Google AI Pro capacity', () => {
    const snapshot = parseQuotaSummary({ totalBillableTokens: 12_000, sku: 'generateContent' }, accountId, observedAt);
    expect(snapshot).toMatchObject({ status: 'error', limits: [], metadata: { diagnostic_code: 'gemini_api_billing_ignored' } });
  });

  it('leaves missing Gemini meters unknown and rejects duplicate windows', () => {
    const partial = parseQuotaSummary({ groups: [{ displayName: 'Gemini Models', buckets: [
      { displayName: 'Weekly Limit', window: '1w', remainingFraction: 0.4 }
    ] }] }, accountId, observedAt);
    expect(partial.status).toBe('partial');
    expect(partial.limits).toHaveLength(1);
    const duplicate = parseQuotaSummary({ groups: [{ displayName: 'Gemini Models', buckets: [
      { displayName: 'Weekly Limit', window: '1w', remainingFraction: 0.4 },
      { displayName: 'Weekly Limit', window: '1w', remainingFraction: 0.5 }
    ] }] }, accountId, observedAt);
    expect(duplicate).toMatchObject({ status: 'error', limits: [] });
  });

  it('parses Antigravity-style remaining text without guessing reset prose', () => {
    const snapshot = parseQuotaText(`GEMINI MODELS
  Models within this group: Gemini Flash, Gemini Pro
  Weekly Limit    95.0% remaining  resets 6d19h
  Five Hour Limit 62.5% remaining  resets 7m`, accountId, observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(limit => limit.remaining_fraction)).toEqual([0.625, 0.95]);
    expect(snapshot.limits.every(limit => limit.reset_at === null)).toBe(true);
  });

  it('collects Gemini meters from agy /usage JSON and ignores Claude/GPT groups', async () => {
    const snapshot = await collect(accountId, {
      runner: async () => ({ stdout: JSON.stringify(agyFixture) })
    });
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(limit => [limit.id, limit.kind, limit.remaining_fraction, limit.reset_at])).toEqual([
      ['session-gemini-apps', 'session', 0.98, '2026-09-29T16:28:42.000Z'],
      ['weekly-gemini-apps', 'weekly', 0.99, '2026-10-06T11:28:42.000Z']
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('ya29.');
  });

  it('reports sign_in_required when agy indicates an auth failure', async () => {
    const snapshot = await collect(accountId, {
      runner: async () => { throw new Error('Not logged in — authentication required. Please sign in.'); }
    });
    expect(snapshot).toMatchObject({ status: 'error', limits: [], metadata: { diagnostic_code: 'sign_in_required' } });
    expect(JSON.stringify(snapshot)).not.toContain('ya29.');
  });

  it('reports usage_values_unavailable when agy returns no Gemini buckets', async () => {
    const snapshot = await collect(accountId, {
      runner: async () => ({
        stdout: JSON.stringify({
          command: {
            name: 'usage',
            data: {
              groups: [{
                name: 'Claude and GPT models',
                buckets: [{ id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 1 }]
              }]
            }
          }
        })
      })
    });
    expect(snapshot).toMatchObject({ status: 'error', limits: [], metadata: { diagnostic_code: 'usage_values_unavailable' } });
    expect(JSON.stringify(snapshot)).not.toContain('ya29.');
  });
});
