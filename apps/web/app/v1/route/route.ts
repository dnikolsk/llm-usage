import { route } from '@llm-usage/core';
import { authorized, unauthorized, unavailable } from '../../../src/auth';
import { getStatus, getPolicy } from '../../../src/store';
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
