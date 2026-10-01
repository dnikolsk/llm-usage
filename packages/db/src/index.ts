import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
export * from './schema';
export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url,{max:3,prepare:false});
  return { db:drizzle(client), client };
}

/** Raw SQL callers need PostgreSQL's normal JSON codecs; Drizzle customizes its client's codecs. */
export function connectSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return postgres(url, {max:3,prepare:false});
}
