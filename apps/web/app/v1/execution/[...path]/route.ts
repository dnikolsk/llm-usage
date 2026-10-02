import { z } from 'zod';
import { taskSpec, jobRequest, ingestSnapshot, identifier, executionProvider, targetRegistration, targetHealth } from '@llm-usage/core';
import * as store from '../../../../src/execution-store';
import { access, limitedBody, json, failure } from '../../../../src/execution-http';
export const runtime = 'nodejs';
const accountInput = z.object({ id: identifier, provider: executionProvider, label: z.string().min(1).max(100),
  account_type: z.enum(['personal','work']).default('personal') }).strict();
const leaseInput = z.object({ job_id: z.uuid(), lease_token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!access(request,'job')) return json({error:'unauthorized'},401);
  try {
    const { path } = await context.params;
    if (path.join('/') === 'accounts') return json(await store.listExecutionAccounts());
    if (path[0] === 'jobs' && path.length === 2) return json(await store.getJob(z.uuid().parse(path[1])));
    return json({error:'not_found'},404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  const scope = route.startsWith('worker/') ? 'worker' : (['accounts','targets'].includes(route)||path[2]==='resolve') ? 'admin' : 'job';
  if (!access(request,scope)) return json({error:'unauthorized'},401);
  try {
    const body = await limitedBody(request, route === 'worker/finish' ? 262_144 : 65_536);
    switch (route) {
      case 'accounts': return json(await store.registerAccount(accountInput.parse(body)),201);
      case 'targets': return json(await store.registerTarget(targetRegistration.parse(body)),201);
      case 'plan': return json(await store.planTask(taskSpec.parse(body)));
      case 'jobs': {
        const key = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).parse(request.headers.get('idempotency-key'));
        return json(await store.submitJob(jobRequest.parse(body),key),202);
      }
      case 'worker/usage': return json(await store.reportUsage(request.headers.get('x-worker-id')!,ingestSnapshot.parse(body)));
      case 'worker/health': return json(await store.reportHealth(request.headers.get('x-worker-id')!,targetHealth.parse(body)));
      case 'worker/claim': z.object({}).strict().parse(body); return json(await store.claimJob(request.headers.get('x-worker-id')!));
      case 'worker/heartbeat': {
        const input = leaseInput.parse(body);
        return json(await store.heartbeatJob(request.headers.get('x-worker-id')!,input.job_id,input.lease_token));
      }
      case 'worker/finish': {
        const input = leaseInput.extend({result:store.workerResult}).parse(body);
        return json(await store.finishJob(request.headers.get('x-worker-id')!,input.job_id,input.lease_token,input.result));
      }
      default:
        if (path[0] === 'jobs' && path[2] === 'resolve' && path.length === 3) return json(await store.resolveJob(z.uuid().parse(path[1]),store.workerResult.parse(body)));
        if (path[0] === 'jobs' && path[2] === 'cancel' && path.length === 3) {
          z.object({}).strict().parse(body); return json(await store.cancelJob(z.uuid().parse(path[1])));
        }
        return json({error:'not_found'},404);
    }
  } catch (error) { return failure(error); }
}
