import { chmod, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { parseUsage } from './parse';

const usageUrl = 'https://claude.ai/settings/usage';

export async function login(profileDir: string): Promise<void> {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await chmod(profileDir, 0o700);
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, acceptDownloads: false });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(usageUrl, { waitUntil: 'domcontentloaded' });
    process.stdout.write('Sign in to Claude in the opened browser, then press Enter here.\n');
    await new Promise<void>(resolve => process.stdin.once('data', () => resolve()));
  } finally { await context.close(); }
}

export async function collect(profileDir: string, accountId: string) {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await chmod(profileDir, 0o700);
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: false });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(usageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText(/current session|weekly limits/i).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const observedAt = new Date().toISOString();
    return parseUsage(await page.locator('body').innerText(), accountId, observedAt);
  } finally { await context.close(); }
}
