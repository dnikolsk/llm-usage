import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

const execFileAsync = promisify(execFile);

export function parseCliUsage(text: string, accountId: string, observedAt: string): IngestSnapshot {
  const percent = (label: RegExp): number | null => {
    const matches = [...text.matchAll(label)];
    if (matches.length !== 1) return null;
    const used = Number(matches[0]?.[1]);
    return Number.isFinite(used) && used >= 0 && used <= 100 ? used / 100 : null;
  };
  const session = percent(/^Current session:\s*(\d{1,3}(?:\.\d+)?)% used\b/gim);
  const weekly = percent(/^Current week \(all models\):\s*(\d{1,3}(?:\.\d+)?)% used\b/gim);
  const found = Number(session !== null) + Number(weekly !== null);
  return ingestSnapshot.parse({
    account_id: accountId, provider: 'anthropic', observed_at: observedAt,
    status: found === 2 ? 'ok' : found ? 'partial' : 'error',
    metadata: found ? {} : { diagnostic_code: 'usage_values_unavailable' },
    limits: found ? [
      { id: 'session-all', kind: 'session', used: session },
      { id: 'weekly-all', kind: 'weekly', used: weekly }
    ].map(bucket => ({ id: bucket.id, account_id: accountId, kind: bucket.kind,
      scope: 'all_models', unit: 'fraction', used_fraction: bucket.used,
      remaining_fraction: bucket.used === null ? null : 1 - bucket.used,
      observed_at: observedAt, source: 'local_collector' as const,
      confidence: bucket.used === null ? 'unknown' as const : 'provider_reported' as const
    })) : []
  });
}

export async function collect(accountId: string): Promise<IngestSnapshot> {
  const cwd = join(homedir(), '.llm-usage', 'cli-probe');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const { stdout } = await execFileAsync('claude', ['-p', '/usage', '--output-format', 'text', '--permission-mode', 'plan'],
    { cwd, timeout: 15_000, maxBuffer: 16_384, encoding: 'utf8' });
  return parseCliUsage(stdout, accountId, new Date().toISOString());
}
