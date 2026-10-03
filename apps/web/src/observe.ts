import { createHash } from 'node:crypto';
import { observerFor, diagnosticCode } from '@llm-usage/providers';
import { ingestSnapshot, type IngestSnapshot } from '@llm-usage/core';
import { getStatus, ingest, latestObservations } from './store';
import { freshGrant, listSessions } from './sessions';

/** Reads within this window share one provider call, so bursts of dashboard/MCP reads never trip provider rate limits. */
export const liveWindowMs = 20_000;

export type ObserveResult = { account_id: string; outcome: 'observed' | 'cached' | 'failed' | 'no_session'; diagnostic: string | null };

async function record(snapshot: IngestSnapshot) {
  await ingest(ingestSnapshot.parse(snapshot), createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'));
}

/** Observe one account now: refresh the grant if needed, call the provider, append the snapshot. Failures are recorded as diagnostics, never as capacity. */
export async function observeAccount(accountId: string, provider: string, now = new Date()): Promise<ObserveResult> {
  const observer = observerFor(provider);
  if (!observer) return { account_id: accountId, outcome: 'failed', diagnostic: 'provider_unsupported' };
  try {
    const { grant } = await freshGrant(accountId, now.getTime());
    const reading = await observer.readUsage(grant, accountId, { now: () => now.getTime() });
    await record(reading.snapshot);
    return { account_id: accountId, outcome: 'observed', diagnostic: reading.snapshot.metadata.diagnostic_code ?? null };
  } catch (error) {
    const code = error instanceof Error && error.message === 'session_missing' ? 'usage_auth_required' : diagnosticCode(error);
    await record({ account_id: accountId, provider, observed_at: now.toISOString(), status: 'error', limits: [], metadata: { diagnostic_code: code } }).catch(() => {});
    return { account_id: accountId, outcome: 'failed', diagnostic: code };
  }
}

/** Observe every connected account whose last reading is older than the live window, in parallel. */
export async function observeAll(now = new Date()): Promise<ObserveResult[]> {
  const [sessions, latest] = await Promise.all([listSessions(), latestObservations()]);
  return Promise.all(sessions.map(async session => {
    const last = latest.get(session.account_id);
    // A failed reading is also held for the window, so a broken session is not hammered by every page render.
    if (last && now.getTime() - last.observedAt.getTime() < liveWindowMs) return { account_id: session.account_id, outcome: 'cached' as const, diagnostic: null };
    return observeAccount(session.account_id, session.provider, now);
  }));
}

/** The live view: provider readings taken now (or within the live window), then the normal status projection. */
export async function getLiveStatus(now = new Date()) {
  const observations = await observeAll(now);
  const status = await getStatus(now);
  return { ...status, live: true, observations };
}
