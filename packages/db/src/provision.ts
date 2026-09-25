import { eq } from 'drizzle-orm';
import { accountId, provider } from '@llm-usage/core';
import { accounts } from './schema';
import { connect } from './index';

const [rawId, rawProvider, label, rawCapabilities, rawModelClasses] = process.argv.slice(2);
const usage = 'Usage: pnpm --filter @llm-usage/db provision <account-id> <provider> <label> <capabilities-comma-list> <model-classes-comma-list>';
if (!rawId || !rawProvider || !label || !rawCapabilities || !rawModelClasses) throw new Error(usage);
const id = accountId.parse(rawId);
const providerName = provider.parse(rawProvider);
if (label.length > 120 || /[\r\n]/.test(label)) throw new Error('Invalid account label');
function parseList(value: string): string[] {
  const items = value.split(',').map(item => item.trim());
  if (!items.length || items.some(item => !/^[a-z][a-z0-9_-]{0,79}$/.test(item)) || new Set(items).size !== items.length)
    throw new Error('Invalid or duplicate capability/model class');
  return items;
}
const capabilities = parseList(rawCapabilities);
const modelClasses = parseList(rawModelClasses);

const { db, client } = connect();
try {
  const [inserted] = await db.insert(accounts).values({ id, provider: providerName, label, capabilities, modelClasses })
    .onConflictDoNothing().returning({ id: accounts.id });
  if (inserted) console.log(`Provisioned ${id}`);
  else {
    const [existing] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!existing || existing.provider !== providerName || existing.label !== label ||
      JSON.stringify(existing.capabilities) !== JSON.stringify(capabilities) ||
      JSON.stringify(existing.modelClasses) !== JSON.stringify(modelClasses))
      throw new Error(`Account ${id} already exists with different settings`);
    console.log(`Account ${id} already exists`);
  }
} finally { await client.end(); }
