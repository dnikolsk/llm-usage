import { NextResponse } from 'next/server';
import { dashboardCookie, validDashboardSession } from './dashboard-auth';

/** Enrollment routes: dashboard cookie plus a same-origin check, since they move provider logins. */
export function guard(request: Request): Response | null {
  const cookie = request.headers.get('cookie') ?? '';
  const session = cookie.split(/;\s*/).find(c => c.startsWith(`${dashboardCookie}=`))?.slice(dashboardCookie.length + 1);
  if (!validDashboardSession(session)) return redirect('/');
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') return new Response('Cross-site request rejected', { status: 403 });
  return null;
}
export function redirect(location: string) {
  const response = new NextResponse(null, { status: 303, headers: { Location: location } });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export async function formText(request: Request, name: string, maximum = 8192) {
  const form = await request.formData();
  const value = form.get(name);
  return typeof value === 'string' && value.length <= maximum ? value : '';
}
