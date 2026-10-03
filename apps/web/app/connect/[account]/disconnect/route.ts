import { identifier } from '@llm-usage/core';
import { guard, redirect } from '../../../../src/connect-guard';
import { deleteSession } from '../../../../src/sessions';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ account: string }> }) {
  const denied = guard(request); if (denied) return denied;
  const { account } = await context.params;
  if (identifier.safeParse(account).success) await deleteSession(account).catch(() => {});
  return redirect('/connect');
}
