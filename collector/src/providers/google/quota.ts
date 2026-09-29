import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

const execFileAsync = promisify(execFile);

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

export type AgyRunnerResult = { stdout: string; stderr?: string };
export type AgyRunner = () => Promise<AgyRunnerResult>;

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

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/** Normalize agy snake_case / `name` fields into the camelCase shape parseQuotaSummary expects. */
export function normalizeAgyUsage(raw: unknown): QuotaSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const command = root.command && typeof root.command === 'object' ? root.command as Record<string, unknown> : null;
  const data = command?.data && typeof command.data === 'object'
    ? command.data as Record<string, unknown>
    : root.data && typeof root.data === 'object'
      ? root.data as Record<string, unknown>
      : root;
  if (command && command.name !== undefined && command.name !== 'usage') return null;
  const groupsRaw = Array.isArray(data.groups) ? data.groups : null;
  if (!groupsRaw) return null;
  const groups = groupsRaw.flatMap((group): QuotaGroup[] => {
    if (!group || typeof group !== 'object') return [];
    const record = group as Record<string, unknown>;
    const displayName = pickString(record.displayName, record.name);
    const bucketsRaw = Array.isArray(record.buckets) ? record.buckets : [];
    const buckets = bucketsRaw.flatMap((item): QuotaBucket[] => {
      if (!item || typeof item !== 'object') return [];
      const bucket = item as Record<string, unknown>;
      return [{
        bucketId: pickString(bucket.bucketId, bucket.id),
        displayName: pickString(bucket.displayName, bucket.name),
        window: bucket.window,
        remainingFraction: bucket.remainingFraction ?? bucket.remaining_fraction,
        resetTime: bucket.resetTime ?? bucket.reset_time,
        disabled: bucket.disabled
      }];
    });
    return [{ displayName, buckets }];
  });
  return { groups };
}

function isAuthFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('not logged')
    || lower.includes('authentication required')
    || lower.includes('sign in')
    || lower.includes('signin')
    || lower.includes('not signed in')
    || lower.includes('unauthorized')
    || lower.includes('login required');
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  return [record.message, record.stdout, record.stderr].map(value => typeof value === 'string' ? value : '').join('\n');
}

function errorSnapshot(accountId: string, observedAt: string, diagnostic: string): IngestSnapshot {
  return ingestSnapshot.parse({
    account_id: accountId, provider: googleProvider, observed_at: observedAt,
    status: 'error', limits: [], metadata: { diagnostic_code: diagnostic }
  });
}

async function defaultAgyRunner(): Promise<AgyRunnerResult> {
  const result = await execFileAsync('agy', ['-p', '/usage', '--output-format', 'json', '--print-timeout', '45s'], {
    timeout: 60_000,
    maxBuffer: 262_144,
    encoding: 'utf8',
    env: process.env
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function collect(
  accountId: string,
  options: { runner?: AgyRunner } = {}
): Promise<IngestSnapshot> {
  const observedAt = new Date().toISOString();
  const runner = options.runner ?? defaultAgyRunner;
  let stdout = '';
  let stderr = '';
  try {
    const result = await runner();
    stdout = result.stdout ?? '';
    stderr = result.stderr ?? '';
  } catch (error) {
    const text = errorText(error);
    if (isAuthFailure(text)) return errorSnapshot(accountId, observedAt, 'sign_in_required');
    return errorSnapshot(accountId, observedAt, 'cli_collection_failed');
  }
  if (isAuthFailure(`${stdout}\n${stderr}`)) {
    return errorSnapshot(accountId, observedAt, 'sign_in_required');
  }
  const trimmed = stdout.trim();
  if (!trimmed) return errorSnapshot(accountId, observedAt, 'usage_values_unavailable');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return errorSnapshot(accountId, observedAt, 'usage_values_unavailable');
  }
  const normalized = normalizeAgyUsage(parsed);
  if (!normalized) return errorSnapshot(accountId, observedAt, 'usage_values_unavailable');
  return parseQuotaSummary(normalized, accountId, observedAt);
}
