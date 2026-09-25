import { createDashboardSession, dashboardConfigured, dashboardSessionMaxAge, validDashboardPassword } from '../../../../src/dashboard-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!dashboardConfigured()) return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  const password = body && typeof body === 'object' && 'password' in body ? body.password : null;
  if (typeof password !== 'string' || password.length > 512 || !validDashboardPassword(password))
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const now = Date.now();
  return Response.json({ session: createDashboardSession(now), expires_at: new Date(now + dashboardSessionMaxAge * 1000).toISOString() },
    { headers: { 'Cache-Control': 'no-store' } });
}
