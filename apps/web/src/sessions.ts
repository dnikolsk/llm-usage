import { connectSql } from '@llm-usage/db';
import { grant as grantSchema, observerFor, diagnosticCode, type Grant, type Platform } from '@llm-usage/providers';
import { seal, open } from './crypto';

/** Refresh slightly early so a token does not expire between the lookup and the provider call. */
const refreshMarginMs = 120_000;
type Sql = ReturnType<typeof connectSql>;
export type SessionSummary = { account_id: string; provider: string; status: 'connected' | 'reconnect_required'; failure_code: string | null;
  expires_at: string | null; connected_at: string; refreshed_at: string | null };

async function using<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = connectSql(); try { return await fn(client); } finally { await client.end(); }
}
let ensured = false;
/** The table is also in migrations; creating it lazily lets a deployed service enroll before the operator migrates. */
async function ensure(sql: Sql) {
  if (ensured) return; ensured = true;
  await sql`CREATE TABLE IF NOT EXISTS provider_sessions (account_id text PRIMARY KEY REFERENCES accounts(id), provider text NOT NULL, sealed text NOT NULL,
    expires_at timestamptz, connected_at timestamptz NOT NULL DEFAULT now(), refreshed_at timestamptz, status text NOT NULL DEFAULT 'connected', failure_code text, updated_at timestamptz NOT NULL DEFAULT now())`;
}
const purpose = (accountId: string) => `provider-session:${accountId}`;

export async function listSessions(): Promise<SessionSummary[]> {
  return using(async sql => {
    await ensure(sql);
    const rows = await sql<{ account_id: string; provider: string; status: string; failure_code: string | null; expires_at: Date | null; connected_at: Date; refreshed_at: Date | null }[]>`
      SELECT account_id, provider, status, failure_code, expires_at, connected_at, refreshed_at FROM provider_sessions ORDER BY account_id`;
    return rows.map(r => ({ account_id: r.account_id, provider: r.provider, status: r.status === 'connected' ? 'connected' : 'reconnect_required', failure_code: r.failure_code,
      expires_at: r.expires_at?.toISOString() ?? null, connected_at: r.connected_at.toISOString(), refreshed_at: r.refreshed_at?.toISOString() ?? null }));
  });
}

export async function saveGrant(accountId: string, provider: string, granted: Grant) {
  const sealed = seal(grantSchema.parse(granted), purpose(accountId));
  return using(async sql => {
    await ensure(sql);
    const [account] = await sql`SELECT provider FROM accounts WHERE id=${accountId}`;
    if (!account) throw new Error('unknown_account');
    if (account.provider !== provider) throw new Error('provider_mismatch');
    await sql`INSERT INTO provider_sessions(account_id, provider, sealed, expires_at, status, failure_code, refreshed_at)
      VALUES(${accountId}, ${provider}, ${sealed}, ${granted.expires_at ? new Date(granted.expires_at) : null}, 'connected', NULL, NULL)
      ON CONFLICT(account_id) DO UPDATE SET sealed=EXCLUDED.sealed, expires_at=EXCLUDED.expires_at, status='connected', failure_code=NULL, connected_at=now(), refreshed_at=NULL, updated_at=now()`;
  });
}

export async function deleteSession(accountId: string) {
  return using(async sql => { await ensure(sql); await sql`DELETE FROM provider_sessions WHERE account_id=${accountId}`; });
}

/**
 * Load the account's grant, refreshing it first when it is expired or about to expire.
 * A rejected refresh marks the session as needing a new sign-in and surfaces `usage_auth_required`; nothing is deleted.
 */
export async function freshGrant(accountId: string, now = Date.now()): Promise<{ provider: string; grant: Grant }> {
  return using(async sql => {
    await ensure(sql);
    const [row] = await sql<{ provider: string; sealed: string; status: string }[]>`SELECT provider, sealed, status FROM provider_sessions WHERE account_id=${accountId}`;
    if (!row) throw new Error('session_missing');
    const observer = observerFor(row.provider); if (!observer) throw new Error('provider_unsupported');
    const current = grantSchema.parse(open(row.sealed, purpose(accountId)));
    if (current.expires_at === null || current.expires_at > now + refreshMarginMs) return { provider: row.provider, grant: current };
    try {
      const rotated = await observer.refresh(current, { now: () => now });
      await sql`UPDATE provider_sessions SET sealed=${seal(rotated, purpose(accountId))}, expires_at=${rotated.expires_at ? new Date(rotated.expires_at) : null}, status='connected', failure_code=NULL, refreshed_at=now(), updated_at=now() WHERE account_id=${accountId}`;
      return { provider: row.provider, grant: rotated };
    } catch (error) {
      const code = diagnosticCode(error);
      const terminal = code === 'enrollment_rejected' || code === 'usage_auth_required';
      if (terminal) await sql`UPDATE provider_sessions SET status='reconnect_required', failure_code=${code}, updated_at=now() WHERE account_id=${accountId}`;
      throw new Error(terminal ? 'usage_auth_required' : code);
    }
  });
}

/** Credential files for a worker: access material only, never the refresh token. */
export async function credentialFiles(accountId: string, platform: Platform) {
  const { provider, grant: current } = await freshGrant(accountId);
  const observer = observerFor(provider)!;
  return { provider, expires_at: current.expires_at ? new Date(current.expires_at).toISOString() : null, files: observer.credentialFiles(current, platform) };
}
