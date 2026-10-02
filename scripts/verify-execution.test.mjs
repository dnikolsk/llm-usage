import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from './verify-execution.mjs';

test('preflight does not submit; interrupted monitoring reuses the original submission key', async () => {
  const output = await mkdtemp(join(tmpdir(), 'execution-verify-'));
  const submissions = [];
  let complete = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    assert.equal(req.headers.authorization, `Bearer ${'x'.repeat(32)}`);
    let response;
    if (req.url.endsWith('/accounts')) response = { accounts: [], targets: [] };
    else if (req.url.endsWith('/plan')) response = { selected: { target_id: 'test-local' } };
    else {
      if (req.method === 'POST') submissions.push({ key: req.headers['idempotency-key'], body });
      response = { id: 'test-job', state: complete ? 'succeeded' : 'running', result: complete ? { patch: `+subscription verification ${submissions[0].key}\n` } : null };
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const options = { service: `http://127.0.0.1:${server.address().port}`, token: 'x'.repeat(32), output, timeoutMs: 0 };
    await verify(options); assert.equal(submissions.length, 0);
    await assert.rejects(verify({ ...options, run: true }), /has not been cancelled or replayed/);
    complete = true;
    await verify({ ...options, run: true });
    assert.equal(submissions.length, 2); assert.deepEqual(submissions[0], submissions[1]);
    assert.match(await readFile(join(output, 'changes.patch'), 'utf8'), /subscription verification/);
  } finally { await new Promise(r => server.close(r)); await rm(output, { recursive: true, force: true }); }
});

test('rejects remote cleartext URLs before sending a credential', async () => {
  await assert.rejects(verify({ service: 'http://example.com', token: 'x'.repeat(32), output: '/unused' }), /Use HTTPS/);
});
