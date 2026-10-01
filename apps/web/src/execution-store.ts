import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { connectSql } from '@llm-usage/db';
import { decideExecution, type TaskSpec, type JobRequest, type ExecutionAccount, type ExecutionTarget,
  type TargetRegistration, type Continuation, targetHealth } from '@llm-usage/core';
import { getStatus, getPolicy, ingest } from './store';
import { ingestSnapshot } from '@llm-usage/core';

export class ExecutionError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export const workerResult = z.object({
  state: z.enum(['succeeded', 'failed', 'cancelled', 'needs_review']),
  summary: z.string().max(12_000),
  session_id: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(),
  artifact_path: z.string().max(2000).optional(),
  patch: z.string().max(48_000).optional(),
  base_revision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  remote_url: z.url().refine(s => /^https:\/\/(chatgpt\.com|claude\.ai|cursor\.com)\//.test(s)).optional(),
}).strict();
type Sql = ReturnType<typeof connectSql>;
async function using<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = connectSql(); try { return await fn(client); } finally { await client.end(); }
}
function publicJob(row: Record<string, unknown>): Record<string, unknown> & { id: string } {
  const { lease_token: _lease, request_hash: _hash, ...rest } = row; return { ...rest, id: String(row.id) };
}
export async function listExecutionAccounts() {
  return using(async sql => {
    const accounts = await sql<{id:string;provider:string;label:string;account_type:string;enabled:boolean}[]>`SELECT id, provider, label, account_type, enabled FROM accounts ORDER BY id`;
    const targets = await sql`SELECT registration, health, observed_at, cooldown_until FROM execution_targets ORDER BY id`;
    const usage=await getStatus();
    return { accounts:accounts.map(account=>({...account,usage:usage.accounts.find(a=>a.id===account.id)??null})), targets };
  });
}
export async function registerAccount(input: { id: string; provider: string; label: string; account_type: string }) {
  return using(async sql => {
    const result = await sql`INSERT INTO accounts(id,provider,label,account_type,capabilities,model_classes)
      VALUES(${input.id},${input.provider},${input.label},${input.account_type},'["coding"]','[]')
      ON CONFLICT(id) DO NOTHING RETURNING id`;
    if (!result.length) {
      const [existing] = await sql`SELECT provider,account_type FROM accounts WHERE id=${input.id}`;
      if (existing.provider !== input.provider || existing.account_type !== input.account_type) throw new ExecutionError('account_conflict');
    }
    return { id: input.id, state: 'registered', login_verified: false };
  });
}
export async function registerTarget(registration: TargetRegistration) {
  return using(async sql => {
    const [account] = await sql`SELECT id FROM accounts WHERE id=${registration.account_id}`;
    if (!account) throw new ExecutionError('unknown_account',404);
    // Reconfiguration invalidates readiness; only a subsequent worker check restores it.
    await sql`INSERT INTO execution_targets(id,account_id,registration) VALUES(${registration.id},${registration.account_id},${sql.json(registration)})
      ON CONFLICT(id) DO UPDATE SET account_id=EXCLUDED.account_id, registration=EXCLUDED.registration, health='needs_login', observed_at=NULL
      WHERE execution_targets.registration IS DISTINCT FROM EXCLUDED.registration`;
    return { id: registration.id, health: 'needs_login' };
  });
}
async function snapshot(sql: Sql, request: TaskSpec) {
  const [{ accounts: states }, policy, types, targets, active] = await Promise.all([
    getStatus(), getPolicy(), sql`SELECT id,account_type FROM accounts`,
    sql`SELECT * FROM execution_targets`,
    sql`SELECT account_id FROM execution_jobs WHERE state IN ('running','needs_review')`,
  ]);
  const accounts: ExecutionAccount[] = states.map(a => ({ ...a, account_type: types.find(t => t.id === a.id)?.account_type ?? 'personal' }));
  const executionTargets: ExecutionTarget[] = targets.map(t => ({ ...t.registration,
    health: t.health, observed_at: t.observed_at?.toISOString() ?? null, cooldown_until: t.cooldown_until?.toISOString() ?? null,
    busy: active.some(j => j.account_id === t.account_id) }));
  let continuation: Continuation | undefined;
  if (request.continue_job_id) {
    const [previous] = await sql`SELECT * FROM execution_jobs WHERE id=${request.continue_job_id}`;
    if (!previous || previous.request.repository !== request.repository) throw new ExecutionError('invalid_continuation');
    if (['queued','running','needs_review'].includes(previous.state)) throw new ExecutionError('continuation_still_active');
    continuation = { target_id: previous.target_id, account_id: previous.account_id,
      repository: request.repository, resumable: !!previous.result?.session_id, model:previous.decision?.selected?.model??null };
  }
  const decision = decideExecution(accounts, executionTargets, request, { reserves: policy.reserves, continuation });
  if (request.continue_job_id && (!continuation?.resumable || decision.selected?.target_id !== continuation.target_id)) {
    decision.selected = null;
    decision.outcome = 'waiting';
    decision.steps.push({step:'handoff_required',explanation:'The previous session cannot resume on an eligible target. Review its changes and explicitly submit a handoff; never silently discard existing work.',remaining:[]});
  }
  return decision;
}
export function planTask(request: TaskSpec) { return using(sql => snapshot(sql, request)); }
export async function submitJob(request: JobRequest, key: string) {
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return using(async sql => {
    const [existing] = await sql`SELECT * FROM execution_jobs WHERE idempotency_key=${key}`;
    if (existing) { if (existing.request_hash !== hash) throw new ExecutionError('idempotency_conflict'); return publicJob(existing); }
    const decision = await snapshot(sql, request);
    const [row] = await sql`INSERT INTO execution_jobs(idempotency_key,request_hash,request,decision)
      VALUES(${key},${hash},${sql.json(request)},${sql.json(decision)}) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`;
    if (row) return publicJob(row);
    const [winner] = await sql`SELECT * FROM execution_jobs WHERE idempotency_key=${key}`;
    if (winner.request_hash !== hash) throw new ExecutionError('idempotency_conflict');
    return publicJob(winner);
  });
}
export async function getJob(id: string) {
  return using(async sql => { const [row] = await sql`SELECT * FROM execution_jobs WHERE id=${id}`;
    if (!row) throw new ExecutionError('job_not_found',404); return publicJob(row); });
}
export async function cancelJob(id: string) {
  return using(async sql => {
    const [row] = await sql`UPDATE execution_jobs SET cancel_requested=true,
      state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, updated_at=now()
      WHERE id=${id} RETURNING *`;
    if (!row) throw new ExecutionError('job_not_found',404); return publicJob(row);
  });
}
export async function reportHealth(worker: string, input: z.infer<typeof targetHealth>) {
  return using(async sql => {
    const rows = await sql`UPDATE execution_targets SET health=${input.health}, observed_at=now(), cooldown_until=${input.cooldown_until}
      WHERE id=${input.target_id} AND registration->>'worker_id'=${worker} RETURNING id`;
    if (!rows.length) throw new ExecutionError('target_not_owned',403);
    return { ok: true };
  });
}
export async function claimJob(worker: string) {
  // A single transaction lock serializes decisions/claims across workers. Each account is leased once.
  return using(async sql => sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(18273491)`;
    // Uncertain execution is held for review, never automatically replayed or released to another task.
    await tx`UPDATE execution_jobs SET state='needs_review',updated_at=now()
      WHERE state='running' AND lease_until < now()`;
    const queued = await tx`SELECT * FROM execution_jobs WHERE state='queued' ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const job of queued) {
      const decision = await snapshot(tx as unknown as Sql, job.request);
      await tx`UPDATE execution_jobs SET decision=${tx.json(decision)},updated_at=now() WHERE id=${job.id}`;
      const target = decision.selected;
      if (!target) continue;
      const [registered] = await tx`SELECT registration FROM execution_targets WHERE id=${target.target_id}`;
      if (registered.registration.worker_id !== worker) continue;
      const lease = randomBytes(32).toString('hex');
      const [row] = await tx`UPDATE execution_jobs SET state='running',target_id=${target.target_id},account_id=${target.account_id},
        worker_id=${worker},lease_token=${lease},lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=${job.id} RETURNING *`;
      let continuation = null;
      if (job.request.continue_job_id) {
        const [previous] = await tx`SELECT target_id,result FROM execution_jobs WHERE id=${job.request.continue_job_id}`;
        if (previous?.target_id === target.target_id) continuation = previous.result?.session_id ?? null;
      }
      return { ...publicJob(row), lease_token: lease, continuation_session: continuation };
    }
    return null;
  }));
}
export async function heartbeatJob(worker: string, id: string, lease: string) {
  return using(async sql => {
    const [row] = await sql`UPDATE execution_jobs SET lease_until=now()+interval '90 seconds',updated_at=now()
      WHERE id=${id} AND worker_id=${worker} AND lease_token=${lease} AND state='running' AND lease_until>now() RETURNING cancel_requested`;
    if (!row) throw new ExecutionError('lease_lost'); return row;
  });
}
export async function finishJob(worker: string, id: string, lease: string, result: z.infer<typeof workerResult>) {
  return using(async sql => {
    const [row] = await sql`UPDATE execution_jobs SET state=${result.state}, result=${sql.json(result)},updated_at=now()
      WHERE id=${id} AND worker_id=${worker} AND lease_token=${lease} AND state='running' AND lease_until>now() RETURNING *`;
    if (!row) throw new ExecutionError('lease_lost'); return publicJob(row);
  });
}

export async function reportUsage(worker: string, input: z.infer<typeof ingestSnapshot>) {
  return using(async sql => {
    const [target] = await sql`SELECT id FROM execution_targets WHERE account_id=${input.account_id} AND registration->>'worker_id'=${worker} LIMIT 1`;
    if (!target) throw new ExecutionError('target_not_owned',403);
    if (Math.abs(Date.now()-Date.parse(input.observed_at))>86_400_000) throw new ExecutionError('observation_outside_24h',400);
    return { result: await ingest(input,createHash('sha256').update(JSON.stringify(input)).digest('hex')) };
  });
}
export async function resolveJob(id: string, result: z.infer<typeof workerResult>) {
  if (result.state==='needs_review') throw new ExecutionError('terminal_result_required',400);
  return using(async sql => {
    const [row]=await sql`UPDATE execution_jobs SET state=${result.state},result=${sql.json(result)},updated_at=now()
      WHERE id=${id} AND state='needs_review' RETURNING *`;
    if (!row) throw new ExecutionError('job_not_in_review'); return publicJob(row);
  });
}
