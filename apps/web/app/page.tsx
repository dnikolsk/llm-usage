import {cookies} from 'next/headers';
import {taskSpec,type AccountState,type UsageBucket} from '@llm-usage/core';
import {dashboardConfigured,dashboardCookie,validDashboardSession} from '../src/dashboard-auth';
import {getStatus} from '../src/store';
import {listExecutionAccounts,planTask} from '../src/execution-store';
import {names,percent,time,reset,label,liveRemaining,primaryBuckets,diagnostic} from '../src/dashboard-display';
import Refresh from './refresh';
export const dynamic='force-dynamic';
function Login({failed}:{failed:boolean}){return <main className="login"><span className="wordmark">◈ USAGE</span><h1>Your AI accounts.<br/>One clear view.</h1><p>Capacity, resets, and readiness.</p>{dashboardConfigured()?<form action="/dashboard/login" method="post"><label htmlFor="password">Dashboard password</label><input id="password" name="password" type="password" required autoComplete="current-password"/>{failed&&<p role="alert">That password didn’t work.</p>}<button className="primary">Sign in</button></form>:<p role="status">Dashboard access hasn’t been configured.</p>}</main>;}
function Bucket({account,bucket,now}:{account:AccountState;bucket:UsageBucket;now:Date}){
 const value=liveRemaining(account,bucket,now);
 return <div className="bucket"><span>{label(bucket)}</span><strong className={value!==null&&value<=.15?'low':''}>{percent(value)}<small> left</small></strong><div className="track" role="meter" aria-label={`${names[account.provider]??account.provider} ${label(bucket)} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value===null?undefined:value*100} aria-valuetext={value===null?'Unknown':percent(value)}><i style={{width:`${(value??0)*100}%`}}/></div><span className="reset" title={time(bucket.reset_at)}>{reset(bucket.reset_at,now)}</span></div>;
}
function Account({account,now,ready}:{account:AccountState;now:Date;ready:boolean}){
 const buckets=primaryBuckets(account);
 const warnings=[...new Set([account.usage_diagnostic,...account.limits.map(b=>b.metadata.diagnostic_code)].filter((v):v is string=>!!v))];
 const fresh=account.status!=='error'&&account.freshness==='fresh';
 return <article className={`account ${account.provider}`}><header><div className="identity"><span className="provider-mark">{(names[account.provider]??account.provider)[0]}</span><div><h2>{names[account.provider]??account.provider}</h2><span className="account-label">{account.label}</span></div></div><span className={`badge ${ready?'good':''}`}>{ready?'Worker online':'Worker offline'}</span></header>
 <div className="buckets">{buckets.length?buckets.map(b=><Bucket key={b.id} account={account} bucket={b} now={now}/>):<p className="empty">No usage reported yet.</p>}</div>
 <details><summary><span className={!fresh||warnings.length?'attention':''}>{!fresh?'Usage needs refresh':warnings.length?'Usage note':'All limits & details'}</span><span>＋</span></summary><div className="detail-body">{warnings.map(w=><p className="notice" key={w}>{diagnostic(w)}</p>)}<p className="muted">Measured {time(account.observed_at)} ET · Last check {time(account.latest_refresh_at)} ET</p><div className="limit-list">{account.limits.map(b=><div key={b.id}><span>{label(b)}<small>{b.scope.replaceAll('_',' ')} · {b.confidence.replaceAll('_',' ')}</small></span><span>{percent(liveRemaining(account,b,now))}<small>{time(b.reset_at)}{b.reset_at?' ET':''}</small>{liveRemaining(account,b,now)===null&&b.remaining_fraction!==null&&<small>Last reported: {percent(b.remaining_fraction)}</small>}</span></div>)}</div></div></details></article>;
}
export default async function Home({searchParams}:{searchParams:Promise<{login?:string;repository?:string}>}){
 const query=await searchParams;
 if(!validDashboardSession((await cookies()).get(dashboardCookie)?.value))return <Login failed={query.login==='failed'}/>;
 const now=new Date();let status:Awaited<ReturnType<typeof getStatus>>|null=null;
 let execution:Awaited<ReturnType<typeof listExecutionAccounts>>|null=null;
 let plan:Awaited<ReturnType<typeof planTask>>|null=null;
 const [usageResult,executionResult]=await Promise.allSettled([getStatus(now),listExecutionAccounts()]);
 if(usageResult.status==='fulfilled')status=usageResult.value;
 if(executionResult.status==='fulfilled')execution=executionResult.value;
 const repos=[...new Set<string>((execution?.targets??[]).flatMap(t=>t.registration.repositories))].sort();
 const repository=query.repository&&repos.includes(query.repository)?query.repository:repos[0];
 if(repository)try{plan=await planTask(taskSpec.parse({repository}));}catch{}
 const allAccounts=status?.accounts.filter(a=>a.enabled)??[];
 const registered=new Set((execution?.targets??[]).map(t=>t.registration.account_id));
 const accounts=registered.size?allAccounts.filter(a=>registered.has(a.id)):allAccounts;
 const otherAccounts=registered.size?allAccounts.filter(a=>!registered.has(a.id)):[];
 return <main className="shell"><header className="topbar"><a className="wordmark" href="/">◈ USAGE</a><div><Refresh/><form action="/dashboard/logout" method="post"><button className="quiet">Sign out</button></form></div></header>
 <section className="heading"><div><h1>Account usage</h1><p>Remaining capacity and resets.</p></div><span className="timestamp">{new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(now)} ET</span></section>
 {repository&&<section className="next"><div><span className="eyebrow">NEXT TASK</span><strong>{plan?.selected?`${names[plan.selected.provider]??plan.selected.provider}${plan.selected.model?` · ${plan.selected.model}`:''}`:'No eligible route'}</strong><span className="muted">{plan?.selected?`${plan.selected.execution==='local'?'On your worker':'Provider cloud'} · ${percent(plan.selected.usable_fraction)} after reserves`:'Check account readiness and usage below.'}</span></div>{plan&&<details><summary>Routing · {repository}</summary><form method="get"><label className="sr-only" htmlFor="repository">Repository</label><select name="repository" id="repository" defaultValue={repository}>{repos.map(r=><option key={r}>{r}</option>)}</select><button className="quiet">Plan</button></form><ol>{plan.steps.map((s,i)=><li key={i}>{s.explanation}</li>)}</ol></details>}</section>}
 <section className="accounts" aria-label="Subscription accounts">{accounts.map(a=><Account key={a.id} account={a} now={now} ready={(execution?.targets??[]).some(t=>t.registration.account_id===a.id&&t.health==='ready'&&t.observed_at&&+now-Date.parse(t.observed_at)<120000)}/>)}{!status&&<div role="status" className="empty">Usage is temporarily unavailable. Try Refresh.</div>}{status&&!accounts.length&&<div className="empty">No accounts yet. Connect your first worker to start collecting usage.</div>}</section>
 {otherAccounts.length>0&&<details className="other-accounts"><summary>{otherAccounts.length} other accounts</summary><div className="accounts">{otherAccounts.map(a=><Account key={a.id} account={a} now={now} ready={false}/>)}</div></details>}
 <footer>Percentages remaining · Times in Eastern Time · Refreshes every minute</footer></main>;
}
