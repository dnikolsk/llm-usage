import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

// The Spending page has separate included-usage pools. On-demand spending is excluded.
export function parseUsage(text: string, accountId: string, observedAt: string): IngestSnapshot {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const cursor = pool(lines, /\bcursor models\b/i, /\bother models\b|\bon.demand\b/i);
  const other = pool(lines, /\bother models\b/i, /\bon.demand\b|\bspending limit\b/i);
  const values = [cursor, other];
  const found = values.filter(value => value !== null).length;
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'cursor', observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: found ? values.map((remaining, index) => ({
      id: index ? 'monthly-other-models' : 'monthly-cursor-models',
      account_id: accountId, kind: 'monthly', scope: index ? 'other_models' : 'cursor_models',
      unit: 'fraction', used_fraction: remaining === null ? null : 1 - remaining,
      remaining_fraction: remaining, observed_at: observedAt, source: 'provider_ui' as const,
      confidence: remaining === null ? 'unknown' as const : 'provider_reported' as const
    })) : []
  });
}

function pool(lines: string[], heading: RegExp, next: RegExp): number | null {
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && next.test(line));
  const section = lines.slice(start, end < 0 ? undefined : end).slice(0, 18).join(' ');
  const remaining = [...section.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:remaining|left|available)\b/gi)];
  const used = [...section.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*used\b/gi)];
  if (remaining.length + used.length === 0) {
    const spent = [...section.matchAll(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:used|spent)\s*(?:of|\/)\s*\$([\d,]+(?:\.\d{1,2})?)/gi)];
    const left = [...section.matchAll(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:remaining|left|available)\s*(?:of|\/)\s*\$([\d,]+(?:\.\d{1,2})?)/gi)];
    if (spent.length + left.length !== 1) return null;
    const match = (spent[0] ?? left[0])!;
    const amount = Number(match[1]?.replaceAll(',', ''));
    const limit = Number(match[2]?.replaceAll(',', ''));
    if (!Number.isFinite(amount) || !Number.isFinite(limit) || limit <= 0 || amount < 0 || amount > limit) return null;
    return left.length ? amount / limit : 1 - amount / limit;
  }
  if (remaining.length + used.length !== 1) return null;
  const percent = Number((remaining[0] ?? used[0])?.[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return remaining.length ? percent / 100 : 1 - percent / 100;
}
