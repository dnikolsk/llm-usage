import { z } from 'zod';
import { route, type AccountState, type Candidate, type RoutePolicy, defaultPolicy } from './index';

export const taskRouteRequest = z.object({
  task: z.string().trim().min(12).max(4000),
  project: z.object({
    stage: z.enum(['new', 'ongoing']),
    current_account_id: z.string().max(80).optional(),
    current_model: z.string().max(80).optional()
  }).strict().optional(),
  estimated_work: z.enum(['quick', 'medium', 'large']).optional(),
  interaction_level: z.enum(['low', 'high']).optional(),
  needs_mac: z.boolean().optional(),
  repo_pushed: z.boolean().optional(),
  capability: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).default('coding')
}).strict();
export type TaskRouteRequest = z.infer<typeof taskRouteRequest>;

export type TaskJudgment = {
  difficulty: number;
  workSize: number;
  interactive: number;
  needsMac: number;
  model: string;
  confidence: number | null;
};

type ModelOption = { id: string; label: string; model_class: string; tier: 'general' | 'advanced' };
const models: Record<string, ModelOption[]> = {
  anthropic: [
    { id: 'claude-sonnet', label: 'Claude Sonnet', model_class: 'high_reasoning', tier: 'general' },
    { id: 'claude-opus', label: 'Claude Opus', model_class: 'high_reasoning', tier: 'advanced' }
  ],
  openai: [
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', model_class: 'high_reasoning', tier: 'general' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', model_class: 'high_reasoning', tier: 'advanced' }
  ],
  cursor: [
    { id: 'cursor-auto', label: 'Cursor Auto', model_class: 'cursor_models', tier: 'general' },
    { id: 'cursor-other-models', label: 'Cursor Other Models', model_class: 'other_models', tier: 'general' }
  ]
};

export type TaskCandidate = Candidate & {
  model_id: string;
  model_label: string;
  model_class: string;
  tier: 'general' | 'advanced';
  pace_surplus: number | null;
  estimated_need: number;
  continuation: boolean;
};
// Account-level row for accounts with no routable task model, so POST explains every non-winner like GET.
export type TaskAccountCandidate = Candidate & {
  model_id: null; model_label: null; model_class: null; tier: null;
  pace_surplus: null; estimated_need: number; continuation: boolean;
};

// Difficulty at or above this Jev score requires an advanced-tier model, regardless of local or cloud placement.
export const ADVANCED_DIFFICULTY = 1.75;
// Jev confidence below which a warning is added, and below which cloud placement is refused.
export const LOW_CONFIDENCE_WARNING = 0.6;
export const MIN_CLOUD_CONFIDENCE = 0.5;

function relevantBuckets(account: AccountState, modelClass: string) {
  return account.limits.filter(bucket => bucket.scope === 'all_models' || bucket.scope === modelClass);
}

function paceSurplus(account: AccountState, modelClass: string, now: Date): number | null {
  const values = relevantBuckets(account, modelClass).flatMap(bucket => {
    if (bucket.remaining_fraction === null || !bucket.reset_at) return [];
    const end = Date.parse(bucket.reset_at);
    const start = bucket.window_started_at ? Date.parse(bucket.window_started_at)
      : bucket.window_seconds ? end - bucket.window_seconds * 1000 : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    const timeLeft = Math.max(0, Math.min(1, (end - now.getTime()) / (end - start)));
    return [bucket.remaining_fraction - timeLeft];
  });
  return values.length ? Math.min(...values) : null;
}

function minimumCapacity(size: 'quick' | 'medium' | 'large') {
  return size === 'quick' ? 0.03 : size === 'medium' ? 0.10 : 0.25;
}

function sizeFromJudgment(score: number): 'quick' | 'medium' | 'large' {
  return score < 0.65 ? 'quick' : score < 1.45 ? 'medium' : 'large';
}

export function recommendTask(accounts: AccountState[], request: TaskRouteRequest, judgment: TaskJudgment,
  options: { now?: Date; policy?: RoutePolicy } = {}) {
  const now = options.now ?? new Date();
  const policy = options.policy ?? defaultPolicy;
  const size = request.estimated_work ?? sizeFromJudgment(judgment.workSize);
  const need = minimumCapacity(size);
  const advanced = judgment.difficulty >= ADVANCED_DIFFICULTY;
  const ongoing = request.project?.stage === 'ongoing' ? request.project : undefined;
  const current = ongoing?.current_account_id;
  const modelCandidates: TaskCandidate[] = accounts.flatMap(account => (models[account.provider] ?? [])
    .filter(model => account.model_classes.includes(model.model_class))
    .map(model => {
      const continuation = account.id === current && (!request.project?.current_model || request.project.current_model === model.id);
      const candidate = route([account], { capability: request.capability, model_class: model.model_class, now, policy }).candidates[0]!;
      let usable = candidate.usable_capacity ?? 0;
      const exclusions = [...candidate.exclusions];
      // A short continuation may consume the reserved tail when it can finish there.
      if (continuation && size === 'quick' && exclusions.length && exclusions.every(reason => reason.startsWith('reserve:'))) {
        const noReserve = route([account], { capability: request.capability, model_class: model.model_class, now,
          policy: { ...policy, reserves: {} } }).candidates[0]!;
        if (noReserve.eligible && (noReserve.usable_capacity ?? 0) >= need) {
          exclusions.length = 0;
          usable = noReserve.usable_capacity ?? 0;
        }
      }
      if (advanced && model.tier !== 'advanced') exclusions.push('quality_below_task');
      if (usable < need) exclusions.push('insufficient_for_estimated_work');
      return { ...candidate, eligible: exclusions.length === 0, exclusions: [...new Set(exclusions)],
        usable_capacity: usable, model_id: model.id, model_label: model.label, model_class: model.model_class,
        tier: model.tier, pace_surplus: paceSurplus(account, model.model_class, now),
        estimated_need: need, continuation };
    }));
  const accountCandidates: TaskAccountCandidate[] = accounts
    .filter(account => !modelCandidates.some(candidate => candidate.account_id === account.id))
    .map(account => {
      const candidate = route([account], { capability: request.capability, now, policy }).candidates[0]!;
      return { ...candidate, eligible: false, exclusions: [...new Set([...candidate.exclusions, 'model_class_unsupported'])],
        model_id: null, model_label: null, model_class: null, tier: null, pace_surplus: null,
        estimated_need: need, continuation: account.id === current };
    });
  const candidates: (TaskCandidate | TaskAccountCandidate)[] = [...modelCandidates, ...accountCandidates];

  const eligible = modelCandidates.filter(candidate => candidate.eligible).sort((a, b) => {
    if (a.continuation !== b.continuation) return a.continuation ? -1 : 1;
    if (!advanced && a.tier !== b.tier) return a.tier === 'general' ? -1 : 1;
    if (size === 'large') {
      const capacity = (b.usable_capacity ?? 0) - (a.usable_capacity ?? 0);
      if (Math.abs(capacity) > 0.15) return capacity;
    }
    const pace = (b.pace_surplus ?? -1) - (a.pace_surplus ?? -1);
    if (Math.abs(pace) > 0.03) return pace;
    const capacity = (b.usable_capacity ?? 0) - (a.usable_capacity ?? 0);
    if (Math.abs(capacity) > 0.03) return capacity;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return `${a.account_id}:${a.model_id}`.localeCompare(`${b.account_id}:${b.model_id}`);
  });
  const winner = eligible[0];
  const needsMac = request.needs_mac ?? judgment.needsMac >= 0.7;
  const interactive = request.interaction_level ? request.interaction_level === 'high' : judgment.interactive >= 0.7;
  const lowConfidence = (limit: number) => judgment.confidence !== null && judgment.confidence < limit;
  // The reason names the rule that decided placement; cloud-only gates are reported only when cloud was in play.
  const executionReason = needsMac ? 'mac_dependencies' : interactive ? 'interactive_work'
    : size === 'quick' ? 'quick_local' : size === 'medium' ? 'short_or_medium_work'
    : !request.repo_pushed ? 'repository_not_ready_for_cloud'
    : lowConfidence(MIN_CLOUD_CONFIDENCE) ? 'low_jev_confidence' : 'unattended_large_job';
  const execution = executionReason === 'unattended_large_job' ? 'cloud' : 'local';
  const continuityWarning = !ongoing || (!current && !ongoing.current_model) ? null
    : !current || !accounts.some(account => account.id === current) ? 'continuity_account_unknown'
    : ongoing.current_model && !modelCandidates.some(candidate => candidate.continuation) ? 'continuity_model_unknown'
    : !winner?.continuation ? 'continuity_ineligible' : null;
  const warnings = [
    ...(lowConfidence(LOW_CONFIDENCE_WARNING) ? ['low_jev_confidence'] : []),
    ...(continuityWarning ? [continuityWarning] : []),
    ...(winner && winner.pace_surplus === null ? ['renewal_pace_unknown'] : [])
  ];

  return {
    generated_at: now.toISOString(),
    decision_source: 'jev' as const,
    recommended: winner ? { account_id: winner.account_id, provider: winner.provider,
      model_id: winner.model_id, model_label: winner.model_label, model_class: winner.model_class,
      execution } : null,
    handoff: winner && execution === 'cloud' ? { status: 'not_started' as const, provider: winner.provider,
      account_id: winner.account_id, model_id: winner.model_id, task: request.task } : null,
    reason: winner ? { project_continuity: winner.continuation, estimated_work: size,
      estimated_need: need, difficulty: judgment.difficulty, usable_capacity: winner.usable_capacity,
      pace_surplus: winner.pace_surplus, quality_floor: advanced ? 'advanced' : 'general',
      execution_reason: executionReason,
      jev_model: judgment.model, jev_confidence: judgment.confidence } : null,
    alternatives: eligible.slice(1).map(candidate => ({ account_id: candidate.account_id,
      provider: candidate.provider, model_id: candidate.model_id, model_label: candidate.model_label })),
    candidates, warnings
  };
}
