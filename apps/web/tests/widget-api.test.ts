import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/store', () => ({ getStatus: vi.fn() }));
import { getStatus } from '../src/store';
import { POST as session } from '../app/v1/widget/session/route';
import { GET as status } from '../app/v1/widget/status/route';

const password = 'widget-test-dashboard-password-with-enough-length';
beforeEach(() => {
  process.env.DASHBOARD_PASSWORD = password;
  vi.mocked(getStatus).mockResolvedValue({ generated_at: '2026-09-25T12:00:00.000Z', accounts: [] });
});
afterEach(() => { delete process.env.DASHBOARD_PASSWORD; vi.useRealTimers(); vi.clearAllMocks(); });

describe('widget API', () => {
  const login = (candidate: string) => session(new Request('https://example.com/v1/widget/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: candidate })
  }));

  it('issues a read-only session only for the dashboard password', async () => {
    expect((await login('wrong')).status).toBe(401);
    const response = await login(password);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.session).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]+$/);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(body)).not.toContain(password);
    const result = await status(new Request('https://example.com/v1/widget/status', {
      headers: { Authorization: `Bearer ${body.session}` }
    }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it('rejects missing or tampered sessions before reading status', async () => {
    const issued = await (await login(password)).json();
    for (const authorization of ['', `Bearer ${issued.session}x`, `Bearer ${password}`]) {
      expect((await status(new Request('https://example.com/v1/widget/status', {
        headers: { Authorization: authorization }
      }))).status).toBe(401);
    }
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('fails closed when dashboard login is unconfigured', async () => {
    delete process.env.DASHBOARD_PASSWORD;
    expect((await login(password)).status).toBe(503);
  });

  it('rejects expired sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    const issued = await (await login(password)).json();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    expect((await status(new Request('https://example.com/v1/widget/status', {
      headers: { Authorization: `Bearer ${issued.session}` }
    }))).status).toBe(401);
    expect(getStatus).not.toHaveBeenCalled();
  });
});
