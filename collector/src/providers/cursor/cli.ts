import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

const execFileAsync = promisify(execFile);

export function parseCliStatus(raw: unknown, accountId: string, observedAt: string): IngestSnapshot {
  const status = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const authenticated = status.status === 'authenticated' && status.isAuthenticated === true;
  return ingestSnapshot.parse({
    account_id: accountId,
    provider: 'cursor',
    observed_at: observedAt,
    status: authenticated ? 'partial' : 'error',
    limits: [],
    metadata: { diagnostic_code: authenticated ? 'personal_usage_unavailable' : 'cli_not_authenticated' }
  });
}

export async function collect(accountId: string): Promise<IngestSnapshot> {
  const { stdout } = await execFileAsync('cursor-agent', ['status', '--format', 'json'],
    { timeout: 10_000, maxBuffer: 16_384, encoding: 'utf8' });
  return parseCliStatus(JSON.parse(stdout) as unknown, accountId, new Date().toISOString());
}
