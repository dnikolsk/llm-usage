import type {AccountState,UsageBucket} from '@llm-usage/core';
export const names:Record<string,string>={anthropic:'Claude',openai:'Codex',cursor:'Cursor',google:'Google AI Pro'};
export function percent(n:number|null){return n===null?'—':`${Number((n*100).toFixed(1))}%`;}
export function time(iso:string|null){return iso?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso)):'Not reported';}
export function reset(iso:string|null,now:Date){
 if(!iso)return 'Reset not reported';
 const mins=Math.ceil((Date.parse(iso)-+now)/60000);
 if(mins<=0)return 'Awaiting refresh';
 if(mins<60)return `Resets in ${mins}m`;
 if(mins<1440)return `Resets in ${Math.floor(mins/60)}h ${mins%60}m`;
 return `Resets in ${Math.floor(mins/1440)}d ${Math.floor(mins%1440/60)}h`;
}
export function label(b:UsageBucket){
 if(b.scope==='cursor_auto')return 'Auto';if(b.scope==='cursor_api')return 'Other models';
 if(b.scope==='cursor_models')return 'Own models';if(b.scope==='other_models')return 'Other models';
 if(b.scope!=='all_models')return b.scope.replaceAll('_',' ');
 return b.kind==='session'?'Session':b.kind==='weekly'?'Weekly':'Included';
}
export function liveRemaining(account:AccountState,b:UsageBucket,now:Date){
 const age=+now-Date.parse(b.observed_at);
 return account.status==='error'||age>600000||age< -60000||(b.reset_at&&Date.parse(b.reset_at)<=+now)?null:b.remaining_fraction;
}
export function primaryBuckets(account:AccountState){
 const common=account.limits.filter(b=>b.scope==='all_models');
 const pools=account.limits.filter(b=>['cursor_auto','cursor_api'].includes(b.scope));
 return (account.provider==='cursor'?[...common,...pools]:common.length?common:account.limits).slice(0,3);
}
export function diagnostic(code:string){
 return code==='usage_amount_percentage_conflict'?'Provider dollar totals disagree with percentages. Percentages are shown.':
 code==='usage_auth_required'?'The worker’s provider session expired or was revoked. Usage and resets stay unknown until the worker signs in again.':code==='usage_rate_limited'?'Provider asked us to wait before refreshing.':code.replaceAll('_',' ');
}

export function paidAmount(value:number|null,unit:string){
 if(value===null)return 'Not reported';
 return unit==='usd_cents'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):`${new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value)} ${unit}`;
}
export function paidCurrent(account:AccountState,p:import('@llm-usage/core').PaidUsage,now:Date){
 const age=+now-Date.parse(p.observed_at);
 return account.status!=='error'&&Number.isFinite(age)&&age>=-60000&&age<=600000&&(!p.reset_at||Date.parse(p.reset_at)>+now);
}
