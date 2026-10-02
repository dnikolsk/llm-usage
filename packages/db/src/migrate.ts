import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const client=postgres(url,{max:1});
try {
  const directory=fileURLToPath(new URL('../migrations/',import.meta.url));
  for (const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) {
    await client.begin(async tx=>{ await tx.unsafe(readFileSync(directory+name,'utf8')); });
  }
  console.log('Migration applied');
} finally { await client.end(); }
