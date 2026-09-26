import { describe, expect, it } from 'vitest';
import { recommendTask, taskRouteRequest, type AccountState, type TaskJudgment } from '../src/index';

const now = new Date('2026-09-25T12:00:00.000Z');
const judgment: TaskJudgment = { difficulty: 1, workSize: 1, interactive: 0.2, needsMac: 0.1,
  confidence: 0.9, model: 'jev-test' };

function account(id: string, provider: string, remaining: number, resetHours: number, startedHours: number): AccountState {
  const observed = '2026-09-25T11:58:00.000Z';
  const reset = new Date(now.getTime() + resetHours * 3_600_000).toISOString();
  const start = new Date(now.getTime() - startedHours * 3_600_000).toISOString();
  return { id, provider, label: id, plan: null, enabled: true, capabilities: ['coding'],
    model_classes: provider === 'cursor' ? ['cursor_models', 'other_models'] : ['high_reasoning'],
    priority: 0, status: 'available', freshness: 'fresh', observed_at: observed, latest_refresh_at: observed,
    limits: [{ id: 'session', account_id: id, kind: 'session',
      scope: provider === 'cursor' ? 'cursor_models' : 'all_models', unit: 'fraction',
      window_seconds: (resetHours + startedHours) * 3600, used: null, limit: null, remaining: null,
      used_fraction: 1 - remaining, remaining_fraction: remaining, window_started_at: start,
      reset_at: reset, observed_at: observed, source: 'provider_ui', confidence: 'provider_reported', metadata: {} }] };
}

describe('task-aware routing', () => {
  it('prefers an existing project when quality and capacity are adequate', () => {
    const current = account('claude', 'anthropic', 0.38, 2, 3);
    const other = account('codex', 'openai', 0.85, 1, 4);
    const result = recommendTask([current, other], { task: 'Continue the dashboard implementation',
      project: { stage: 'ongoing', current_account_id: 'claude', current_model: 'claude-sonnet' },
      capability: 'coding', repo_pushed: true }, judgment, { now });
    expect(result.recommended?.account_id).toBe('claude');
    expect(result.recommended?.model_id).toBe('claude-sonnet');
    expect(result.reason?.project_continuity).toBe(true);
  });

  it('uses allowance ahead of renewal pace for a short new task', () => {
    const ahead = account('claude', 'anthropic', 0.52, 1, 4);
    const behind = account('codex', 'openai', 0.70, 4, 1);
    const result = recommendTask([ahead, behind], { task: 'Update one dashboard label',
      project: { stage: 'new' }, estimated_work: 'quick', capability: 'coding' }, judgment, { now });
    expect(result.recommended?.account_id).toBe('claude');
    expect(result.candidates.find(c => c.account_id === 'claude')?.pace_surplus).toBeGreaterThan(0);
  });

  it('requires room for a large new project and favors capacity', () => {
    const soon = account('claude', 'anthropic', 0.26, 1, 4);
    const roomy = account('codex', 'openai', 0.80, 4, 1);
    const result = recommendTask([soon, roomy], { task: 'Build a new multi-screen application',
      project: { stage: 'new' }, estimated_work: 'large', capability: 'coding', repo_pushed: true,
      interaction_level: 'low', needs_mac: false }, judgment, { now });
    expect(result.recommended?.account_id).toBe('codex');
    expect(result.recommended?.execution).toBe('cloud');
    expect(result.handoff).toMatchObject({status:'not_started',provider:'openai',model_id:'gpt-6-sol'});
  });

  it('keeps demanding work on a capable model and local when Mac tools are needed', () => {
    const result = recommendTask([account('claude', 'anthropic', 0.8, 2, 3)],
      { task: 'Debug the iPhone signing and installed widget', estimated_work: 'medium',
        needs_mac: true, repo_pushed: true, capability: 'coding' },
      { ...judgment, difficulty: 2.5, workSize: 1 }, { now });
    expect(result.recommended?.model_id).toBe('claude-opus');
    expect(result.recommended?.execution).toBe('local');
    expect(result.candidates.find(c => c.model_id === 'claude-sonnet')?.exclusions).toContain('quality_below_task');
  });

  it('lets a quick continuation finish inside the normal reserve, but not an exhausted account', () => {
    const almostDone = account('claude', 'anthropic', 0.07, 1, 4);
    const result = recommendTask([almostDone], { task: 'Finish the last small test fix',
      project: { stage: 'ongoing', current_account_id: 'claude' },
      estimated_work: 'quick', capability: 'coding' }, judgment, { now });
    expect(result.recommended?.account_id).toBe('claude');
    almostDone.limits[0]!.remaining_fraction = 0;
    expect(recommendTask([almostDone], { task: 'Finish the last small test fix',
      project: { stage: 'ongoing', current_account_id: 'claude' },
      estimated_work: 'quick', capability: 'coding' }, judgment, { now }).recommended).toBeNull();
  });

  it('does not invent capacity from Cursor’s other model pool or stale data', () => {
    const cursor = account('cursor', 'cursor', 0.7, 2, 3);
    const result = recommendTask([cursor], { task: 'Make a small UI adjustment', capability: 'coding' }, judgment, { now });
    expect(result.candidates.find(c => c.model_id === 'cursor-other-models')?.exclusions).toContain('no_applicable_limits');
    cursor.freshness = 'stale';
    expect(recommendTask([cursor], { task: 'Make a small UI adjustment', capability: 'coding' }, judgment, { now }).recommended).toBeNull();
  });

  it('requires a bounded, structured task request', () => {
    expect(taskRouteRequest.safeParse({ task: 'Fix the login form', project: { stage: 'new' } }).success).toBe(true);
    expect(taskRouteRequest.safeParse({ task: 'too short', secret: 'unexpected' }).success).toBe(false);
  });
});
