import { ingestSnapshot } from '@llm-usage/core';
import { collect } from './providers/anthropic/cli';
import { publish } from './publish';
import { loadWriteToken } from './write-token';

const command = process.argv[2];
const accountId = process.env.LLM_USAGE_ACCOUNT_ID ?? 'claude-personal';
if (command !== 'preview' && command !== 'sync') throw new Error('Usage: claude-cli preview|sync');
let snapshot;
try { snapshot = await collect(accountId); }
catch {
  snapshot = ingestSnapshot.parse({ account_id: accountId, provider: 'anthropic', observed_at: new Date().toISOString(),
    status: 'error', limits: [], metadata: { diagnostic_code: 'cli_collection_failed' } });
}
if (command === 'preview') {
  process.stdout.write(JSON.stringify({ account_id: snapshot.account_id, status: snapshot.status,
    limits: snapshot.limits.map(limit => ({ kind: limit.kind, scope: limit.scope,
      remaining_fraction: limit.remaining_fraction, reset_at: limit.reset_at })) }, null, 2) + '\n');
} else {
  const result = await publish(snapshot, process.env.LLM_USAGE_URL ?? 'http://localhost:3000', await loadWriteToken());
  process.stdout.write(`${accountId}: ${snapshot.status} (${result})\n`);
}
