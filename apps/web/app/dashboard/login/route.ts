import { NextResponse } from 'next/server';
import { createDashboardSession, dashboardConfigured, dashboardCookie, dashboardSessionMaxAge, validDashboardPassword } from '../../../src/dashboard-auth';

export async function POST(request: Request) {
  if (!dashboardConfigured()) return new Response('Dashboard unavailable', { status: 503 });
  const form = await request.formData();
  const candidate = form.get('password');
  if (typeof candidate !== 'string' || candidate.length > 512 || !validDashboardPassword(candidate)) {
    return new NextResponse(null, {status:303,headers:{Location:'/?login=failed'}});
  }
  const response = new NextResponse(null, {status:303,headers:{Location:'/'}});
  response.cookies.set(dashboardCookie, createDashboardSession(), {
    httpOnly: true, secure: request.url.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: dashboardSessionMaxAge
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
