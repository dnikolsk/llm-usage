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

describe('golden route matrix (G1–G9)', () => {
  // Mirrors production inventory: only Claude has room; Cursor and ChatGPT are exhausted.
  const inventory = () => {
    const claude = account('claude-personal', 'anthropic', 0.92, 2, 3);
    const cursor = { ...account('cursor-personal', 'cursor', 0, 2, 3), model_classes: ['general'] };
    cursor.limits[0]!.kind = 'monthly';
    const chatgpt = { ...account('chatgpt-personal', 'openai', 0, 2, 3), model_classes: ['work_codex'] };
    chatgpt.limits[0]!.kind = 'weekly';
    return [claude, cursor, chatgpt];
  };
  const quick: TaskJudgment = { difficulty: 0, workSize: 0.1, interactive: 0.1, needsMac: 0.1, confidence: 1, model: 'jev-test' };
  const big: TaskJudgment = { difficulty: 1.9, workSize: 1.9, interactive: 0.1, needsMac: 0.1, confidence: 0.9, model: 'jev-test' };
  const largeCloud = { task: 'Build a new multi-screen application with sync', project: { stage: 'new' as const },
    estimated_work: 'large' as const, interaction_level: 'low' as const, needs_mac: false, repo_pushed: true, capability: 'coding' };

  it('G1: a typo fix stays local as quick work, not as a failed cloud gate', () => {
    const result = recommendTask(inventory(), { task: 'Fix a typo in the README title', capability: 'coding' }, quick, { now });
    expect(result.recommended).toMatchObject({ account_id: 'claude-personal', model_id: 'claude-sonnet', execution: 'local' });
    expect(result.reason?.execution_reason).toBe('quick_local');
    expect(result.handoff).toBeNull();
  });

  it('G1b: medium work stays local as short_or_medium_work even without a pushed repo', () => {
    const result = recommendTask(inventory(), { task: 'Add a settings screen to the app', estimated_work: 'medium',
      capability: 'coding' }, quick, { now });
    expect(result.reason?.execution_reason).toBe('short_or_medium_work');
    const unpushed = recommendTask(inventory(), { ...largeCloud, repo_pushed: false }, big, { now });
    expect(unpushed.recommended?.execution).toBe('local');
    expect(unpushed.reason?.execution_reason).toBe('repository_not_ready_for_cloud');
  });

  it('G2: small Mac-bound interactive work stays local for Mac dependencies', () => {
    const result = recommendTask(inventory(), { task: 'Fix a typo in the README title', estimated_work: 'quick',
      interaction_level: 'high', needs_mac: true, capability: 'coding' }, quick, { now });
    expect(result.recommended?.execution).toBe('local');
    expect(result.reason?.execution_reason).toBe('mac_dependencies');
    const interactive = recommendTask(inventory(), { task: 'Pair on the onboarding copy with me', interaction_level: 'high',
      needs_mac: false, estimated_work: 'large', repo_pushed: true, capability: 'coding' }, big, { now });
    expect(interactive.reason?.execution_reason).toBe('interactive_work');
    expect(interactive.recommended?.execution).toBe('local');
  });

  it('G3: large unattended work goes to cloud only with Jev confidence of at least 0.5', () => {
    const confident = recommendTask(inventory(), largeCloud, big, { now });
    expect(confident.recommended).toMatchObject({ model_id: 'claude-opus', execution: 'cloud' });
    expect(confident.reason?.execution_reason).toBe('unattended_large_job');
    expect(confident.handoff).toMatchObject({ status: 'not_started', account_id: 'claude-personal', model_id: 'claude-opus' });
    const borderline = recommendTask(inventory(), largeCloud, { ...big, confidence: 0.55 }, { now });
    expect(borderline.recommended?.execution).toBe('cloud');
    expect(borderline.warnings).toContain('low_jev_confidence');
    const weak = recommendTask(inventory(), largeCloud, { ...big, confidence: 0.28 }, { now });
    expect(weak.recommended).toMatchObject({ model_id: 'claude-opus', execution: 'local' });
    expect(weak.handoff).toBeNull();
    expect(weak.reason?.execution_reason).toBe('low_jev_confidence');
    expect(weak.warnings).toContain('low_jev_confidence');
  });

  it('G4: large Mac-dependent work never goes to cloud and uses the same quality floor', () => {
    const result = recommendTask(inventory(), { ...largeCloud, needs_mac: true, interaction_level: 'high' }, big, { now });
    expect(result.recommended).toMatchObject({ model_id: 'claude-opus', execution: 'local' });
    expect(result.handoff).toBeNull();
    expect(result.reason?.execution_reason).toBe('mac_dependencies');
    expect(result.reason?.quality_floor).toBe('advanced');
    expect(result.candidates.find(c => c.model_id === 'claude-sonnet')?.exclusions).toContain('quality_below_task');
  });

  it('applies one difficulty threshold to large work on Mac and in cloud', () => {
    const moderate = { ...big, difficulty: 1.62 };
    const mac = recommendTask(inventory(), { ...largeCloud, needs_mac: true }, moderate, { now });
    const cloud = recommendTask(inventory(), largeCloud, moderate, { now });
    expect(mac.recommended?.model_id).toBe('claude-sonnet');
    expect(cloud.recommended?.model_id).toBe('claude-sonnet');
    expect(mac.reason?.quality_floor).toBe('general');
    for (const difficulty of [1.75, 1.9]) {
      expect(recommendTask(inventory(), { ...largeCloud, needs_mac: true }, { ...big, difficulty }, { now }).recommended?.model_id).toBe('claude-opus');
      expect(recommendTask(inventory(), largeCloud, { ...big, difficulty }, { now }).recommended?.model_id).toBe('claude-opus');
    }
  });

  it('G5: unknown continuity accounts and models are reported, not silently dropped', () => {
    const task = 'Continue implementing the iPhone widget';
    const unknownAccount = recommendTask(inventory(), { task, capability: 'coding',
      project: { stage: 'ongoing', current_account_id: 'openai-personal', current_model: 'gpt-5' } }, quick, { now });
    expect(unknownAccount.reason?.project_continuity).toBe(false);
    expect(unknownAccount.warnings).toContain('continuity_account_unknown');
    const unknownModel = recommendTask(inventory(), { task, capability: 'coding',
      project: { stage: 'ongoing', current_account_id: 'claude-personal', current_model: 'gpt-5' } }, quick, { now });
    expect(unknownModel.reason?.project_continuity).toBe(false);
    expect(unknownModel.warnings).toContain('continuity_model_unknown');
    const exhausted = recommendTask(inventory(), { task, capability: 'coding',
      project: { stage: 'ongoing', current_account_id: 'chatgpt-personal' } }, quick, { now });
    expect(exhausted.reason?.project_continuity).toBe(false);
    expect(exhausted.warnings).toContain('continuity_ineligible');
    const tooHard = recommendTask(inventory(), { task, capability: 'coding',
      project: { stage: 'ongoing', current_account_id: 'claude-personal', current_model: 'claude-sonnet' } }, big, { now });
    expect(tooHard.recommended?.model_id).toBe('claude-opus');
    expect(tooHard.warnings).toContain('continuity_ineligible');
  });

  it('G6: a real continuity id with capacity is preferred and raises no continuity warning', () => {
    const accounts = inventory();
    const roomy = account('chatgpt-personal', 'openai', 0.95, 2, 3);
    const claude = account('claude-personal', 'anthropic', 0.40, 2, 3);
    const result = recommendTask([claude, roomy, accounts[1]!], { task: 'Continue implementing the iPhone widget',
      capability: 'coding', project: { stage: 'ongoing', current_account_id: 'claude-personal', current_model: 'claude-sonnet' } },
      quick, { now });
    expect(result.recommended).toMatchObject({ account_id: 'claude-personal', model_id: 'claude-sonnet' });
    expect(result.reason?.project_continuity).toBe(true);
    expect(result.warnings.filter(w => w.startsWith('continuity_'))).toEqual([]);
  });

  it('G7: rejects short or empty tasks', () => {
    for (const task of ['', '   ', 'hi there']) expect(taskRouteRequest.safeParse({ task }).success).toBe(false);
  });

  it('G9: candidates explain why exhausted Cursor and ChatGPT accounts lost', () => {
    const result = recommendTask(inventory(), { task: 'Fix a typo in the README title', capability: 'coding' }, quick, { now });
    const cursor = result.candidates.find(c => c.account_id === 'cursor-personal');
    const chatgpt = result.candidates.find(c => c.account_id === 'chatgpt-personal');
    expect(cursor).toMatchObject({ eligible: false, model_id: null });
    expect(cursor?.exclusions).toEqual(expect.arrayContaining(['exhausted', 'reserve:monthly', 'model_class_unsupported']));
    expect(chatgpt).toMatchObject({ eligible: false, model_id: null });
    expect(chatgpt?.exclusions).toEqual(expect.arrayContaining(['exhausted', 'reserve:weekly']));
    const routable = recommendTask([inventory()[0]!, account('chatgpt-personal', 'openai', 0, 2, 3)],
      { task: 'Fix a typo in the README title', capability: 'coding' }, quick, { now });
    expect(routable.candidates.filter(c => c.account_id === 'chatgpt-personal').map(c => c.exclusions))
      .toEqual([expect.arrayContaining(['exhausted']), expect.arrayContaining(['exhausted'])]);
  });
});
