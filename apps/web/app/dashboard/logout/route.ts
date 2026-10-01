import { NextResponse } from 'next/server';
import { dashboardCookie } from '../../../src/dashboard-auth';

export async function POST(request: Request) {
  const response = new NextResponse(null, {status:303,headers:{Location:'/'}});
  response.cookies.set(dashboardCookie, '', { httpOnly: true, secure: request.url.startsWith('https://'), sameSite: 'strict', path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
