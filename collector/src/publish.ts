import { createHash } from 'node:crypto';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';

export async function publish(snapshot: IngestSnapshot, baseUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<'created' | 'duplicate'> {
  const url = new URL('/v1/ingest', baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('Collector endpoint must use HTTPS or local HTTP');
  if (token.length < 32) throw new Error('LLM_USAGE_WRITE_TOKEN must be at least 32 characters');
  const body = JSON.stringify(ingestSnapshot.parse(snapshot));
  const key = createHash('sha256').update(body).digest('hex');
  const response = await fetcher(url, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Idempotency-Key': key, 'Content-Type': 'application/json'
  }, body });
  if (response.status === 201) return 'created';
  if (response.status === 200) return 'duplicate';
  throw new Error(`Ingestion failed with HTTP ${response.status}`);
}
