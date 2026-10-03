import { guard, redirect, formText } from '../../../../src/connect-guard';
import { completeEnrollment, enrollmentCookie, readEnrollment } from '../../../../src/enroll';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request, context: { params: Promise<{ account: string }> }) {
  const denied = guard(request); if (denied) return denied;
  const { account } = await context.params;
  const cookie = (request.headers.get('cookie') ?? '').split(/;\s*/).find(c => c.startsWith(`${enrollmentCookie}=`))?.slice(enrollmentCookie.length + 1);
  const enrollment = readEnrollment(cookie);
  if (!enrollment || enrollment.account_id !== account) return redirect(`/connect?account=${encodeURIComponent(account)}&error=enrollment_expired`);
  const result = await completeEnrollment(enrollment, await formText(request, 'code'));
  if (!result.ok) return redirect(`/connect?account=${encodeURIComponent(account)}&error=${result.code}`);
  const response = redirect(`/connect?connected=${encodeURIComponent(account)}`);
  response.headers.append('Set-Cookie', `${enrollmentCookie}=; Path=/connect; HttpOnly; SameSite=Strict; Max-Age=0`);
  return response;
}
