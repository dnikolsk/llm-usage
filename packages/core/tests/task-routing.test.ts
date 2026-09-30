import { describe, expect, it } from 'vitest';
import { recommendTask, taskRouteRequest, type AccountState, type TaskJudgment } from '../src/index';

const now = new Date('2026-09-25T12:00:00.000Z');
const judgment: TaskJudgment = { difficulty: 1, workSize: 1, interactive: 0.2, needsMac: 0.1,
  confidence: 0.9, model: 'jev-test' };

function classesFor(provider: string): string[] {
  if (provider === 'cursor') return ['cursor_models', 'other_models'];
  if (provider === 'openai') return ['work_codex'];
  if (provider === 'google') return ['gemini_apps'];
  return ['high_reasoning'];
}

function scopeFor(provider: string): string {
  if (provider === 'cursor') return 'cursor_models';
  if (provider === 'openai') return 'work_codex';
  if (provider === 'google') return 'gemini_apps';
  return 'all_models';
}

function account(id: string, provider: string, remaining: number, resetHours: number, startedHours: number): AccountState {
  const observed = '2026-09-25T11:58:00.000Z';
  const reset = new Date(now.getTime() + resetHours * 3_600_000).toISOString();
  const start = new Date(now.getTime() - startedHours * 3_600_000).toISOString();
  const kind = provider === 'cursor' ? 'monthly' : 'session';
  return { id, provider, label: id, plan: null, enabled: true, capabilities: ['coding'],
    model_classes: classesFor(provider),
    priority: 0, status: 'available', freshness: 'fresh', observed_at: observed, latest_refresh_at: observed,
    limits: [{ id: `${kind}-primary`, account_id: id, kind,
      scope: scopeFor(provider), unit: 'fraction',
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
    expect(result.handoff).toMatchObject({status:'not_started',provider:'openai',model_id:'gpt-6-astra'});
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

  it('treats Google AI Pro as a Gemini Apps subscription route, not API billing', () => {
    const google = account('google-ai-pro-personal', 'google', 0.9, 2, 3);
    google.model_classes = ['gemini_apps'];
    google.limits[0]!.scope = 'gemini_apps';
    const result = recommendTask([google], { task: 'Draft a Gemini chat reply for review', capability: 'coding' }, judgment, { now });
    expect(result.recommended).toMatchObject({ account_id: 'google-ai-pro-personal', provider: 'google', model_id: 'gemini-flash' });
    expect(result.candidates.map(c => c.model_id).sort()).toEqual(['gemini-flash', 'gemini-pro']);
    const hard = recommendTask([google], { task: 'Implement a large reasoning-heavy refactor', estimated_work: 'large',
      capability: 'coding', needs_mac: true }, { ...judgment, difficulty: 2.2 }, { now });
    expect(hard.recommended?.model_id).toBe('gemini-pro');
    expect(hard.candidates.find(c => c.model_id === 'gemini-flash')?.exclusions).toContain('quality_below_task');
  });

  it('picks Astra over richer-pace Opus on a hard task with no continuation', () => {
    // Three eligible advanced accounts; Opus has better pace_surplus than Astra; no project continuity.
    const astra = account('chatgpt-astra', 'openai', 0.55, 1, 4); // remaining 0.55, timeLeft ~0.2 → pace ~0.35
    const opus = account('claude-opus-rich', 'anthropic', 0.90, 1, 4); // remaining 0.90, timeLeft ~0.2 → pace ~0.70
    const sol = account('chatgpt-sol', 'openai', 0.70, 1, 4);
    // Distinct OpenAI accounts each expose both Sol and Astra; filter recommendations by model_id.
    const hard: TaskJudgment = { ...judgment, difficulty: 2.2, workSize: 1 };
    const result = recommendTask([astra, opus, sol], {
      task: 'Refactor the distributed consensus layer carefully',
      project: { stage: 'new' }, estimated_work: 'medium', capability: 'coding', needs_mac: true
    }, hard, { now });
    expect(result.recommended?.model_id).toBe('gpt-6-astra');
    expect(result.reason?.quality_floor).toBe('advanced');
    const opusPace = result.candidates.find(c => c.model_id === 'claude-opus')?.pace_surplus;
    const astraPace = result.candidates.find(c => c.account_id === 'chatgpt-astra' && c.model_id === 'gpt-6-astra')?.pace_surplus;
    expect(opusPace).toBeGreaterThan(astraPace ?? 0);
  });

  it('keeps easy work on the general shelf even when advanced Sol has richer pace', () => {
    const solRich = account('chatgpt-personal', 'openai', 0.95, 1, 4);
    const sonnetLean = account('claude-personal', 'anthropic', 0.45, 4, 1);
    const flashLean = account('google-ai-pro-personal', 'google', 0.45, 4, 1);
    const easy: TaskJudgment = { ...judgment, difficulty: 1.0, workSize: 0.5 };
    const result = recommendTask([solRich, sonnetLean, flashLean], {
      task: 'Fix a typo in the README title',
      project: { stage: 'new' }, estimated_work: 'quick', capability: 'coding'
    }, easy, { now });
    expect(['claude-sonnet', 'gemini-flash', 'cursor-auto']).toContain(result.recommended?.model_id);
    expect(result.recommended?.model_id).not.toBe('gpt-6-sol');
    expect(result.recommended?.model_id).not.toBe('gpt-6-astra');
    expect(result.reason?.quality_floor).toBe('general');
  });

  it('requires a bounded, structured task request', () => {
    expect(taskRouteRequest.safeParse({ task: 'Fix the login form', project: { stage: 'new' } }).success).toBe(true);
    expect(taskRouteRequest.safeParse({ task: 'too short', secret: 'unexpected' }).success).toBe(false);
  });
});

describe('golden route matrix (G1–G9)', () => {
  // Mirrors aligned production inventory: only Claude has room; Cursor and ChatGPT are exhausted.
  const inventory = () => {
    const claude = account('claude-personal', 'anthropic', 0.92, 2, 3);
    const cursor = account('cursor-personal', 'cursor', 0, 2, 3);
    const chatgpt = account('chatgpt-personal', 'openai', 0, 2, 3);
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
    const cursorRows = result.candidates.filter(c => c.account_id === 'cursor-personal');
    const chatgptRows = result.candidates.filter(c => c.account_id === 'chatgpt-personal');
    expect(cursorRows.length).toBeGreaterThan(0);
    expect(cursorRows.every(c => !c.eligible)).toBe(true);
    expect(cursorRows.some(c => c.model_id === 'cursor-auto')).toBe(true);
    expect(cursorRows.find(c => c.model_id === 'cursor-auto')?.exclusions)
      .toEqual(expect.arrayContaining(['exhausted', 'reserve:monthly']));
    expect(chatgptRows.length).toBe(2);
    expect(chatgptRows.every(c => !c.eligible)).toBe(true);
    expect(chatgptRows.map(c => c.exclusions))
      .toEqual([expect.arrayContaining(['exhausted', 'reserve:weekly']), expect.arrayContaining(['exhausted', 'reserve:weekly'])]);
  });
});


describe('subscription billing buckets', () => {
  it('maps Astra/Sol to work_codex, Opus/Sonnet to high_reasoning, Cursor pools correctly; Fable is not routable', () => {
    const result = recommendTask(
      [account('chatgpt-personal', 'openai', 0.9, 2, 3),
        account('claude-personal', 'anthropic', 0.9, 2, 3),
        account('cursor-personal', 'cursor', 0.9, 2, 3)],
      { task: 'Fix a typo in the README title', capability: 'coding' }, judgment, { now });
    const classByModel = Object.fromEntries(
      result.candidates.filter((c): c is typeof c & { model_id: string } => c.model_id != null)
        .map(c => [c.model_id, c.model_class]));
    expect(classByModel['gpt-6-astra']).toBe('work_codex');
    expect(classByModel['gpt-6-sol']).toBe('work_codex');
    expect(classByModel['claude-opus']).toBe('high_reasoning');
    expect(classByModel['claude-sonnet']).toBe('high_reasoning');
    expect(classByModel['claude-opus']).not.toBe('other_models');
    expect(classByModel['cursor-auto']).toBe('cursor_models');
    expect(classByModel['cursor-other-models']).toBe('other_models');
    expect(result.candidates.some(c => c.model_id === 'fable')).toBe(false);
  });
});

describe('old class-map gaps', () => {
  const quick: TaskJudgment = { difficulty: 0, workSize: 0.1, interactive: 0.1, needsMac: 0.1, confidence: 1, model: 'jev-test' };

  it('Cursor tagged only general cannot win route_task (pre-fix gap)', () => {
    const cursor = account('cursor-personal', 'cursor', 0.95, 2, 3);
    cursor.model_classes = ['general'];
    const result = recommendTask([cursor], { task: 'Fix a typo in the README title', capability: 'coding' }, quick, { now });
    expect(result.recommended).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ eligible: false, model_id: null });
    expect(result.candidates[0]?.exclusions).toContain('model_class_unsupported');
  });

  it('ChatGPT tagged high_reasoning cannot win route_task after work_codex alignment', () => {
    const chatgpt = account('chatgpt-personal', 'openai', 0.95, 2, 3);
    chatgpt.model_classes = ['high_reasoning'];
    const result = recommendTask([chatgpt], { task: 'Fix a typo in the README title', capability: 'coding' }, quick, { now });
    expect(result.recommended).toBeNull();
    expect(result.candidates[0]).toMatchObject({ eligible: false, model_id: null });
    expect(result.candidates[0]?.exclusions).toContain('model_class_unsupported');
  });
});

describe('route_task provider win matrix (aligned classes)', () => {
  const judgment: TaskJudgment = { difficulty: 0.4, workSize: 0.2, interactive: 0.1, needsMac: 0.1,
    confidence: 0.95, model: 'jev-test' };
  const task = { task: 'Fix a typo in the README title', capability: 'coding' as const, estimated_work: 'quick' as const };

  function exhaust(a: AccountState): AccountState {
    return { ...a, limits: a.limits.map(b => ({ ...b, remaining_fraction: 0, used_fraction: 1 })) };
  }

  it('Claude wins route_task once when peers are exhausted', () => {
    const result = recommendTask(
      [account('claude-personal', 'anthropic', 0.9, 2, 3), exhaust(account('cursor-personal', 'cursor', 0.9, 2, 3)),
        exhaust(account('chatgpt-personal', 'openai', 0.9, 2, 3)), exhaust(account('google-ai-pro-personal', 'google', 0.9, 2, 3))],
      task, judgment, { now });
    expect(result.recommended).toMatchObject({ account_id: 'claude-personal', provider: 'anthropic', model_id: 'claude-sonnet' });
  });

  it('Cursor wins route_task once when peers are exhausted', () => {
    const result = recommendTask(
      [exhaust(account('claude-personal', 'anthropic', 0.9, 2, 3)), account('cursor-personal', 'cursor', 0.9, 2, 3),
        exhaust(account('chatgpt-personal', 'openai', 0.9, 2, 3)), exhaust(account('google-ai-pro-personal', 'google', 0.9, 2, 3))],
      task, judgment, { now });
    expect(result.recommended).toMatchObject({ account_id: 'cursor-personal', provider: 'cursor', model_id: 'cursor-auto' });
  });

  it('ChatGPT wins route_task once when peers are exhausted', () => {
    const result = recommendTask(
      [exhaust(account('claude-personal', 'anthropic', 0.9, 2, 3)), exhaust(account('cursor-personal', 'cursor', 0.9, 2, 3)),
        account('chatgpt-personal', 'openai', 0.9, 2, 3), exhaust(account('google-ai-pro-personal', 'google', 0.9, 2, 3))],
      task, judgment, { now });
    // Sol is advanced; with only OpenAI eligible, quality rank picks Astra over Sol.
    expect(result.recommended).toMatchObject({ account_id: 'chatgpt-personal', provider: 'openai', model_id: 'gpt-6-astra' });
  });

  it('Google wins route_task once when peers are exhausted', () => {
    const result = recommendTask(
      [exhaust(account('claude-personal', 'anthropic', 0.9, 2, 3)), exhaust(account('cursor-personal', 'cursor', 0.9, 2, 3)),
        exhaust(account('chatgpt-personal', 'openai', 0.9, 2, 3)), account('google-ai-pro-personal', 'google', 0.9, 2, 3)],
      task, judgment, { now });
    expect(result.recommended).toMatchObject({ account_id: 'google-ai-pro-personal', provider: 'google', model_id: 'gemini-flash' });
  });
});
