import {cookies} from 'next/headers';
import {taskSpec} from '@llm-usage/core';
import {dashboardConfigured,dashboardCookie,validDashboardSession} from '../src/dashboard-auth';
import {getLiveStatus} from '../src/observe';
import {listSessions} from '../src/sessions';
import {listExecutionAccounts,planTask} from '../src/execution-store';
import {names,percent,clock} from '../src/dashboard-display';
import {AccountCard,Login,type Worker} from './dashboard-view';
import Refresh from './refresh';
export const dynamic='force-dynamic';
export const maxDuration=30;
export default async function Home({searchParams}:{searchParams:Promise<{login?:string;repository?:string}>}){
 const query=await searchParams;
 if(!validDashboardSession((await cookies()).get(dashboardCookie)?.value))return <Login failed={query.login==='failed'} configured={dashboardConfigured()}/>;
 const now=new Date();let status:Awaited<ReturnType<typeof getLiveStatus>>|null=null;
 let execution:Awaited<ReturnType<typeof listExecutionAccounts>>|null=null;
 let plan:Awaited<ReturnType<typeof planTask>>|null=null;
 // Observe first so the execution view reuses the same live window instead of calling providers twice.
 const usageResult=await Promise.allSettled([getLiveStatus(now)]).then(r=>r[0]);
 if(usageResult.status==='fulfilled')status=usageResult.value;
 const [executionResult,sessionResult]=await Promise.allSettled([listExecutionAccounts(),listSessions()]);
 if(executionResult.status==='fulfilled')execution=executionResult.value;
 const sessions=sessionResult.status==='fulfilled'?sessionResult.value:[];
 const targets=execution?.targets??[];
 const repos=[...new Set<string>(targets.flatMap(t=>t.registration.repositories))].sort();
 const repository=query.repository&&repos.includes(query.repository)?query.repository:repos[0];
 if(repository)try{plan=await planTask(taskSpec.parse({repository}));}catch{}
 const allAccounts=status?.accounts.filter(a=>a.enabled)??[];
 const registered=new Set(targets.map(t=>t.registration.account_id));
 const accounts=registered.size?allAccounts.filter(a=>registered.has(a.id)):allAccounts;
 const otherAccounts=registered.size?allAccounts.filter(a=>!registered.has(a.id)):[];
 const worker=(id:string):Worker=>!registered.has(id)?null:targets.some(t=>t.registration.account_id===id&&t.health==='ready'&&t.observed_at&&+now-Date.parse(t.observed_at)<120000)?'ready':'offline';
 const card=(a:typeof allAccounts[number])=><AccountCard key={a.id} account={a} now={now} worker={worker(a.id)} session={sessions.find(s=>s.account_id===a.id)}/>;
 return <main className="shell">
  <header className="topbar"><a className="brand" href="/"><span className="brand-dot"/>Usage</a><div className="topbar-right"><span className="stamp">{clock(now)} ET</span><Refresh/></div></header>
  <section className="cards" aria-label="Subscription accounts">{accounts.map(card)}{!status&&<div role="status" className="empty">Usage is temporarily unavailable. Try refresh.</div>}{status&&!accounts.length&&<div className="empty">No accounts yet. <a href="/connect">Connect a provider</a> to start reading usage live.</div>}</section>
  {otherAccounts.length>0&&<details className="fold"><summary>{otherAccounts.length} other account{otherAccounts.length===1?'':'s'}</summary><div className="cards">{otherAccounts.map(card)}</div></details>}
  {repository&&<details className="fold next"><summary><span>Next task</span><strong>{plan?.selected?`${names[plan.selected.provider]??plan.selected.provider}${plan.selected.model?` · ${plan.selected.model}`:''} · ${percent(plan.selected.usable_fraction)}`:'No eligible route'}</strong></summary>
   <p className="muted">{plan?.selected?`${plan.selected.execution==='local'?'On your worker':'Provider cloud'} · ${percent(plan.selected.usable_fraction)} usable after reserves`:'Check account readiness and usage above.'}</p>
   <form method="get"><label className="sr-only" htmlFor="repository">Repository</label><select name="repository" id="repository" defaultValue={repository}>{repos.map(r=><option key={r}>{r}</option>)}</select><button>Plan</button></form>
   {plan&&<ol>{plan.steps.map((s,i)=><li key={i}>{s.explanation}</li>)}</ol>}
  </details>}
  <footer><span>% remaining · times ET</span><a href="/connect">Connect</a><form action="/dashboard/logout" method="post"><button className="link">Sign out</button></form></footer>
 </main>;
}
