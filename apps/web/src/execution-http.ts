import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { identifier } from '@llm-usage/core';
import { ExecutionError } from './execution-store';
export function access(request: Request, scope: 'job' | 'admin' | 'worker') {
  const worker = request.headers.get('x-worker-id');
  if (scope === 'worker' && !identifier.safeParse(worker).success) return false;
  const name = scope === 'worker' ? `WORKER_${worker!.replace(/-/g,'_').toUpperCase()}_TOKEN` : `${scope.toUpperCase()}_TOKEN`;
  const expected = process.env[name];
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || expected.length < 32) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}
export async function limitedBody(request: Request, maximum = 65_536) {
  if (!request.body) throw new ExecutionError('missing_body',400);
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new ExecutionError('body_too_large',413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new ExecutionError('invalid_json',400); }
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export function failure(error: unknown) {
  if (error instanceof ExecutionError) return json({ error: error.code },error.status);
  if (error instanceof z.ZodError) return json({ error: 'invalid_request', issues: error.issues.map(i=>({path:i.path,message:i.message})) },400);
  return json({ error: 'service_unavailable' },503);
}
