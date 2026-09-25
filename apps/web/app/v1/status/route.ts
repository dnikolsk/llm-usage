import { authorized, unauthorized, unavailable } from '../../../src/auth';
import { getStatus } from '../../../src/store';
export const runtime='nodejs';
export async function GET(request:Request) {
  if (!authorized(request,'read')) return unauthorized();
  try { return Response.json(await getStatus(),{headers:{'Cache-Control':'no-store'}}); }
  catch { return unavailable(); }
}
