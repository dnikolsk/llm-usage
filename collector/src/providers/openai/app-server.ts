import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

type Window = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
type RateLimits = { limitId?: unknown; primary?: Window | null; secondary?: Window | null };

export function parseRateLimits(raw: unknown, accountId: string, observedAt: string): IngestSnapshot {
  const response = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const byId = response.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === 'object'
    ? response.rateLimitsByLimitId as Record<string, unknown> : {};
  const limits = (byId.codex ?? response.rateLimits) as RateLimits | undefined;
  const windows = [limits?.primary, limits?.secondary];
  const value = (minutes: number) => {
    const matches = windows.filter((window): window is Window => !!window && window.windowDurationMins === minutes);
    if (matches.length !== 1) return null;
    const used = matches[0]?.usedPercent;
    return typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100 ? used / 100 : null;
  };
  const session = limits?.limitId === 'codex' ? value(300) : null;
  const weekly = limits?.limitId === 'codex' ? value(10_080) : null;
  const found = Number(session !== null) + Number(weekly !== null);
  const reset = (minutes: number): string | null => {
    const window = windows.find(candidate => candidate?.windowDurationMins === minutes);
    const timestamp = window?.resetsAt;
    return typeof timestamp === 'number' && Number.isInteger(timestamp) && timestamp > 0 && timestamp < 8_640_000_000_000
      ? new Date(timestamp * 1000).toISOString() : null;
  };
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'openai', observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: found ? [
      { id: 'session-work-codex', kind: 'session', used: session, seconds: 18_000, resetAt: reset(300) },
      { id: 'weekly-work-codex', kind: 'weekly', used: weekly, seconds: 604_800, resetAt: reset(10_080) }
    ].map(bucket => ({
      id: bucket.id, account_id: accountId, kind: bucket.kind, scope: 'work_codex', unit: 'fraction',
      window_seconds: bucket.seconds, used_fraction: bucket.used,
      remaining_fraction: bucket.used === null ? null : 1 - bucket.used,
      reset_at: bucket.resetAt, observed_at: observedAt,
      source: 'local_collector' as const, confidence: bucket.used === null ? 'unknown' as const : 'provider_reported' as const
    })) : []
  });
}

export async function collect(accountId: string): Promise<IngestSnapshot> {
  const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let nextId = 1;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const timeout = setTimeout(() => {
    for (const pending of waiting.values()) pending.reject(new Error('Codex app-server timed out'));
    waiting.clear();
    child.kill();
  }, 15_000);
  lines.on('line', line => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      const pending = message.id === undefined ? undefined : waiting.get(message.id);
      if (!pending) return;
      waiting.delete(message.id!);
      if (message.error) pending.reject(new Error('Codex app-server request failed'));
      else pending.resolve(message.result);
    } catch { /* Ignore non-JSON diagnostics, never log raw output. */ }
  });
  child.on('error', () => {
    for (const pending of waiting.values()) pending.reject(new Error('Codex CLI is unavailable'));
    waiting.clear();
  });
  child.on('exit', () => {
    for (const pending of waiting.values()) pending.reject(new Error('Codex app-server exited'));
    waiting.clear();
  });
  const request = (method: string, params?: object): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'llm-usage', title: 'LLM Usage Collector', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const response = await request('account/rateLimits/read');
    return parseRateLimits(response, accountId, new Date().toISOString());
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.kill();
  }
}
