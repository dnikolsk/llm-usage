import { z } from 'zod';
import type { AccountState } from './index';

export const executionProvider = z.enum(['anthropic', 'openai', 'cursor']);
export const executionMode = z.enum(['local', 'cloud']);
export const identifier = z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/);
export const taskSpec = z.object({
  repository: identifier,
  provider: executionProvider.optional(),
  account_id: identifier.optional(),
  execution: z.enum(['auto', 'local', 'cloud']).default('auto'),
  scope: z.enum(['personal', 'work']).default('personal'),
  model_class: identifier.optional(),
  estimated_minutes: z.number().int().min(1).max(1440).default(30),
  continue_job_id: z.uuid().optional(),
}).strict();
export const jobRequest = taskSpec.extend({ prompt: z.string().trim().min(1).max(32_000) });
export type TaskSpec = z.infer<typeof taskSpec>;
export type JobRequest = z.infer<typeof jobRequest>;
export const targetRegistration = z.object({
  id: identifier, account_id: identifier, worker_id: identifier, mode: executionMode,
  repositories: z.array(identifier).min(1).max(100),
  model_classes: z.array(identifier).max(30).default([]),
  models:z.record(identifier,z.string().min(1).max(160)).optional(),
  default_model:z.string().min(1).max(160).optional(),
  setup_minutes: z.number().int().min(0).max(1440).default(0),
  billing: z.enum(['subscription', 'paid', 'unknown']).default('unknown'),
}).strict();
export type TargetRegistration = z.infer<typeof targetRegistration>;
export const targetHealth = z.object({
  target_id: identifier,
  health: z.enum(['ready', 'needs_login', 'unavailable']),
  cooldown_until: z.iso.datetime().nullable().default(null),
}).strict();
export type ExecutionTarget = TargetRegistration & {
  health: 'ready' | 'needs_login' | 'unavailable'; observed_at: string | null;
  cooldown_until: string | null; busy: boolean;
};
export type ExecutionAccount = AccountState & { account_type: string };
export type Continuation = { target_id: string; account_id: string; repository: string; resumable: boolean; model?:string|null };
export type DecisionCandidate = {
  target_id: string; account_id: string; provider: string; execution: 'local' | 'cloud';
  model:string|null; quota_scope:string|null;
  exclusions: string[]; warnings: string[]; continuation: boolean; setup_minutes: number;
  usage: 'measured' | 'estimated' | 'unknown'; remaining_fraction: number | null;
  usable_fraction: number | null; reset_at: string | null; seconds_until_reset: number | null;
  reset_pressure: number | null;
  buckets: { id:string; scope:string; observed_at:string; source:string; confidence:string; kind: string; remaining_fraction: number | null; reset_at: string | null;
    seconds_until_reset: number | null; usable_fraction: number | null; usable_per_hour: number | null }[];
};

/** Pure, deterministic stages. Never equate stale or passed-reset quota with replenishment. */
export function decideExecution(accounts: ExecutionAccount[], targets: ExecutionTarget[], request: TaskSpec,
  options: { now?: Date; reserves?: Record<string, number>; continuation?: Continuation } = {}) {
  const now = options.now ?? new Date();
  const reserves = options.reserves ?? { session: .1, weekly: .15 };
  const candidates: DecisionCandidate[] = targets.map(target => {
    const account = accounts.find(a => a.id === target.account_id);
    const exclusions: string[] = [], warnings: string[] = [];
    const previous=options.continuation?.target_id===target.id?options.continuation:undefined;
    const model=request.model_class?target.models?.[request.model_class]??null:
      previous?.model??target.default_model??(account?.provider==='cursor'?'auto':null);
    const quotaScope=account?.provider==='cursor'?(model==='auto'?'cursor_auto':model?'cursor_api':null):
      account?.provider==='anthropic'?(model?.toLowerCase().includes('sonnet')?'sonnet':model?.toLowerCase().includes('opus')?'opus':null):null;
    if(request.model_class&&!model)exclusions.push('model_binding_missing');
    if(target.mode==='cloud'&&model)exclusions.push('cloud_model_binding_unsupported');
    if(previous?.resumable&&account?.provider==='cursor'&&(!previous.model||previous.model!==model))exclusions.push('continuation_model_handoff_required');
    if (!account?.enabled) exclusions.push('account_disabled_or_missing');
    if (account && account.account_type !== request.scope) exclusions.push('account_scope_mismatch');
    if (request.provider && account?.provider !== request.provider) exclusions.push('provider_override');
    if (request.account_id && target.account_id !== request.account_id) exclusions.push('account_override');
    if (request.execution !== 'auto' && target.mode !== request.execution) exclusions.push('execution_override');
    if (!target.repositories.includes(request.repository)) exclusions.push('repository_not_configured');
    if (account && !account.capabilities.includes('coding')) exclusions.push('coding_unsupported');
    if (request.model_class && !target.model_classes.includes(request.model_class)) exclusions.push('model_unsupported');
    if (target.health !== 'ready') exclusions.push(target.health);
    const age = target.observed_at ? now.getTime() - Date.parse(target.observed_at) : Infinity;
    if (!Number.isFinite(age) || age < -60_000 || age > 120_000) exclusions.push('worker_offline');
    if (target.cooldown_until && Date.parse(target.cooldown_until) > now.getTime()) exclusions.push('cooldown');
    if (target.busy) exclusions.push('account_busy');
    if (target.billing !== 'subscription') exclusions.push(target.billing === 'paid' ? 'spending_approval_required' : 'billing_unverified');
    let usage: DecisionCandidate['usage'] = 'unknown';
    if(account?.status==='error')warnings.push('usage_collection_failed');
    if(account?.usage_diagnostic)warnings.push(account.usage_diagnostic);
    const limits = account?.limits.filter(b => b.scope === 'all_models' || b.scope===quotaScope ||
      (request.model_class ? b.scope === request.model_class : false) ||
      (account.provider==='anthropic'&&!quotaScope&&['sonnet','opus'].includes(b.scope))) ?? [];
    // A combined Cursor percentage cannot prove a specific pool has capacity.
    const missingPool=account?.provider==='cursor'&&!limits.some(b=>b.scope===quotaScope);
    if(missingPool){warnings.push('model_pool_capacity_unknown');exclusions.push('model_pool_capacity_unknown');}
    for(const b of limits)if(b.metadata.diagnostic_code)warnings.push(b.metadata.diagnostic_code);
    const buckets = limits.map(b => {
      const seconds = b.reset_at ? Math.floor((Date.parse(b.reset_at) - now.getTime()) / 1000) : null;
      const age = now.getTime() - Date.parse(b.observed_at);
      const valid = account?.status !== 'error' && Number.isFinite(age) && age >= -60_000 && age <= 600_000 && (seconds === null || seconds > 0);
      // A known exhaustion before its reported reset is retained even when telemetry becomes stale.
      if (b.remaining_fraction !== null && b.remaining_fraction <= 0 && (seconds === null || seconds > 0)) exclusions.push(`exhausted:${b.kind}`);
      const remaining = valid ? b.remaining_fraction : null;
      const reserve = reserves[b.kind] ?? 0;
      const usable = remaining === null ? null : Math.max(0, remaining - reserve);
      if (remaining !== null && remaining <= reserve) exclusions.push(`reserve:${b.kind}`);
      if (!valid) warnings.push(seconds !== null && seconds <= 0 ? 'reset_passed_recheck_on_use' : 'stale_usage');
      return { id:b.id,scope:b.scope,observed_at:b.observed_at,source:b.source,confidence:b.confidence,kind: b.kind, remaining_fraction: remaining, reset_at: b.reset_at,
        seconds_until_reset: seconds === null ? null : Math.max(0, seconds), usable_fraction: usable,
        usable_per_hour: usable !== null && seconds !== null && seconds > 0 ? usable / Math.max(seconds / 3600, .25) : null };
    });
    const allKnown = buckets.length > 0 && buckets.every(b => b.remaining_fraction !== null);
    if (allKnown) usage = limits.some(b => b.confidence === 'estimated' || b.confidence === 'unknown') ? 'estimated' : 'measured';
    else warnings.push('unknown_capacity');
    const usable = allKnown ? Math.min(...buckets.map(b => b.usable_fraction!)) : null;
    const pressure = allKnown && buckets.every(b => b.usable_per_hour !== null) ? Math.min(...buckets.map(b => b.usable_per_hour!)) : null;
    const next = buckets.filter(b => (b.seconds_until_reset ?? 0) > 0).sort((a,b) => a.seconds_until_reset! - b.seconds_until_reset!)[0];
    if (next && next.seconds_until_reset! < request.estimated_minutes * 60) warnings.push('reset_during_estimated_task');
    const continuation = options.continuation;
    return { model,quota_scope:quotaScope,target_id: target.id, account_id: target.account_id, provider: account?.provider ?? 'unknown', execution: target.mode,
      exclusions: [...new Set(exclusions)], warnings: [...new Set(warnings)], setup_minutes: target.setup_minutes,
      continuation: !!continuation?.resumable && continuation.repository === request.repository && continuation.target_id === target.id && continuation.account_id === target.account_id,
      usage, remaining_fraction: allKnown ? Math.min(...buckets.map(b => b.remaining_fraction!)) : null,
      usable_fraction: usable, reset_at: next?.reset_at ?? null, seconds_until_reset: next?.seconds_until_reset ?? null,
      reset_pressure: pressure, buckets };
  });
  const steps: { step: string; explanation: string; remaining: string[] }[] = [];
  let pool = candidates.filter(c => c.exclusions.length === 0);
  const record = (step: string, explanation: string) => steps.push({ step, explanation, remaining: pool.map(c => c.target_id) });
  const prefer = (step: string, explanation: string, predicate: (c: DecisionCandidate) => boolean) => {
    const matching = pool.filter(predicate); if (matching.length) pool = matching; record(step, explanation);
  };
  record('eligibility', 'Honor account/provider/location overrides, scope, repository/model support, live login, account lease, cooldown, billing and quota reserves.');
  record('model_pool', 'Pin the concrete model before comparing its applicable quota pools. Cursor defaults to Auto; missing pool evidence cannot be replaced by an aggregate percentage.');
  prefer('continuity', 'Continue verified work on its existing account and execution target when eligible.', c => c.continuation);
  prefer('readiness', 'Prefer environments already set up for this repository; local is not inherently better than cloud.', c => c.setup_minutes === 0);
  prefer('usage_evidence', 'Prefer fresh measured quota, then estimates; unknown quota stays explicit and may be tried when no better evidence exists.', c => c.usage === 'measured');
  if (!pool.some(c => c.usage === 'measured')) prefer('estimated_usage', 'Use fresh estimates before unknown quota.', c => c.usage === 'estimated');
  const bestCapacity = Math.max(...pool.map(c => c.usable_fraction ?? -1));
  prefer('capacity', 'Keep accounts within five percentage points of the highest usable bottleneck capacity after reserves.', c => (c.usable_fraction ?? -1) >= bestCapacity - .05 - 1e-9);
  const bestPressure = Math.max(...pool.map(c => c.reset_pressure ?? -1));
  prefer('reset_opportunity', 'Among similarly provisioned accounts, favor capacity that must be used sooner: minimum usable fraction per hour until reset across all applicable limits. A short session reset cannot hide a weekly bottleneck.', c => (c.reset_pressure ?? -1) === bestPressure);
  pool.sort((a,b) => a.setup_minutes - b.setup_minutes || a.target_id.localeCompare(b.target_id));
  record('setup_cost', 'Choose the lowest remaining setup time; stable target ID breaks exact ties.');
  const selected: DecisionCandidate | null = pool.length ? pool[0] : null;
  return { generated_at: now.toISOString(), selected, steps, candidates,
    outcome: selected ? 'ready' as const : 'waiting' as const,
    spending_approval_required: !selected && candidates.some(c => c.exclusions.includes('spending_approval_required')) };
}
