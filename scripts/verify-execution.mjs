#!/usr/bin/env node
// Uses the deployed service and real subscriptions only with --run.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verify({ service, token, output, run = false, repository = 'ai-builder-tools', timeoutMs = 600_000, pollMs = 3000 }) {
  const url = new URL(service);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or a loopback service URL without embedded credentials.');
  if (!token || token.length < 32) throw new Error('Load JOB_TOKEN from the existing service secret environment.');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const save = (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  async function api(path, body, key) {
    const response = await fetch(new URL('/v1/execution/' + path, url), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}; inspect the service logs without sharing credentials.`);
    return response.json();
  }
  const spec = { repository, execution: 'auto', scope: 'personal', estimated_minutes: 5 };
  const accounts = await api('accounts');
  await save('accounts.json', accounts);
  const plans = {};
  for (const provider of ['auto', 'anthropic', 'openai', 'cursor']) {
    plans[provider] = await api('plan', { ...spec, ...(provider === 'auto' ? {} : { provider }) });
    console.log(`${provider}: ${plans[provider].selected?.target_id ?? 'unavailable (see plans.json)'}`);
  }
  await save('plans.json', plans);
  if (!run) return { plans };
  // Persist the request before submission: a lost response or restart must not create another job.
  let attempt;
  try { attempt = JSON.parse(await readFile(resolve(output, 'attempt.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (attempt) {
    if (attempt.service !== url.origin || attempt.request?.repository !== repository || !/^[a-zA-Z0-9_-]{16,128}$/.test(attempt.key)) throw new Error('This output directory belongs to another verification attempt.');
  } else {
    if (!plans.auto.selected) throw new Error('No eligible subscription target. See plans.json; no task submitted.');
    const key = randomUUID();
    attempt = { service: url.origin, key, request: { ...spec, prompt: `Create only the new file subscription-verification-${key}.txt at the repository root containing exactly this line followed by a newline: subscription verification ${key}. Do not change other files, install packages, commit, push, or deploy. Return the change for review.` } };
    await writeFile(resolve(output, 'attempt.json'), JSON.stringify(attempt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  let job = await api('jobs', attempt.request, attempt.key);
  await save('job.json', job);
  console.log(`Job ${job.id}; rerun with the same output directory to resume monitoring.`);
  const deadline = Date.now() + timeoutMs;
  while (['queued', 'running'].includes(job.state) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollMs));
    job = await api(`jobs/${job.id}`);
    await save('job.json', job);
  }
  if (job.result?.patch) await writeFile(resolve(output, 'changes.patch'), job.result.patch, { mode: 0o600 });
  if (job.state !== 'succeeded') throw new Error(`Job ${job.id}: ${job.state}. See job.json. Monitoring stopped; the job has not been cancelled or replayed.`);
  if (!job.result?.patch?.includes(`+subscription verification ${attempt.key}`)) throw new Error('CLI reported success but the expected edit is missing. Inspect job.json and the worker artifact.');
  console.log('Expected edit returned. Review changes.patch and job.json for the actual execution decision.');
  return { plans, job };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath, output, ...options] = process.argv.slice(2);
  try {
    let run=false,repository='ai-builder-tools',repositorySet=false;
    for(let i=0;i<options.length;i++){
      if(options[i]==='--run'&&!run)run=true;
      else if(options[i]==='--repository'&&options[i+1]&&!repositorySet){repositorySet=true;repository=options[++i];if(!/^[a-z][a-z0-9_-]{1,79}$/.test(repository))throw new Error('Invalid repository key');}
      else throw new Error('Unknown or duplicate verification option');
    }
    if (!configPath || !output) throw new Error('Usage: node scripts/verify-execution.mjs WORKER_CONFIG OUTPUT_DIRECTORY [--repository KEY] [--run]');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    await verify({ service: config.service_url, token: process.env.JOB_TOKEN, output, run, repository });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
