import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { connect, accounts, usageSnapshots, usageBuckets, routingPolicies } from '@llm-usage/db';
import { freshness, type AccountState, type IngestSnapshot, type UsageBucket, defaultPolicy, safeMetadata, type RoutePolicy } from '@llm-usage/core';

export async function ingest(snapshot:IngestSnapshot,key:string):Promise<'created'|'duplicate'|'conflict'|'unknown_account'> {
  const {db,client}=connect();
  try {
    const [account]=await db.select().from(accounts).where(eq(accounts.id,snapshot.account_id)).limit(1);
    if (!account || account.provider !== snapshot.provider) return 'unknown_account';
    const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    return await db.transaction(async tx=>{
      const [inserted]=await tx.insert(usageSnapshots).values({ accountId:snapshot.account_id,idempotencyKey:key,payloadHash:hash,
        observedAt:new Date(snapshot.observed_at), status:snapshot.status,metadata:snapshot.metadata }).onConflictDoNothing().returning({id:usageSnapshots.id});
      if (!inserted) {
        const [existing]=await tx.select({payloadHash:usageSnapshots.payloadHash}).from(usageSnapshots).where(eq(usageSnapshots.idempotencyKey,key));
        return existing?.payloadHash === hash ? 'duplicate':'conflict';
      }
      if (snapshot.limits.length) await tx.insert(usageBuckets).values(snapshot.limits.map(b=>({snapshotId:inserted.id,providerBucketId:b.id,
        kind:b.kind,scope:b.scope,unit:b.unit,windowSeconds:b.window_seconds,used:b.used,limit:b.limit,remaining:b.remaining,
        usedFraction:b.used_fraction,remainingFraction:b.remaining_fraction,windowStartedAt:b.window_started_at ? new Date(b.window_started_at):null,
        resetAt:b.reset_at ? new Date(b.reset_at):null,source:b.source,confidence:b.confidence,metadata:b.metadata})));
      return 'created';
    });
  } finally { await client.end(); }
}

export async function getStatus(now=new Date()) {
  const {db,client}=connect();
  try {
    const all=await db.select().from(accounts).orderBy(accounts.provider,accounts.label);
    const latest=await db.selectDistinctOn([usageSnapshots.accountId]).from(usageSnapshots)
      .orderBy(usageSnapshots.accountId,desc(usageSnapshots.observedAt),desc(usageSnapshots.ingestedAt));
    const successful=await db.selectDistinctOn([usageSnapshots.accountId]).from(usageSnapshots)
      .where(inArray(usageSnapshots.status,['ok','partial']))
      .orderBy(usageSnapshots.accountId,desc(usageSnapshots.observedAt),desc(usageSnapshots.ingestedAt));
    const buckets=successful.length ? await db.select().from(usageBuckets).where(inArray(usageBuckets.snapshotId,successful.map(s=>s.id))) : [];
    const newest=new Map(latest.map(s=>[s.accountId,s]));
    const success=new Map(successful.map(s=>[s.accountId,s]));
    const states:AccountState[]=all.map(a=>{
      const s=success.get(a.id), n=newest.get(a.id), observed=s?.observedAt.toISOString() ?? null;
      const limits:UsageBucket[]=s ? buckets.filter(b=>b.snapshotId===s.id).map(b=>({id:b.providerBucketId,account_id:a.id,kind:b.kind,scope:b.scope,unit:b.unit,window_seconds:b.windowSeconds,
        used:b.used,limit:b.limit,remaining:b.remaining,used_fraction:b.usedFraction,remaining_fraction:b.remainingFraction,
        window_started_at:b.windowStartedAt?.toISOString() ?? null,reset_at:b.resetAt?.toISOString() ?? null,
        observed_at:observed!,source:b.source as UsageBucket['source'],confidence:b.confidence as UsageBucket['confidence'],metadata:b.metadata as UsageBucket['metadata']})) : [];
      const paid=safeMetadata.safeParse(s?.metadata??{});
      return {id:a.id,provider:a.provider,label:a.label,plan:a.plan,enabled:a.enabled,capabilities:a.capabilities,
        model_classes:a.modelClasses,priority:a.priority,status:n?.status === 'error' ? 'error' : n?.status === 'partial' ? 'partial' : s ? 'available':'unknown',
        freshness:freshness(observed,now), observed_at:observed, latest_refresh_at:n?.observedAt.toISOString() ?? null,usage_diagnostic:(n?.metadata as {diagnostic_code?:string}|undefined)?.diagnostic_code??null,paid_usage:paid.success?paid.data.paid_usage??[]:[],paid_usage_diagnostic:paid.success?paid.data.paid_usage_diagnostic??null:null,limits};
    });
    return {generated_at:now.toISOString(),accounts:states};
  } finally { await client.end(); }
}

/** Newest observation per account (any status), used to decide whether a live read is due. */
export async function latestObservations() {
  const {db,client}=connect();
  try {
    const latest=await db.selectDistinctOn([usageSnapshots.accountId]).from(usageSnapshots)
      .orderBy(usageSnapshots.accountId,desc(usageSnapshots.observedAt),desc(usageSnapshots.ingestedAt));
    return new Map(latest.map(s=>[s.accountId,{observedAt:s.observedAt,status:s.status}]));
  } finally { await client.end(); }
}

export async function getPolicy():Promise<RoutePolicy> {
  const {db,client}=connect();
  try {
    const [row]=await db.select().from(routingPolicies).where(and(eq(routingPolicies.ownerId,'personal'),eq(routingPolicies.isDefault,true))).limit(1);
    const reserves=row?.configuration?.reserves;
    if (!reserves || typeof reserves !== 'object' || Array.isArray(reserves)) return defaultPolicy;
    const valid=Object.fromEntries(Object.entries(reserves).filter(([k,v])=>k.length<=40 && typeof v==='number' && v>=0 && v<1));
    return {reserves:{...defaultPolicy.reserves,...valid}};
  } finally { await client.end(); }
}
