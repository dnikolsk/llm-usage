import { ingestSnapshot } from '@llm-usage/core';
import { authorized, unauthorized, unavailable } from '../../../src/auth';
import { ingest } from '../../../src/store';
export const runtime='nodejs';
export async function POST(request:Request) {
  if (!authorized(request,'write')) return unauthorized();
  const key=request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) return Response.json({error:'invalid_idempotency_key'},{status:400});
  let raw:unknown;
  try { raw=await request.json(); } catch { return Response.json({error:'invalid_json'},{status:400}); }
  const parsed=ingestSnapshot.safeParse(raw);
  if (!parsed.success) return Response.json({error:'invalid_snapshot',issues:parsed.error.issues.map(i=>({path:i.path,message:i.message}))},{status:400});
  if (Math.abs(Date.now()-Date.parse(parsed.data.observed_at))>86_400_000) return Response.json({error:'observation_outside_24h'},{status:400});
  try {
    const result=await ingest(parsed.data,key);
    return Response.json({result},{status:result==='created'?201:result==='duplicate'?200:result==='unknown_account'?404:409,headers:{'Cache-Control':'no-store'}});
  } catch { return unavailable(); }
}
