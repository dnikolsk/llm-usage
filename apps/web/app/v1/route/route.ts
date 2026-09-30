import { route, recommendTask, taskRouteRequest } from '@llm-usage/core';
import { authorized, unauthorized, unavailable } from '../../../src/auth';
import { getStatus, getPolicy } from '../../../src/store';
import { evaluateTask, JevUnavailable } from '../../../src/jev';
export const runtime='nodejs';
export async function GET(request:Request) {
  if (!authorized(request,'read')) return unauthorized();
  const url=new URL(request.url), capability=url.searchParams.get('capability') ?? undefined, model_class=url.searchParams.get('model_class') ?? undefined;
  if ([capability,model_class].some(v=>v && !/^[a-z][a-z0-9_-]{0,79}$/.test(v))) return Response.json({error:'invalid_filter'},{status:400});
  try {
    const now=new Date();
    const [status,policy]=await Promise.all([getStatus(now),getPolicy()]);
    return Response.json(route(status.accounts,{capability,model_class,now,policy}),{headers:{'Cache-Control':'no-store'}});
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  if (!authorized(request, 'read')) return unauthorized();
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  const parsed = taskRouteRequest.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    const now = new Date();
    const [status, policy] = await Promise.all([getStatus(now), getPolicy()]);
    const judgment = await evaluateTask(parsed.data);
    return Response.json(recommendTask(status.accounts, parsed.data, judgment, { now, policy }),
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof JevUnavailable) return Response.json({ error: 'jev_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return unavailable();
  }
}
