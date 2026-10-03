import { z } from 'zod';
import { identifier, executionProvider } from '@llm-usage/core';
import { guard, redirect } from '../../../src/connect-guard';
import { registerAccount } from '../../../src/execution-store';
export const runtime = 'nodejs';
const input = z.object({ id: identifier, provider: executionProvider, label: z.string().trim().min(1).max(100), account_type: z.enum(['personal', 'work']).default('personal') });
export async function POST(request: Request) {
  const denied = guard(request); if (denied) return denied;
  const form = await request.formData();
  const parsed = input.safeParse(Object.fromEntries(['id', 'provider', 'label', 'account_type'].map(k => [k, form.get(k) ?? undefined])));
  if (!parsed.success) return redirect('/connect?error=invalid_account');
  try { await registerAccount(parsed.data); } catch { return redirect('/connect?error=account_conflict'); }
  return redirect(`/connect?account=${encodeURIComponent(parsed.data.id)}`);
}
