import { type IngestSnapshot } from '@llm-usage/core';
import { source as anthropic } from './providers/anthropic/source';
import { source as cursor } from './providers/cursor/source';
import { source as openai } from './providers/openai/source';

const sources = [anthropic, cursor, openai];

export function snapshotFromTab(rawUrl: string, text: string, observedAt = new Date().toISOString()): IngestSnapshot {
  if (text.length > 200_000) throw new Error('Usage page text is too large');
  const url = new URL(rawUrl);
  const source = sources.find(candidate => candidate.matches(url));
  if (!source) throw new Error('Open a supported provider usage page');
  return source.parseUsage(text, source.accountId, observedAt);
}
