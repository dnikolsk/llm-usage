import type {AccountState,PaidUsage,UsageBucket} from '@llm-usage/core';
import type {SessionSummary} from '../src/sessions';
import {names,percent,time,label,liveRemaining,primaryBuckets,diagnostic,paidAmount,paidCurrent,countdown,resetWhen,level,clock} from '../src/dashboard-display';

export type Worker='ready'|'offline'|null;
const providerName=(p:string)=>names[p]??p;

function Meter({value,name}:{value:number|null;name:string}){
 return <span className="meter" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value===null?undefined:value*100} aria-valuetext={value===null?'Unknown':percent(value)}><i style={{width:`${(value??0)*100}%`}}/></span>;
}

function Row({account,bucket,now,repeat=false}:{account:AccountState;bucket:UsageBucket;now:Date;repeat?:boolean}){
 const value=liveRemaining(account,bucket,now);
 const name=label(bucket);
 return <div className={`row ${level(value)}`}>
  <span className="row-label">{name}</span>
  <Meter value={value} name={`${providerName(account.provider)} ${name} remaining`}/>
  <strong className="pct">{value===null?'—':`${Math.round(value*100)}%`}</strong>
  <span className="when">{bucket.reset_at?repeat?<time className="in same" dateTime={bucket.reset_at} title={`${time(bucket.reset_at)} ET`}>{countdown(bucket.reset_at,now)}</time>:<><span className="in">{countdown(bucket.reset_at,now)}</span><time dateTime={bucket.reset_at} title={`${time(bucket.reset_at)} ET`}>{resetWhen(bucket.reset_at,now)}</time></>:<span className="in none">no reset</span>}</span>
 </div>;
}

function Paid({account,paid,now}:{account:AccountState;paid:PaidUsage;now:Date}){
 const current=paidCurrent(account,paid,now);
 const value=!current?'Needs refresh':paid.enabled===false?'Off':paid.unlimited?'Unlimited':paid.remaining===null?'Not reported':`${paidAmount(paid.remaining,paid.unit)} left`;
 const detail=paid.enabled===false?'':[paid.used!==null?`${paidAmount(paid.used,paid.unit)} used${paid.limit!==null?` of ${paidAmount(paid.limit,paid.unit)}`:''}`:null,!current&&paid.remaining!==null?`last ${paidAmount(paid.remaining,paid.unit)}`:null].filter(Boolean).join(' · ');
 return <div className="paid" title={paid.kind==='spending_limit'?'Spending limit; not a prepaid balance':'Provider credits'}>
  <span>{paid.label}</span><span className="paid-value"><strong className={paid.enabled===false||!current?'muted':''}>{value}</strong>{detail&&<small>{detail}</small>}</span>
 </div>;
}

function Status({session}:{session?:SessionSummary}){
 if(session?.status==='connected')return <span className="status good"><i/>Live</span>;
 return <a className="status bad" href="/connect"><i/>{session?'Sign in again':'Not connected'}</a>;
}

export function AccountCard({account,now,worker,session}:{account:AccountState;now:Date;worker:Worker;session?:SessionSummary}){
 const buckets=primaryBuckets(account);
 const paid=account.paid_usage??[];
 const warnings=[...new Set([account.usage_diagnostic,account.paid_usage_diagnostic,...account.limits.map(b=>b.metadata.diagnostic_code)].filter((v):v is string=>!!v))];
 const fresh=account.status!=='error'&&account.freshness==='fresh';
 const extra=account.limits.filter(b=>!buckets.includes(b));
 return <article className={`card ${account.provider}`}>
  <header>
   <h2><span className="mark" aria-hidden="true"/>{providerName(account.provider)}<span className="sub">{account.label}</span></h2>
   <div className="flags">{worker&&<span className={`status ${worker==='ready'?'good':'idle'}`} title={worker==='ready'?'Worker online':'Worker offline'}><i/>Worker</span>}<Status session={session}/></div>
  </header>
  {buckets.length?<div className="rows">{buckets.map((b,i)=><Row key={b.id} account={account} bucket={b} now={now} repeat={i>0&&b.reset_at===buckets[i-1].reset_at}/>)}</div>:<p className="empty-row">{account.status==='error'?'Usage not reported by provider.':'No usage reported yet.'}</p>}
  {paid.map(p=><Paid key={p.id} account={account} paid={p} now={now}/>)}
  {warnings.map(w=><p className="warn" key={w}>{diagnostic(w)}</p>)}
  <details className="more">
   <summary><span className={fresh?'':'stale'}>{fresh?`Updated ${account.observed_at?clock(new Date(account.observed_at)):'—'}`:'Needs refresh'}</span><span>{extra.length?`+${extra.length} more`:'Details'}</span></summary>
   <div className="more-body">
    {extra.length>0&&<div className="rows">{extra.map(b=><Row key={b.id} account={account} bucket={b} now={now}/>)}</div>}
    <dl>
     <dt>Measured</dt><dd>{time(account.observed_at)} ET</dd>
     <dt>Last check</dt><dd>{time(account.latest_refresh_at)} ET</dd>
     {account.limits.map(b=>{const v=liveRemaining(account,b,now);return <div key={b.id} className="dl-row"><dt>{label(b)} <small>· {b.confidence.replaceAll('_',' ')}</small></dt><dd>{percent(v)}{v===null&&b.remaining_fraction!==null&&<small> (last {percent(b.remaining_fraction)})</small>}</dd></div>;})}
    </dl>
   </div>
  </details>
 </article>;
}

export function Login({failed,configured}:{failed:boolean;configured:boolean}){
 return <main className="login">
  <span className="brand"><span className="brand-dot"/>Usage</span>
  <h1>Sign in</h1>
  <p>Remaining capacity and resets for your AI accounts.</p>
  {configured?<form action="/dashboard/login" method="post"><label htmlFor="password">Dashboard password</label><input id="password" name="password" type="password" required autoComplete="current-password"/>{failed&&<p className="warn" role="alert">That password didn’t work.</p>}<button className="primary">Sign in</button></form>:<p role="status">Dashboard access hasn’t been configured.</p>}
 </main>;
}
