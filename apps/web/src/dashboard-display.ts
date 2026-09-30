import type { AccountState, UsageBucket } from '@llm-usage/core';

export const providerNames: Record<string, string> = {
  anthropic: 'Claude', openai: 'ChatGPT / Codex', cursor: 'Cursor', google: 'Google AI Pro'
};
export const providerMarks: Record<string, string> = {
  anthropic: 'C', openai: '◎', cursor: '⌘', google: 'G'
};

export function percent(value: number | null): string {
  return value === null ? 'Unknown' : `${Math.round(value * 100)}%`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}

export function age(iso: string | null, now: Date): string {
  if (!iso) return 'Never';
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function limitName(bucket: UsageBucket): string {
  if (bucket.scope === 'cursor_models') return 'Cursor Models';
  if (bucket.scope === 'other_models') return 'Other Models';
  if (bucket.scope === 'gemini_apps' && bucket.kind === 'session') return '5-hour window';
  if (bucket.scope === 'gemini_apps' && bucket.kind === 'weekly') return 'Weekly window';
  if (bucket.kind === 'session' && bucket.window_seconds === 18_000) return '5-hour window';
  if (bucket.kind === 'session') return 'Current session';
  if (bucket.kind === 'weekly') return 'Weekly window';
  return bucket.kind.replaceAll('_', ' ');
}

export function statusLabel(account: AccountState): string {
  if (account.status === 'error') return 'Collector error';
  if (account.freshness !== 'fresh') return account.freshness === 'unknown' ? 'No recent data' : 'Stale data';
  if (account.provider === 'cursor' && !account.limits.length) return 'Signed in · quota unavailable';
  if (account.provider === 'google' && !account.limits.length) return 'Signed in · quota unavailable';
  return account.status === 'partial' ? 'Partial data' : 'Up to date';
}

export function collectorSyncLabel(accounts: AccountState[] | null): { label: string; stale: boolean } {
  if (!accounts?.length) return { label: 'SERVICE UNAVAILABLE', stale: true };
  if (accounts.every(account => account.freshness === 'fresh')) return { label: 'SYNCING EVERY 5 MIN', stale: false };
  if (accounts.some(account => account.freshness === 'fresh' || account.freshness === 'stale'))
    return { label: 'SYNC DELAYED', stale: true };
  return { label: 'COLLECTOR NOT SYNCING', stale: true };
}
