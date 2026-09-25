import { describe, expect, it } from 'vitest';
import { parseUsage as parseCursor } from '../src/providers/cursor/parse';
import { parseUsage as parseOpenAI } from '../src/providers/openai/parse';

const observedAt = '2026-09-25T12:00:00.000Z';

describe('Cursor included usage', () => {
  it('keeps the two monthly pools separate and ignores on-demand spend', () => {
    const snapshot = parseCursor('Spending\nCursor Models\n25% used\nOther Models\n80% remaining\nOn-demand usage\n$12 spent', 'cursor-personal', observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(b => [b.scope, b.remaining_fraction])).toEqual([
      ['cursor_models', .75], ['other_models', .8]
    ]);
    expect(snapshot.limits.every(b => b.reset_at === null)).toBe(true);
  });
  it('leaves a missing or ambiguous pool unknown', () => {
    expect(parseCursor('Cursor Models\n20% used', 'cursor-personal', observedAt).limits.map(b => b.remaining_fraction)).toEqual([.8, null]);
    expect(parseCursor('Cursor Models\n20% used\n30% remaining', 'cursor-personal', observedAt)).toMatchObject({ status: 'error', limits: [] });
    expect(parseCursor('Sign in', 'cursor-personal', observedAt)).toMatchObject({ status: 'error', limits: [] });
  });
  it('accepts explicitly labeled included dollar allowance', () => {
    const snapshot = parseCursor('Cursor Models\n$5 used of $20\nOther Models\n$30 remaining of $40\nOn-demand usage\n$8 spent', 'cursor-personal', observedAt);
    expect(snapshot.limits[0]?.remaining_fraction).toBeCloseTo(.75);
    expect(snapshot.limits[1]?.remaining_fraction).toBeCloseTo(.75);
  });
});

describe('OpenAI Work/Codex included usage', () => {
  it('reads only five-hour and weekly allowances', () => {
    const snapshot = parseOpenAI('Usage\n5-hour limit\n40% remaining\nWeekly limit\n70% used\nCredits\n$10', 'chatgpt-personal', observedAt);
    expect(snapshot.status).toBe('ok');
    expect(snapshot.limits.map(b => [b.kind, b.scope])).toEqual([['session', 'work_codex'], ['weekly', 'work_codex']]);
    expect(snapshot.limits[0]?.remaining_fraction).toBeCloseTo(.4);
    expect(snapshot.limits[1]?.remaining_fraction).toBeCloseTo(.3);
    expect(snapshot.limits.every(b => b.reset_at === null)).toBe(true);
  });
  it('does not treat chat or credits as capacity', () => {
    expect(parseOpenAI('GPT-6 chat\n80% remaining\nCredits\n$20', 'chatgpt-personal', observedAt)).toMatchObject({ status: 'error', limits: [] });
    expect(parseOpenAI('5-hour limit\n20% used', 'chatgpt-personal', observedAt).limits.map(b => b.remaining_fraction)).toEqual([.8, null]);
  });
});
