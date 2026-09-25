import { describe, expect, it } from 'vitest';
import { snapshotFromTab } from '../src/browser-source';

const observedAt = '2026-09-25T12:00:00.000Z';

describe('signed-in Chrome tab routing', () => {
  it('accepts only provider usage pages and maps each to the expected account', () => {
    expect(snapshotFromTab('https://claude.ai/new#settings/usage', 'Current session\n0% used\nThis week\n0% used', observedAt).account_id).toBe('claude-personal');
    expect(snapshotFromTab('https://cursor.com/dashboard/spending', 'Cursor Models\n20% used', observedAt).account_id).toBe('cursor-personal');
    expect(snapshotFromTab('https://chatgpt.com/#settings/Usage', '5-hour limit\n20% used', observedAt).account_id).toBe('chatgpt-personal');
    expect(() => snapshotFromTab('https://claude.ai/new', 'Current session\n0% used', observedAt)).toThrow('usage page');
    expect(() => snapshotFromTab('https://evil.example/#settings/usage', 'Current session\n0% used', observedAt)).toThrow('usage page');
  });
  it('bounds page text and keeps missing usage unknown', () => {
    expect(() => snapshotFromTab('https://claude.ai/new#settings/usage', 'x'.repeat(200_001), observedAt)).toThrow('too large');
    expect(snapshotFromTab('https://claude.ai/new#settings/usage', 'Please sign in', observedAt)).toMatchObject({ status: 'error', limits: [] });
  });
});
