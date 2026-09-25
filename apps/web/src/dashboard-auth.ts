import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const dashboardCookie = 'llm_usage_dashboard';
const sessionSeconds = 30 * 24 * 60 * 60;

function secret(): string | null {
  const value = process.env.DASHBOARD_PASSWORD;
  return value && value.length >= 32 ? value : null;
}

export function dashboardConfigured(): boolean { return secret() !== null; }

export function validDashboardPassword(candidate: string): boolean {
  const expected = secret();
  if (!expected) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

function signature(issued: string, password: string): Buffer {
  return createHmac('sha256', password).update(`llm-usage-dashboard-v1:${issued}`).digest();
}

export function createDashboardSession(now = Date.now()): string {
  const password = secret();
  if (!password) throw new Error('Dashboard password is not configured');
  const issued = Math.floor(now / 1000).toString(36);
  return `${issued}.${signature(issued, password).toString('base64url')}`;
}

export function validDashboardSession(value: string | undefined, now = Date.now()): boolean {
  const password = secret();
  if (!password || !value) return false;
  const match = /^([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return false;
  const issuedAt = parseInt(match[1]!, 36);
  const age = Math.floor(now / 1000) - issuedAt;
  if (!Number.isSafeInteger(issuedAt) || age < -60 || age > sessionSeconds) return false;
  const provided = Buffer.from(match[2]!, 'base64url');
  const expected = signature(match[1]!, password);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export const dashboardSessionMaxAge = sessionSeconds;
