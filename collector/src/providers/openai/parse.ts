import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

// Chat messages, credits, and API usage are different allowances and are not inferred here.
export function parseUsage(text: string, accountId: string, observedAt: string): IngestSnapshot {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const session = meter(lines, /(?:5.hour|5h|five.hour)\s*(?:usage|limit|window|allowance)?/i,
    /weekly|7.day|credits|billing|monthly/i);
  const weekly = meter(lines, /(?:weekly|7.day)\s*(?:usage|limit|window|allowance)?/i,
    /credits|billing|monthly|personal analytics/i);
  const values = [session, weekly];
  const found = values.filter(value => value !== null).length;
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'openai', observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: found ? values.map((remaining, index) => ({
      id: index ? 'weekly-work-codex' : 'session-work-codex',
      account_id: accountId, kind: index ? 'weekly' : 'session', scope: 'work_codex',
      unit: 'fraction', used_fraction: remaining === null ? null : 1 - remaining,
      remaining_fraction: remaining, observed_at: observedAt, source: 'provider_ui' as const,
      confidence: remaining === null ? 'unknown' as const : 'provider_reported' as const
    })) : []
  });
}

function meter(lines: string[], heading: RegExp, next: RegExp): number | null {
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && next.test(line));
  const section = lines.slice(start, end < 0 ? undefined : end).slice(0, 12).join(' ');
  const remaining = [...section.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:remaining|left|available)\b/gi)];
  const used = [...section.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*used\b/gi)];
  if (remaining.length + used.length !== 1) return null;
  const percent = Number((remaining[0] ?? used[0])?.[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return remaining.length ? percent / 100 : 1 - percent / 100;
}
