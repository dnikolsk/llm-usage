import { identifier } from '@llm-usage/core';
import { guard, redirect } from '../../../../src/connect-guard';
import { removeOrphanAccount } from '../../../../src/accounts';
export const runtime = 'nodejs';
/** Remove an account registered by mistake. Refused while it still has a session, an execution target or any job. */
export async function POST(request: Request, context: { params: Promise<{ account: string }> }) {
  const denied = guard(request); if (denied) return denied;
  const { account } = await context.params;
  if (!identifier.safeParse(account).success) return redirect('/connect?error=unknown_account');
  const result = await removeOrphanAccount(account).catch(() => 'account_removal_failed' as const);
  return redirect(result === 'removed' ? `/connect?removed=${encodeURIComponent(account)}` : `/connect?error=${result}`);
}
