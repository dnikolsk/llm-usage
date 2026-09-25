import { NextResponse } from 'next/server';
import { createDashboardSession, dashboardConfigured, dashboardCookie, dashboardSessionMaxAge, validDashboardPassword } from '../../../src/dashboard-auth';

export async function POST(request: Request) {
  if (!dashboardConfigured()) return new Response('Dashboard unavailable', { status: 503 });
  const form = await request.formData();
  const candidate = form.get('password');
  if (typeof candidate !== 'string' || candidate.length > 512 || !validDashboardPassword(candidate)) {
    return NextResponse.redirect(new URL('/?login=failed', request.url), { status: 303 });
  }
  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 });
  response.cookies.set(dashboardCookie, createDashboardSession(), {
    httpOnly: true, secure: request.url.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: dashboardSessionMaxAge
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
