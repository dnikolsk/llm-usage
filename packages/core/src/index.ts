import { z } from 'zod';

export const utcTimestamp = z.iso.datetime({ offset: false });
export const provider = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/);
export const accountId = z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/);
export const fraction = z.number().finite().min(0).max(1);
export const safeMetadata = z.object({
  demo:z.boolean().optional(), adapter_version:z.string().regex(/^[a-zA-Z0-9._-]{1,32}$/).optional(),
  diagnostic_code:z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/).optional(),
  display_label:z.string().regex(/^[a-zA-Z0-9 ._/-]{1,80}$/).optional()
}).strict();

export const usageBucket = z.object({
  id: z.string().min(1).max(120),
  account_id: accountId,
  kind: z.string().min(1).max(40),
  scope: z.string().min(1).max(80),
  unit: z.string().min(1).max(32),
  window_seconds: z.number().int().positive().nullable().default(null),
  used: z.number().finite().nonnegative().nullable().default(null),
  limit: z.number().finite().positive().nullable().default(null),
  remaining: z.number().finite().nonnegative().nullable().default(null),
  used_fraction: fraction.nullable().default(null),
  remaining_fraction: fraction.nullable().default(null),
  window_started_at: utcTimestamp.nullable().default(null),
  reset_at: utcTimestamp.nullable().default(null),
  observed_at: utcTimestamp,
  source: z.enum(['provider_ui','official_api','local_collector','manual','estimated']),
  confidence: z.enum(['exact','provider_reported','estimated','unknown']),
  metadata: safeMetadata.default({})
}).strict().superRefine((bucket, ctx) => {
  if (bucket.used_fraction !== null && bucket.remaining_fraction !== null && Math.abs(bucket.used_fraction + bucket.remaining_fraction - 1) > 0.02)
    ctx.addIssue({ code: 'custom', message: 'Fractions must sum to 1' });
  if (bucket.limit !== null && bucket.used !== null && bucket.used > bucket.limit)
    ctx.addIssue({ code: 'custom', message: 'Used exceeds limit' });
  if (bucket.window_started_at && bucket.reset_at && bucket.window_started_at >= bucket.reset_at)
    ctx.addIssue({ code: 'custom', message: 'Reset must follow start' });
});
export type UsageBucket = z.infer<typeof usageBucket>;

export const ingestSnapshot = z.object({
  account_id: accountId,
  provider,
  observed_at: utcTimestamp,
  status: z.enum(['ok','partial','error']),
  limits: z.array(usageBucket).max(40),
  metadata: safeMetadata.default({})
}).strict().superRefine((s, ctx) => {
  if (s.status === 'error' && s.limits.length) ctx.addIssue({ code:'custom', message:'Error observations cannot contain limits' });
  if (new Set(s.limits.map(l => l.id)).size !== s.limits.length) ctx.addIssue({code:'custom',message:'Duplicate bucket IDs'});
  for (const l of s.limits) {
    if (l.account_id !== s.account_id || l.observed_at !== s.observed_at) ctx.addIssue({ code:'custom', message:'Bucket account and observation must match snapshot' });
  }
});
export type IngestSnapshot = z.infer<typeof ingestSnapshot>;

export type AccountState = {
  id: string; provider: string; label: string; plan: string | null; enabled: boolean;
  capabilities: string[]; model_classes: string[]; priority: number;
  status: 'available' | 'partial' | 'error' | 'unknown';
  freshness: 'fresh' | 'stale' | 'seriously_stale' | 'unknown';
  observed_at: string | null; latest_refresh_at: string | null;
  limits: UsageBucket[];
};

export function freshness(observedAt: string | null, now = new Date()): AccountState['freshness'] {
  if (!observedAt) return 'unknown';
  const age = now.getTime() - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < -60_000) return 'unknown';
  return age <= 600_000 ? 'fresh' : age <= 3_600_000 ? 'stale' : 'seriously_stale';
}

export type RoutePolicy = { reserves: Record<string, number>; preference?: string[] };
export const defaultPolicy: RoutePolicy = { reserves: { session: 0.10, weekly: 0.15 } };
export type Candidate = {
  account_id: string; provider: string; eligible: boolean; exclusions: string[];
  bottleneck_remaining: number | null; usable_capacity: number | null;
  next_reset_at: string | null; freshness_seconds: number | null;
  reset_soon: boolean; priority: number;
};

export function route(accounts: AccountState[], options: { capability?: string; model_class?: string; now?: Date; policy?: RoutePolicy } = {}) {
  const now = options.now ?? new Date();
  const policy = options.policy ?? defaultPolicy;
  const candidates: Candidate[] = accounts.map(a => {
    const exclusions: string[] = [];
    if (!a.enabled) exclusions.push('disabled');
    if (options.capability && !a.capabilities.includes(options.capability)) exclusions.push('capability_unsupported');
    if (options.model_class && !a.model_classes.includes(options.model_class)) exclusions.push('model_class_unsupported');
    if (a.status !== 'available' && a.status !== 'partial') exclusions.push('unhealthy');
    if (a.freshness !== 'fresh') exclusions.push(a.freshness === 'unknown' ? 'unknown_freshness' : 'stale');
    const applicable = a.limits.filter(b => b.scope === 'all_models' || !options.model_class || b.scope === options.model_class);
    if (!applicable.length) exclusions.push('no_applicable_limits');
    let bottleneck = 1, usable = 1;
    for (const b of applicable) {
      if (b.reset_at && Date.parse(b.reset_at) <= now.getTime()) exclusions.push('reset_passed');
      if (b.remaining_fraction === null) { exclusions.push('unknown_capacity'); continue; }
      bottleneck = Math.min(bottleneck, b.remaining_fraction);
      const reserve = policy.reserves[b.kind] ?? 0;
      if (b.remaining_fraction <= 0) exclusions.push('exhausted');
      if (b.remaining_fraction <= reserve) exclusions.push(`reserve:${b.kind}`);
      usable = Math.min(usable, Math.max(0, b.remaining_fraction - reserve));
    }
    const resets = applicable.map(b => b.reset_at).filter((s): s is string => !!s).sort();
    const next = resets[0] ?? null;
    return { account_id:a.id, provider:a.provider, eligible:exclusions.length === 0, exclusions:[...new Set(exclusions)],
      bottleneck_remaining:applicable.length ? bottleneck : null, usable_capacity:applicable.length ? usable : null,
      next_reset_at:next, freshness_seconds:a.observed_at ? Math.max(0, Math.floor((now.getTime()-Date.parse(a.observed_at))/1000)) : null,
      reset_soon:!!next && Date.parse(next)-now.getTime() <= 7_200_000 && Date.parse(next)>now.getTime(), priority:a.priority };
  });
  const eligible = candidates.filter(c => c.eligible).sort((a,b) => {
    const delta = (b.usable_capacity ?? 0) - (a.usable_capacity ?? 0);
    if (Math.abs(delta) > 0.05) return delta;
    if (a.reset_soon !== b.reset_soon) return a.reset_soon ? -1 : 1;
    if (a.reset_soon && b.reset_soon && a.next_reset_at !== b.next_reset_at) return a.next_reset_at! < b.next_reset_at! ? -1 : 1;
    const pa = policy.preference?.indexOf(a.account_id) ?? -1, pb = policy.preference?.indexOf(b.account_id) ?? -1;
    if (pa !== pb && pa >= 0 && pb >= 0) return pa-pb;
    if (a.priority !== b.priority) return b.priority-a.priority;
    return delta || a.account_id.localeCompare(b.account_id);
  });
  const winner = eligible[0];
  return { generated_at:now.toISOString(), recommended:winner ? {account_id:winner.account_id,provider:winner.provider} : null,
    reason:winner ? { bottleneck_remaining:winner.bottleneck_remaining, usable_capacity:winner.usable_capacity,
      next_reset_at:winner.next_reset_at, freshness_seconds:winner.freshness_seconds, reset_soon:winner.reset_soon,
      policy_reserves:policy.reserves } : null,
    alternatives:eligible.slice(1).map(({account_id,provider})=>({account_id,provider})), candidates };
}

export { taskRouteRequest, recommendTask, ADVANCED_DIFFICULTY, LOW_CONFIDENCE_WARNING, MIN_CLOUD_CONFIDENCE } from './task-routing';
export type { TaskRouteRequest, TaskJudgment, TaskCandidate, TaskAccountCandidate } from './task-routing';
