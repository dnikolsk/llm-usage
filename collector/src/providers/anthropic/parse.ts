import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

// Only percentages shown on the page are published. Ambiguous reset text stays unknown.
export function parseUsage(text: string, accountId: string, observedAt: string): IngestSnapshot {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const session = slice(lines, /current session|5.hour (?:session|limit)/i, /weekly limits?|this week|usage credits|extra usage|^resets$/i);
  const sessionUsed = percentUsed(session);
  const weekly = slice(lines, /weekly limits?|this week/i, /usage credits|extra usage|^resets$/i);
  const allModels = slice(weekly, /all models/i, /opus|sonnet|haiku|fable/i);
  const weeklyUsed = percentUsed(allModels.length ? allModels : weekly);
  const found = Number(sessionUsed !== null) + Number(weeklyUsed !== null);
  const values = found ? [
    { id: 'session-all', kind: 'session', used: sessionUsed },
    { id: 'weekly-all', kind: 'weekly', used: weeklyUsed }
  ] : [];
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'anthropic', observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: values.map(({ id, kind, used }) => ({
      id, account_id: accountId, kind, scope: 'all_models', unit: 'fraction',
      used_fraction: used, remaining_fraction: used === null ? null : 1 - used,
      observed_at: observedAt, source: 'provider_ui', confidence: used === null ? 'unknown' : 'provider_reported'
    }))
  });
}

function slice(lines: string[], start: RegExp, end: RegExp): string[] {
  const first = lines.findIndex(line => start.test(line));
  if (first < 0) return [];
  const last = lines.findIndex((line, index) => index > first && end.test(line));
  return lines.slice(first, last < 0 ? undefined : last);
}

function percentUsed(lines: string[]): number | null {
  const matches = lines.flatMap(line => [...line.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*used\b/gi)]);
  if (matches.length !== 1) return null;
  const value = Number(matches[0]?.[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}
