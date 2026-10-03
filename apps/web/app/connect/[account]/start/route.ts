import { identifier } from '@llm-usage/core';
import { guard, redirect } from '../../../../src/connect-guard';
import { beginEnrollment, enrollmentCookie } from '../../../../src/enroll';
import { sessionKeyConfigured } from '../../../../src/crypto';
import { accountProvider } from '../../../../src/accounts';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ account: string }> }) {
  const denied = guard(request); if (denied) return denied;
  const { account } = await context.params;
  if (!identifier.safeParse(account).success) return redirect('/connect?error=unknown_account');
  if (!sessionKeyConfigured()) return redirect('/connect?error=session_key_required');
  const provider = await accountProvider(account);
  if (!provider) return redirect('/connect?error=unknown_account');
  let begun;
  try { begun = beginEnrollment(account, provider); } catch { return redirect('/connect?error=provider_unsupported'); }
  const response = redirect(`/connect?account=${encodeURIComponent(account)}`);
  response.headers.append('Set-Cookie', `${enrollmentCookie}=${begun.cookie}; Path=/connect; HttpOnly; SameSite=Strict; Max-Age=600${request.url.startsWith('https://') ? '; Secure' : ''}`);
  return response;
}
