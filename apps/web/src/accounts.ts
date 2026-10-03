import { connectSql } from '@llm-usage/db';
export type AccountRow = { id: string; provider: string; label: string; account_type: string; enabled: boolean };
export async function listAccounts(): Promise<AccountRow[]> {
  const sql = connectSql();
  try { return await sql<AccountRow[]>`SELECT id, provider, label, account_type, enabled FROM accounts ORDER BY provider, id`; } finally { await sql.end(); }
}
export async function accountProvider(id: string): Promise<string | null> {
  const sql = connectSql();
  try { const [row] = await sql<{ provider: string }[]>`SELECT provider FROM accounts WHERE id=${id}`; return row?.provider ?? null; } finally { await sql.end(); }
}

/** Delete an account that was registered by mistake, together with its observations, only while nothing depends on it. */
export async function removeOrphanAccount(id: string): Promise<'removed' | 'account_in_use' | 'unknown_account'> {
  const sql = connectSql();
  try {
    return await sql.begin(async tx => {
      const [account] = await tx`SELECT id FROM accounts WHERE id=${id}`;
      if (!account) return 'unknown_account' as const;
      const [{ count }] = await tx<{ count: number }[]>`SELECT (SELECT count(*) FROM execution_targets WHERE account_id=${id})
        + (SELECT count(*) FROM execution_jobs WHERE account_id=${id})
        + (SELECT count(*) FROM provider_sessions WHERE account_id=${id}) AS count`;
      if (Number(count) > 0) return 'account_in_use' as const;
      await tx`DELETE FROM usage_buckets WHERE snapshot_id IN (SELECT id FROM usage_snapshots WHERE account_id=${id})`;
      await tx`DELETE FROM usage_snapshots WHERE account_id=${id}`;
      await tx`DELETE FROM accounts WHERE id=${id}`;
      return 'removed' as const;
    });
  } finally { await sql.end(); }
}
