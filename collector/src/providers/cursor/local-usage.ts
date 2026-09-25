import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

const execFileAsync = promisify(execFile);
const usageUrl = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';

function cycleTime(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function usedFraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value / 100, 1) : null;
}

export function parsePeriodUsage(raw: unknown, accountId: string, observedAt: string): IngestSnapshot {
  const response = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const plan = response.planUsage && typeof response.planUsage === 'object'
    ? response.planUsage as Record<string, unknown> : {};
  const start = cycleTime(response.billingCycleStart);
  const end = cycleTime(response.billingCycleEnd);
  const validCycle = start !== null && end !== null && start < end;
  const buckets = [
    { id: 'monthly-cursor-models', scope: 'cursor_models', used: usedFraction(plan.autoPercentUsed) },
    { id: 'monthly-other-models', scope: 'other_models', used: usedFraction(plan.apiPercentUsed) }
  ].filter((bucket): bucket is { id: string; scope: string; used: number } => bucket.used !== null);
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'cursor', observed_at: observedAt,
    status: buckets.length === 2 ? 'ok' : buckets.length ? 'partial' : 'error',
    metadata: buckets.length ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: buckets.map(bucket => ({
      id: bucket.id, account_id: accountId, kind: 'monthly', scope: bucket.scope, unit: 'fraction',
      used_fraction: bucket.used, remaining_fraction: 1 - bucket.used,
      window_started_at: validCycle ? start : null, reset_at: validCycle ? end : null,
      window_seconds: validCycle ? (Date.parse(end) - Date.parse(start)) / 1000 : null,
      observed_at: observedAt, source: 'local_collector' as const, confidence: 'provider_reported' as const
    }))
  });
}

async function localAccessToken(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const db = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  const { stdout } = await execFileAsync('/usr/bin/sqlite3', ['-readonly', db,
    "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;"],
  { timeout: 5_000, maxBuffer: 4_096, encoding: 'utf8' });
  return stdout.trim() || null;
}

export async function collectLocalUsage(accountId: string): Promise<IngestSnapshot> {
  const token = await localAccessToken();
  if (!token) throw new Error('Cursor desktop token unavailable');
  const response = await fetch(usageUrl, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Connect-Protocol-Version': '1', 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) throw new Error(`Cursor usage request failed: HTTP ${response.status}`);
  return parsePeriodUsage(await response.json() as unknown, accountId, new Date().toISOString());
}
