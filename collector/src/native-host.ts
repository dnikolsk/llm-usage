import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { snapshotFromTab } from './browser-source';
import { publish } from './publish';
import { loadWriteToken } from './write-token';

type Request = { action: 'preview' | 'sync'; url: string; text: string };

async function handle(request: Request) {
  if (!request || !['preview', 'sync'].includes(request.action) ||
      typeof request.url !== 'string' || typeof request.text !== 'string') throw new Error('Invalid collector request');
  const snapshot = snapshotFromTab(request.url, request.text);
  if (request.action === 'preview') return { status: snapshot.status, account_id: snapshot.account_id, limits: snapshot.limits };
  const config = JSON.parse(await readFile(join(homedir(), '.llm-usage', 'config.json'), 'utf8')) as { service_url?: unknown };
  if (typeof config.service_url !== 'string') throw new Error('Set service_url in ~/.llm-usage/config.json');
  const result = await publish(snapshot, config.service_url, await loadWriteToken());
  return { status: snapshot.status, account_id: snapshot.account_id, result };
}

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1_048_580) throw new Error('Collector request too large');
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  if (input.length < 4) throw new Error('Missing native message');
  const length = input.readUInt32LE(0);
  if (length > 1_048_576 || input.length !== length + 4) throw new Error('Invalid native message length');
  const request = JSON.parse(input.subarray(4).toString('utf8')) as Request;
  return handle(request);
}

try {
  const response = await main();
  const body = Buffer.from(JSON.stringify(response));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
} catch (error) {
  const body = Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : 'Collector failed' }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}
