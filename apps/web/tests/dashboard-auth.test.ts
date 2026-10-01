import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardSession, dashboardConfigured, validDashboardPassword, validDashboardSession } from '../src/dashboard-auth';
import { POST as login } from '../app/dashboard/login/route';

const password = 'a-unique-dashboard-password-with-adequate-length';
beforeEach(() => { process.env.DASHBOARD_PASSWORD = password; });
afterEach(() => { delete process.env.DASHBOARD_PASSWORD; });

describe('dashboard login', () => {
  it('requires a configured password and compares it exactly', () => {
    expect(dashboardConfigured()).toBe(true);
    expect(validDashboardPassword(password)).toBe(true);
    expect(validDashboardPassword(password + 'x')).toBe(false);
    process.env.DASHBOARD_PASSWORD = 'short';
    expect(dashboardConfigured()).toBe(false);
    expect(validDashboardPassword('short')).toBe(false);
  });

  it('rejects changed, expired, and future session cookies', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    const session = createDashboardSession(now);
    expect(validDashboardSession(session, now)).toBe(true);
    expect(validDashboardSession(session + 'x', now)).toBe(false);
    expect(validDashboardSession(session, now + 31 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(validDashboardSession(session, now - 61_000)).toBe(false);
    process.env.DASHBOARD_PASSWORD = 'different-long-dashboard-password-value';
    expect(validDashboardSession(session, now)).toBe(false);
  });

  it('sets a private session cookie only after a correct login', async () => {
    const request = (value: string) => new Request('https://example.com/dashboard/login', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: value })
    });
    const wrong = await login(request('wrong'));
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    const accepted = await login(request(password));
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('location')).toBe('/');
    expect(accepted.headers.get('set-cookie')).toContain('HttpOnly');
    expect(accepted.headers.get('set-cookie')).toContain('Secure');
    expect(accepted.headers.get('set-cookie')).toContain('SameSite=strict');
    expect(accepted.headers.get('cache-control')).toBe('no-store');
  });
});
