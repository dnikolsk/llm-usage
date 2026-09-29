import { describe, expect, it } from 'vitest';
import type { AccountState, UsageBucket } from '@llm-usage/core';
import { age, collectorSyncLabel, limitName, providerNames, statusLabel } from '../src/dashboard-display';

const now = new Date('2026-09-29T10:47:00.000Z');
const bucket = (scope: string, kind: string, seconds: number | null = null): UsageBucket => ({
  id: kind, account_id: 'x', kind, scope, unit: 'fraction', window_seconds: seconds, used: null, limit: null, remaining: null,
  used_fraction: 0.2, remaining_fraction: 0.8, window_started_at: null, reset_at: null,
  observed_at: now.toISOString(), source: 'local_collector', confidence: 'provider_reported', metadata: {}
});
const account = (freshness: AccountState['freshness']): AccountState => ({
  id: 'claude-personal', provider: 'anthropic', label: 'Claude Personal', plan: null, enabled: true,
  capabilities: ['coding'], model_classes: ['high_reasoning'], priority: 0, status: 'available', freshness,
  observed_at: '2026-09-28T21:46:35.844Z', latest_refresh_at: '2026-09-28T21:46:35.844Z', limits: []
});

describe('dashboard display', () => {
  it('shows days after a day of staleness instead of stacking hours', () => {
    expect(age('2026-09-29T10:46:00.000Z', now)).toBe('1 min ago');
    expect(age('2026-09-28T21:46:35.844Z', now)).toBe('13 hr ago');
    expect(age('2026-09-28T10:47:00.000Z', now)).toBe('1 day ago');
    expect(age('2026-09-27T10:47:00.000Z', now)).toBe('2 days ago');
  });

  it('does not claim the collector is syncing when every account is seriously stale', () => {
    expect(collectorSyncLabel([account('seriously_stale'), account('seriously_stale')])).toEqual({
      label: 'COLLECTOR NOT SYNCING', stale: true
    });
    expect(collectorSyncLabel([account('fresh'), account('fresh')])).toEqual({
      label: 'SYNCING EVERY 5 MIN', stale: false
    });
  });

  it('labels Google AI Pro separately from other providers and Gemini API billing', () => {
    expect(providerNames.google).toBe('Google AI Pro');
    expect(limitName(bucket('gemini_apps', 'session', 18_000))).toBe('5-hour window');
    expect(limitName(bucket('gemini_apps', 'weekly', 604_800))).toBe('Weekly window');
    expect(statusLabel({ ...account('fresh'), provider: 'google', status: 'partial', limits: [] })).toBe('Signed in · quota unavailable');
  });
});
