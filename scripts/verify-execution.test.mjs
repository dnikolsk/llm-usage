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

test('CLI preflight accepts a new owners repository without submitting work',async()=>{
 const {spawn}=await import('node:child_process');
 const directory=await mkdtemp(join(tmpdir(),'owner-cli-'));
 const {writeFile}=await import('node:fs/promises');
 const requests=[];
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  requests.push({path:req.url,body});res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url.endsWith('/accounts')?{accounts:[],targets:[]}:{selected:null}));
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const config=join(directory,'worker.json');await writeFile(config,JSON.stringify({service_url:`http://127.0.0.1:${server.address().port}`}));
  const result=await new Promise(resolve=>{
   const child=spawn(process.execPath,['scripts/verify-execution.mjs',config,join(directory,'results'),'--repository','my-project'],{env:{PATH:process.env.PATH,JOB_TOKEN:'x'.repeat(32)},stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.resume();child.on('close',code=>resolve({code,stderr}));
  });
  assert.equal(result.code,0,result.stderr);assert.equal(requests.length,5);assert.ok(requests.filter(r=>r.body).every(r=>r.body.repository==='my-project'));assert.ok(requests.every(r=>!r.path.endsWith('/jobs')));
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
