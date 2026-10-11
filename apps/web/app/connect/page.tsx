import {cookies} from 'next/headers';
import {observerFor} from '@llm-usage/providers';
import {dashboardCookie,validDashboardSession} from '../../src/dashboard-auth';
import {listAccounts} from '../../src/accounts';
import {listSessions,type SessionSummary} from '../../src/sessions';
import {enrollmentCookie,enrollmentMessage,readEnrollment} from '../../src/enroll';
import {sessionKeyConfigured} from '../../src/crypto';
import {names,time} from '../../src/dashboard-display';
export const dynamic='force-dynamic';

function Status({session}:{session:SessionSummary|undefined}){
 if(!session)return <span className="status idle"><i/>Not connected</span>;
 if(session.status!=='connected')return <span className="status bad"><i/>Sign in again{session.failure_code?` · ${session.failure_code.replaceAll('_',' ')}`:''}</span>;
 return <span className="status good" title={session.refreshed_at?`Renewed ${time(session.refreshed_at)} ET`:`Since ${time(session.connected_at)} ET`}><i/>Connected</span>;
}

export default async function Connect({searchParams}:{searchParams:Promise<{account?:string;error?:string;connected?:string;removed?:string}>}){
 const jar=await cookies();
 if(!validDashboardSession(jar.get(dashboardCookie)?.value))return <main className="login"><span className="brand"><span className="brand-dot"/>Usage</span><h1>Sign in first</h1><p><a href="/">Go to the dashboard</a> and sign in, then come back to connect providers.</p></main>;
 const query=await searchParams;
 const [accounts,sessions]=await Promise.all([listAccounts().catch(()=>[]),listSessions().catch(()=>[])]);
 const enrollment=readEnrollment(jar.get(enrollmentCookie)?.value);
 const active=enrollment&&enrollment.account_id===query.account?enrollment:null;
 const observer=active?observerFor(active.provider):null;
 const begun=observer?observer.begin():null;
 return <main className="shell"><header className="topbar"><a className="brand" href="/"><span className="brand-dot"/>Usage</a><a className="back" href="/">← Dashboard</a></header>
 <section className="heading"><h1>Connect providers</h1><p className="muted">One sign-in per provider account. The service keeps the login, reads usage live, and hands workers short-lived access only.</p></section>
 {!sessionKeyConfigured()&&<p className="notice bad">LLM_SESSION_KEY is not configured on the service, so logins cannot be stored. Add a 64-hex-character key to the deployment and redeploy.</p>}
 {query.error&&<p className="notice bad" role="alert">{enrollmentMessage(query.error)}</p>}
 {query.connected&&<p className="notice good" role="status">{query.connected} is connected. Usage now reads live from the provider.</p>}
 {query.removed&&<p className="notice good" role="status">{query.removed} was removed.</p>}
 <section className="cards" aria-label="Provider accounts">{accounts.map(account=>{
  const session=sessions.find(s=>s.account_id===account.id);
  const here=active?.account_id===account.id;
  return <article key={account.id} className={`card ${account.provider}`}><header><h2><span className="mark" aria-hidden="true"/>{names[account.provider]??account.provider}<span className="sub">{account.label} · {account.id}</span></h2><div className="flags"><Status session={session}/></div></header>
   <div className="card-body">
    {here&&active&&begun?<div className="enrollment">
     <p>{begun.instructions}</p>
     <p><a className="primary-link" href={active.authorization_url} target="_blank" rel="noopener noreferrer">Open {names[account.provider]??account.provider} sign-in ↗</a></p>
     <form method="post" action={`/connect/${account.id}/complete`}>
      {begun.input_label?<label>{begun.input_label}<input name="code" type="password" autoComplete="off" required/></label>:<input type="hidden" name="code" value=""/>}
      <button className="primary">{begun.input_label?'Connect account':'I signed in — continue'}</button>
     </form>
     <p className="muted small">This attempt expires {time(new Date(active.expires_at).toISOString())} ET. Codes and tokens never appear in chat or logs.</p>
    </div>:<div className="actions">
     <form method="post" action={`/connect/${account.id}/start`}><button className="primary">{session?'Sign in again':'Connect'}</button></form>
     {session&&<form method="post" action={`/connect/${account.id}/disconnect`}><button className="quiet">Disconnect</button></form>}
     {!session&&<form method="post" action={`/connect/${account.id}/remove`}><button className="quiet" title="Only while the account has no session, targets or jobs">Remove</button></form>}
    </div>}
   </div></article>;})}
  {!accounts.length&&<div className="empty">No accounts yet. Add one below, then connect it.</div>}
 </section>
 <details className="fold"><summary>Add an account</summary><form method="post" action="/connect/accounts" className="add-account">
  <label>Account ID<input name="id" pattern="[a-z][a-z0-9_-]{1,79}" placeholder="claude-personal" required/></label>
  <label>Provider<select name="provider" defaultValue="anthropic"><option value="anthropic">Claude</option><option value="openai">Codex</option><option value="cursor">Cursor</option><option value="google">Gemini</option></select></label>
  <label>Label<input name="label" maxLength={100} placeholder="Claude personal" required/></label>
  <label>Scope<select name="account_type" defaultValue="personal"><option value="personal">Personal</option><option value="work">Work</option></select></label>
  <button className="primary">Add account</button>
 </form></details>
 <footer className="note">Sessions are encrypted with the service key · Workers receive access tokens only · Disconnect revokes nothing at the provider; sign out there to revoke</footer></main>;
}
