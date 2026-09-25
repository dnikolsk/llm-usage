import { homedir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestSnapshot } from '@llm-usage/core';
import { collect, login } from './providers/anthropic/browser';
import { publish } from './publish';

const command = process.argv[2];
const accountId = process.env.LLM_USAGE_ACCOUNT_ID;
if (!accountId || !/^[a-z][a-z0-9_-]{1,79}$/.test(accountId)) throw new Error('Set a valid LLM_USAGE_ACCOUNT_ID');
const profileDir = resolve(process.env.LLM_USAGE_PROFILE_DIR ?? join(homedir(), '.llm-usage', 'profiles', accountId));
const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
if (profileDir === repoRoot || profileDir.startsWith(repoRoot + sep)) throw new Error('Browser profiles must stay outside the repository');
if (command === 'login') {
  await login(profileDir);
} else if (command === 'sync') {
  const token = process.env.LLM_USAGE_WRITE_TOKEN ?? '';
  const baseUrl = process.env.LLM_USAGE_URL ?? 'http://localhost:3000';
  let snapshot;
  try { snapshot = await collect(profileDir, accountId); }
  catch {
    snapshot = ingestSnapshot.parse({ account_id: accountId, provider: 'anthropic', observed_at: new Date().toISOString(),
      status: 'error', limits: [], metadata: { diagnostic_code: 'browser_collection_failed' } });
  }
  const result = await publish(snapshot, baseUrl, token);
  process.stdout.write(`${accountId}: ${snapshot.status} (${result})\n`);
} else {
  throw new Error('Usage: claude login|sync');
}
