import { ingestSnapshot } from '@llm-usage/core';
import { collect } from './providers/openai/app-server';
import { publish } from './publish';
import { loadWriteToken } from './write-token';

const command = process.argv[2];
const accountId = process.env.LLM_USAGE_ACCOUNT_ID ?? 'chatgpt-personal';
if (command !== 'preview' && command !== 'sync') throw new Error('Usage: openai-cli preview|sync');
let snapshot;
try { snapshot = await collect(accountId); }
catch {
  snapshot = ingestSnapshot.parse({ account_id: accountId, provider: 'openai', observed_at: new Date().toISOString(),
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
