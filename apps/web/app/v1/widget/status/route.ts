import { validDashboardSession } from '../../../../src/dashboard-auth';
import { getStatus } from '../../../../src/store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const session = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!validDashboardSession(session))
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try { return Response.json(await getStatus(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'service_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
