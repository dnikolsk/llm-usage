import { cookies } from 'next/headers';
import { route, type AccountState, type UsageBucket } from '@llm-usage/core';
import { dashboardConfigured, dashboardCookie, validDashboardSession } from '../src/dashboard-auth';
import { getPolicy, getStatus } from '../src/store';

export const dynamic = 'force-dynamic';

const providerNames: Record<string, string> = { anthropic: 'Claude', openai: 'ChatGPT / Codex', cursor: 'Cursor' };
const providerMarks: Record<string, string> = { anthropic: 'C', openai: '◎', cursor: '⌘' };

function percent(value: number | null): string {
  return value === null ? 'Unknown' : `${Math.round(value * 100)}%`;
}
function time(iso: string | null): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(date);
}
function age(iso: string | null, now: Date): string {
  if (!iso) return 'Never';
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`;
}
function limitName(bucket: UsageBucket): string {
  if (bucket.kind === 'session' && bucket.window_seconds === 18_000) return '5-hour window';
  if (bucket.kind === 'session') return 'Current session';
  if (bucket.kind === 'weekly') return 'Weekly window';
  return bucket.kind.replaceAll('_', ' ');
}
function statusLabel(account: AccountState): string {
  if (account.status === 'error') return 'Collector error';
  if (account.freshness !== 'fresh') return account.freshness === 'unknown' ? 'No recent data' : 'Stale data';
  if (account.provider === 'cursor' && !account.limits.length) return 'Signed in · quota unavailable';
  return account.status === 'partial' ? 'Partial data' : 'Up to date';
}
function Login({ failed, configured }: { failed: boolean; configured: boolean }) {
  return <main className="login-shell"><div className="login-orb" aria-hidden="true" /><section className="login-card">
    <div className="eyebrow"><span className="brand-mark">◈</span> LLM USAGE</div>
    <h1>Your accounts, at a glance.</h1>
    <p>View the latest usage collected from your Mac mini. Your Claude, Cursor, and Codex sign-ins stay on that Mac.</p>
    {configured ? <form action="/dashboard/login" method="post" className="login-form">
      <label htmlFor="password">Dashboard password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      {failed && <span className="form-error" role="alert">That password didn’t work. Try again.</span>}
      <button type="submit">Open dashboard <span aria-hidden="true">↗</span></button>
    </form> : <p className="form-error">Dashboard access is not configured yet.</p>}
    <span className="login-footnote">Private dashboard · Provider credentials remain on your Mac</span>
  </section></main>;
}
function Meter({ bucket }: { bucket: UsageBucket }) {
  const remaining = bucket.remaining_fraction;
  const used = bucket.used_fraction;
  const display = used === null ? null : Math.max(0, Math.min(100, Math.round(used * 100)));
  return <div className="meter">
    <div className="meter-heading"><span>{limitName(bucket)}</span><strong>{percent(remaining)} <small>left</small></strong></div>
    <div className="meter-track" role="meter" aria-label={`${limitName(bucket)} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={display ?? undefined}>
      {display !== null && <div className={`meter-fill ${remaining !== null && remaining <= .15 ? 'meter-low' : ''}`} style={{ width: `${display}%` }} />}
    </div>
    <div className="meter-caption"><span>{used === null ? 'Usage unavailable' : `${percent(used)} used`}</span><span>{bucket.reset_at ? `Resets ${time(bucket.reset_at)}` : 'Reset time unavailable'}</span></div>
  </div>;
}
function AccountCard({ account, now }: { account: AccountState; now: Date }) {
  const hasLimits = account.limits.length > 0;
  return <article className={`account-card provider-${account.provider}`}>
    <div className="account-top"><div className="provider-icon" aria-hidden="true">{providerMarks[account.provider] ?? '◈'}</div>
      <div className="account-name"><span>{providerNames[account.provider] ?? account.provider}</span><h2>{account.label}</h2></div>
      <span className={`status-pill ${account.status === 'error' || account.freshness !== 'fresh' ? 'pill-warning' : !hasLimits ? 'pill-muted' : 'pill-good'}`}>
        <i aria-hidden="true" />{statusLabel(account)}
      </span>
    </div>
    <div className="account-body">{hasLimits ? account.limits.map(bucket => <Meter key={bucket.id} bucket={bucket} />)
      : <div className="empty-limits"><span aria-hidden="true">◌</span><strong>{account.provider === 'cursor' ? 'Personal quota not exposed' : 'No usage windows available'}</strong><p>{account.provider === 'cursor' ? 'Cursor CLI confirms your sign-in, but does not provide personal-plan usage figures.' : 'The collector has not reported a usable quota yet.'}</p></div>}</div>
    <div className="account-bottom"><span>Last checked</span><time dateTime={account.latest_refresh_at ?? undefined}>{age(account.latest_refresh_at, now)}</time></div>
  </article>;
}
export default async function Home({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const params = await searchParams;
  const session = (await cookies()).get(dashboardCookie)?.value;
  if (!validDashboardSession(session)) return <Login failed={params.login === 'failed'} configured={dashboardConfigured()} />;

  const now = new Date();
  let data: Awaited<ReturnType<typeof getStatus>> | null = null;
  let codingPick: string | null = null;
  let latestUpdate: string | null = null;
  try {
    const [status, policy] = await Promise.all([getStatus(now), getPolicy()]);
    data = status;
    latestUpdate = status.accounts.map(account => account.latest_refresh_at).filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const recommendation = route(status.accounts, { capability: 'coding', now, policy }).recommended;
    codingPick = recommendation ? status.accounts.find(account => account.id === recommendation.account_id)?.label ?? recommendation.account_id : null;
  } catch { /* Show a recoverable unavailable state without leaking database details. */ }

  return <main className="dashboard-shell"><div className="dashboard-width">
    <header className="site-header"><div className="brand"><span className="brand-mark">◈</span><span>LLM <b>USAGE</b></span></div>
      <div className="header-actions"><a href="/" className="refresh-link">↻ <span>Refresh</span></a><form action="/dashboard/logout" method="post"><button type="submit" className="signout-button">Sign out</button></form></div></header>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> PERSONAL USAGE DASHBOARD</div><h1>Know what’s<br /><em>available.</em></h1><p>Live subscription capacity from the CLIs signed in on your Mac mini.</p></div>
      <div className="hero-aside"><div className="pulse-dot" /><span>SYNCING EVERY 5 MIN</span><strong>{data ? `${data.accounts.length} accounts connected` : 'Service unavailable'}</strong><small>Updated {latestUpdate ? time(latestUpdate) : '—'}</small></div></section>
    <section className="overview" aria-label="Overview">
      <div className="overview-item"><span className="overview-label">CODING PICK</span><strong>{codingPick ?? 'No fresh recommendation'}</strong><small>Based on measured capacity and routing reserves</small></div>
      <div className="overview-item"><span className="overview-label">FRESH COLLECTORS</span><strong>{data ? `${data.accounts.filter(a => a.freshness === 'fresh').length} / ${data.accounts.length}` : '—'}</strong><small>Data collected within the last 10 minutes</small></div>
      <div className="overview-item"><span className="overview-label">LAST UPDATE</span><strong>{latestUpdate ? time(latestUpdate) : 'Unavailable'}</strong><small>Times shown in Eastern Time</small></div>
    </section>
    <div className="section-heading"><div><span className="eyebrow">CONNECTED ACCOUNTS</span><h2>Usage by provider</h2></div><span className="section-note">Read-only view · Updated automatically by your Mac</span></div>
    {data ? <div className="account-grid">{data.accounts.map(account => <AccountCard key={account.id} account={account} now={now} />)}</div>
      : <div className="unavailable" role="status"><strong>Usage is temporarily unavailable.</strong><p>Try refreshing in a moment. Your collectors will keep syncing in the background.</p></div>}
    <footer className="site-footer"><span>LLM Usage Tracker</span><span>Provider credentials never leave your Mac mini.</span></footer>
  </div></main>;
}
