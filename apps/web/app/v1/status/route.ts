import { authorized, unauthorized, unavailable } from '../../../src/auth';
import { getStatus } from '../../../src/store';
import { getLiveStatus } from '../../../src/observe';
export const runtime='nodejs';
export const maxDuration=30;
/** Live by default: providers are read now (within a 20 s window). `?fresh=0` returns the stored projection only. */
export async function GET(request:Request) {
  if (!authorized(request,'read')) return unauthorized();
  const fresh=new URL(request.url).searchParams.get('fresh')!=='0';
  try { return Response.json(fresh?await getLiveStatus():await getStatus(),{headers:{'Cache-Control':'no-store'}}); }
  catch { return unavailable(); }
}
