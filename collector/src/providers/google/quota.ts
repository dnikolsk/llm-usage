import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

const codeAssistBase = 'https://daily-cloudcode-pa.googleapis.com/v1internal';
const tokenPath = join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

export const googleAccountId = 'google-ai-pro-personal';
export const googleProvider = 'google';
export const geminiAppsScope = 'gemini_apps';

type QuotaBucket = {
  remainingFraction?: unknown;
  resetTime?: unknown;
  window?: unknown;
  displayName?: unknown;
  bucketId?: unknown;
  disabled?: unknown;
};
type QuotaGroup = { displayName?: unknown; buckets?: unknown };
type QuotaSummary = { groups?: unknown };

function remainingFraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function resetAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function windowKind(bucket: QuotaBucket): 'session' | 'weekly' | null {
  const window = typeof bucket.window === 'string' ? bucket.window.toLowerCase() : '';
  const name = `${bucket.displayName ?? ''} ${bucket.bucketId ?? ''}`.toLowerCase();
  if (window === '5h' || window === '5hr' || window.includes('5 hour') || name.includes('five hour') || name.includes('5-hour') || name.includes('5 hour'))
    return 'session';
  if (window === '1w' || window === '7d' || window.includes('week') || name.includes('weekly') || name.includes('week'))
    return 'weekly';
  return null;
}

function isGeminiGroup(group: QuotaGroup): boolean {
  const name = String(group.displayName ?? '').toLowerCase();
  if (name.includes('claude') || name.includes('gpt') || name.includes('api')) return false;
  return name.includes('gemini') || name.includes('google ai');
}

function looksLikeApiBilling(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  return 'totalBillableTokens' in record || 'inputTokenCount' in record || 'generateContentPaid' in record
    || record.billingAccount !== undefined || record.sku === 'generateContent';
}

export function parseQuotaSummary(raw: unknown, accountId: string, observedAt: string): IngestSnapshot {
  if (looksLikeApiBilling(raw)) {
    return ingestSnapshot.parse({
      account_id: accountId, provider: googleProvider, observed_at: observedAt,
      status: 'error', limits: [], metadata: { diagnostic_code: 'gemini_api_billing_ignored' }
    });
  }
  const summary = raw && typeof raw === 'object' ? raw as QuotaSummary : {};
  const groups = Array.isArray(summary.groups) ? summary.groups.filter((group): group is QuotaGroup => !!group && typeof group === 'object') : [];
  const gemini = groups.filter(isGeminiGroup);
  const session: { remaining: number | null; reset: string | null } = { remaining: null, reset: null };
  const weekly: { remaining: number | null; reset: string | null } = { remaining: null, reset: null };
  for (const group of gemini) {
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const item of buckets) {
      if (!item || typeof item !== 'object' || (item as QuotaBucket).disabled) continue;
      const bucket = item as QuotaBucket;
      const kind = windowKind(bucket);
      const remaining = remainingFraction(bucket.remainingFraction);
      if (!kind || remaining === null) continue;
      const target = kind === 'session' ? session : weekly;
      if (target.remaining !== null) return ingestSnapshot.parse({
        account_id: accountId, provider: googleProvider, observed_at: observedAt,
        status: 'error', limits: [], metadata: { diagnostic_code: 'usage_values_unavailable' }
      });
      target.remaining = remaining;
      target.reset = resetAt(bucket.resetTime);
    }
  }
  const found = Number(session.remaining !== null) + Number(weekly.remaining !== null);
  return ingestSnapshot.parse({
    account_id: accountId, provider: googleProvider, observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: found ? [
      { id: 'session-gemini-apps', kind: 'session' as const, remaining: session.remaining, seconds: 18_000, reset: session.reset },
      { id: 'weekly-gemini-apps', kind: 'weekly' as const, remaining: weekly.remaining, seconds: 604_800, reset: weekly.reset }
    ].filter(bucket => bucket.remaining !== null).map(bucket => ({
      id: bucket.id, account_id: accountId, kind: bucket.kind, scope: geminiAppsScope, unit: 'fraction',
      window_seconds: bucket.seconds, used_fraction: 1 - bucket.remaining!,
      remaining_fraction: bucket.remaining, reset_at: bucket.reset,
      observed_at: observedAt, source: 'local_collector' as const, confidence: 'provider_reported' as const
    })) : []
  });
}

export function parseQuotaText(text: string, accountId: string, observedAt: string): IngestSnapshot {
  const percent = (label: RegExp): number | null => {
    const matches = [...text.matchAll(label)];
    if (matches.length !== 1) return null;
    const remaining = Number(matches[0]?.[1]);
    return Number.isFinite(remaining) && remaining >= 0 && remaining <= 100 ? remaining / 100 : null;
  };
  const session = percent(/^\s*Five Hour Limit\s+(\d{1,3}(?:\.\d+)?)%\s+remaining\b/gim);
  const weekly = percent(/^\s*Weekly Limit\s+(\d{1,3}(?:\.\d+)?)%\s+remaining\b/gim);
  return parseQuotaSummary({
    groups: [{
      displayName: 'Gemini Models',
      buckets: [
        { displayName: 'Five Hour Limit', window: '5h', remainingFraction: session },
        { displayName: 'Weekly Limit', window: '1w', remainingFraction: weekly }
      ].filter(bucket => bucket.remainingFraction !== null)
    }]
  }, accountId, observedAt);
}

function accessTokenFromAuth(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const auth = raw as Record<string, unknown>;
  const nested = auth.token && typeof auth.token === 'object' ? auth.token as Record<string, unknown> : auth;
  const token = nested.access_token ?? nested.AccessToken ?? auth.access_token;
  return typeof token === 'string' && token.length > 20 ? token : null;
}

export async function readLocalAccessToken(
  path = tokenPath,
  reader: (file: string) => Promise<string> = (file) => readFile(file, 'utf8')
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await reader(path)) as unknown;
    return accessTokenFromAuth(parsed);
  } catch {
    return null;
  }
}

async function codeAssist(method: string, payload: Record<string, unknown>, token: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(`${codeAssistBase}:${method}`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error('token_expired'), { diagnostic: 'token_expired' });
  if (!response.ok) throw new Error(`quota_request_failed_${response.status}`);
  return await response.json() as unknown;
}

export async function collect(
  accountId: string,
  options: {
    tokenPath?: string;
    reader?: (file: string) => Promise<string>;
    fetcher?: typeof fetch;
  } = {}
): Promise<IngestSnapshot> {
  const observedAt = new Date().toISOString();
  const token = await readLocalAccessToken(options.tokenPath ?? tokenPath, options.reader);
  if (!token) {
    return ingestSnapshot.parse({
      account_id: accountId, provider: googleProvider, observed_at: observedAt,
      status: 'error', limits: [], metadata: { diagnostic_code: 'sign_in_required' }
    });
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    const loaded = await codeAssist('loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY' } }, token, fetcher) as Record<string, unknown>;
    const project = typeof loaded.cloudaicompanionProject === 'string' ? loaded.cloudaicompanionProject : null;
    if (!project) {
      return ingestSnapshot.parse({
        account_id: accountId, provider: googleProvider, observed_at: observedAt,
        status: 'error', limits: [], metadata: { diagnostic_code: 'usage_values_unavailable' }
      });
    }
    const summary = await codeAssist('retrieveUserQuotaSummary', { project }, token, fetcher);
    return parseQuotaSummary(summary, accountId, observedAt);
  } catch (error) {
    const diagnostic = error && typeof error === 'object' && 'diagnostic' in error
      && typeof (error as { diagnostic: unknown }).diagnostic === 'string'
      ? (error as { diagnostic: string }).diagnostic : 'cli_collection_failed';
    return ingestSnapshot.parse({
      account_id: accountId, provider: googleProvider, observed_at: observedAt,
      status: 'error', limits: [], metadata: { diagnostic_code: diagnostic }
    });
  }
}
