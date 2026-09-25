import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const client=postgres(url,{max:1});
try {
  const sql=readFileSync(fileURLToPath(new URL('../migrations/0001_initial.sql',import.meta.url)),'utf8');
  await client.unsafe(sql);
  console.log('Migration applied');
} finally { await client.end(); }
