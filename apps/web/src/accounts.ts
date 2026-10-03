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
