import { z } from 'zod';
import { identifier } from '@llm-usage/core';
import { observerFor, pendingEnrollment, type PendingEnrollment } from '@llm-usage/providers';
import { seal, open } from './crypto';
import { saveGrant } from './sessions';

export const enrollmentCookie = 'llm_usage_enrollment';
const ttlMs = 10 * 60_000;
const envelope = z.object({ account_id: identifier, provider: z.string(), pending: pendingEnrollment, authorization_url: z.url(), expires_at: z.number().int() }).strict();
export type Enrollment = z.infer<typeof envelope>;

/** Start a provider login. The PKCE verifier is sealed into a short-lived cookie, never stored or logged. */
export function beginEnrollment(accountId: string, provider: string, now = Date.now()) {
  const observer = observerFor(provider); if (!observer) throw new Error('provider_unsupported');
  const begun = observer.begin();
  const enrollment: Enrollment = { account_id: accountId, provider, pending: begun.pending, authorization_url: begun.authorization_url, expires_at: now + ttlMs };
  return { cookie: seal(enrollment, 'enrollment'), enrollment, instructions: begun.instructions, input_label: begun.input_label };
}

export function readEnrollment(cookie: string | undefined, now = Date.now()): Enrollment | null {
  if (!cookie) return null;
  try { const value = envelope.parse(open(cookie, 'enrollment')); return value.expires_at > now ? value : null; } catch { return null; }
}

/** Finish a login with what the person pasted back. Returns a diagnostic code instead of throwing so pages can render it. */
export async function completeEnrollment(enrollment: Enrollment, input: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const observer = observerFor(enrollment.provider); if (!observer) return { ok: false, code: 'provider_unsupported' };
  try {
    const granted = await observer.complete(enrollment.pending as PendingEnrollment, input);
    await saveGrant(enrollment.account_id, enrollment.provider, granted);
    return { ok: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'enrollment_failed';
    return { ok: false, code: /^[a-z_]{1,64}$/.test(code) ? code : 'enrollment_failed' };
  }
}

export function enrollmentMessage(code: string) {
  return code === 'enrollment_pending' ? 'The provider has not confirmed the sign-in yet. Finish it in the other tab, then continue again.'
    : code === 'enrollment_rejected' ? 'The provider rejected the code. Start the connection again and paste the new code promptly.'
    : code === 'enrollment_state_mismatch' ? 'That code belongs to a different sign-in attempt. Start again from this page.'
    : code === 'enrollment_input_invalid' ? 'That does not look like a code or redirected address.'
    : code === 'enrollment_expired' ? 'This connection attempt expired. Start again.'
    : code === 'usage_rate_limited' ? 'The provider asked us to wait. Try again in a minute.'
    : code === 'account_in_use' ? 'That account still has a connected session, an execution target or jobs, so it was not removed. Point the worker at the connected account ID and re-register first.'
    : code === 'unknown_account' ? 'That account does not exist.'
    : code === 'provider_unsupported' ? 'This provider is not supported.'
    : `Connection failed (${code.replaceAll('_', ' ')}).`;
}
