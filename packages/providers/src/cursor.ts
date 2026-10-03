import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import {grant,type Grant,type Observer,type PendingEnrollment,type Deps,type Platform} from './types';
import {expiryFromJwt,pkce,providerJson,tokenJson} from './http';

/** The browser hand-off and polling endpoints used by the Cursor CLI's own login. */
export const loginUrl='https://cursor.com/loginDeepControl';
export const pollUrl='https://api2.cursor.sh/auth/poll';
export const refreshUrl='https://api2.cursor.sh/oauth/token';
export const dashboardUrl='https://api2.cursor.sh/aiserver.v1.DashboardService/';

const number=z.number().finite().nonnegative();
const millis=z.union([z.string().regex(/^\d+$/),number]).transform(Number).refine(n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000);
const plan=z.object({limit:number.optional(),includedSpend:number.optional(),remaining:number.optional(),totalPercentUsed:number.optional(),
  autoPercentUsed:number.optional(),apiPercentUsed:number.optional(),autoLimit:number.optional(),apiLimit:number.optional(),autoSpend:number.optional(),apiSpend:number.optional()});
export function normalizeUsage(raw:unknown,accountId:string,now=new Date(),planInfoRaw?:unknown){
  const data=z.object({billingCycleStart:millis.optional(),billingCycleEnd:millis,planUsage:plan,spendLimitUsage:z.unknown().optional()}).parse(raw);
  const info=planInfoRaw===undefined?undefined:z.object({planInfo:z.object({includedUsageResetsAt:millis.optional(),includedUsagePeriod:z.union([z.string(),z.number()]).optional()}).optional()}).parse(planInfoRaw).planInfo;
  const reset=info?.includedUsageResetsAt??data.billingCycleEnd;
  const kind=info?.includedUsagePeriod==='WEEKLY'||info?.includedUsagePeriod===2?'weekly':'subscription';
  const b=data.planUsage;let percent=b.totalPercentUsed;
  if(percent===undefined&&b.limit!==undefined&&b.limit>0){
    if(b.includedSpend!==undefined)percent=b.includedSpend/b.limit*100;
    else if(b.remaining!==undefined)percent=(1-Math.min(b.remaining,b.limit)/b.limit)*100;
  }
  if(percent===undefined)throw new Error('usage_schema_unrecognized');
  const amountPercent=b.limit!==undefined&&b.limit>0&&b.includedSpend!==undefined?b.includedSpend/b.limit*100:undefined;
  const conflicting=amountPercent!==undefined&&b.totalPercentUsed!==undefined&&Math.abs(amountPercent-b.totalPercentUsed)>2;
  const observed=now.toISOString();
  const definitions=[['included','all_models',percent],['auto','cursor_auto',b.autoPercentUsed],['api','cursor_api',b.apiPercentUsed]] as const;
  const limits=definitions.flatMap(([id,scope,value])=>value===undefined?[]:[{id,account_id:accountId,kind,scope,unit:'fraction',
    ...(id==='included'&&!conflicting&&b.limit!==undefined&&b.limit>0&&b.includedSpend!==undefined&&b.includedSpend<=b.limit?{unit:'usd_cents',limit:b.limit,used:b.includedSpend,remaining:Math.max(0,b.limit-b.includedSpend)}:{}),
    metadata:id==='included'&&conflicting?{diagnostic_code:'usage_amount_percentage_conflict'}:{},
    used_fraction:Math.min(1,value/100),remaining_fraction:Math.max(0,1-value/100),observed_at:observed,
    window_started_at:data.billingCycleStart===undefined||info?.includedUsageResetsAt!==undefined?null:new Date(data.billingCycleStart).toISOString(),
    reset_at:new Date(reset).toISOString(),source:'official_api',confidence:'provider_reported'}]);
  const spend=z.object({individualLimit:number.nullish(),individualUsed:number.optional(),individualRemaining:number.optional()}).safeParse(data.spendLimitUsage);
  const paid=spend.success?[{id:'on_demand',label:'On-demand budget',kind:'spending_limit',unit:'usd_cents',
    limit:spend.data.individualLimit??null,used:spend.data.individualUsed??null,
    remaining:spend.data.individualRemaining??null,observed_at:observed,reset_at:new Date(data.billingCycleEnd).toISOString()}]:[];
  // Paid spending limits are not a prepaid wallet or subscription capacity.
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'cursor',observed_at:observed,status:'ok',limits,
    metadata:{adapter_version:'cursor-dashboard-v3',paid_usage:paid,...(data.spendLimitUsage!=null&&!spend.success?{paid_usage_diagnostic:'paid_usage_schema_unrecognized'}:{})}})};
}

const pollResponse=z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1).optional(),authId:z.string().optional()}).loose();
const refreshResponse=z.object({access_token:z.string().min(1).optional(),accessToken:z.string().min(1).optional(),refresh_token:z.string().min(1).optional(),refreshToken:z.string().min(1).optional(),expires_in:z.number().finite().positive().optional()}).loose();
function toGrant(access:string,refresh:string|null,previous:Grant|null,now:number,expiresIn?:number):Grant{
  return grant.parse({access_token:access,refresh_token:refresh??previous?.refresh_token??null,expires_at:expiresIn?now+expiresIn*1000:expiryFromJwt(access)??previous?.expires_at??null,claims:previous?.claims??{},extra_tokens:{}});
}

export const cursor:Observer={
  provider:'cursor',label:'Cursor',
  begin(deps={}){
    const {verifier,challenge}=pkce(deps);
    const uuid=randomUUID();
    const url=new URL(loginUrl);
    for(const [key,value] of Object.entries({challenge,uuid,mode:'login'}))url.searchParams.set(key,value);
    // Cursor completes the hand-off server-side; the browser shows no code, so completion polls with the uuid.
    return{authorization_url:url.toString(),pending:{verifier,state:uuid},instructions:'Sign in to Cursor and approve the login, then come back here and continue.',input_label:null};
  },
  async complete(pending:PendingEnrollment,_input:string,deps={}){
    const url=new URL(pollUrl);url.searchParams.set('uuid',pending.state);url.searchParams.set('verifier',pending.verifier);
    const send=deps.fetch??fetch;
    const response=await send(url,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15_000)});
    if(response.status===404){await response.body?.cancel().catch(()=>{});throw new Error('enrollment_pending');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(response.status===400||response.status===401||response.status===403?'enrollment_rejected':'usage_http_error');}
    const text=await response.text();if(text.length>65_536)throw new Error('usage_response_too_large');
    let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error('usage_invalid_json');}
    const data=pollResponse.parse(parsed);
    return toGrant(data.accessToken,data.refreshToken??null,null,(deps.now??Date.now)());
  },
  async refresh(current,deps={}){
    if(!current.refresh_token)throw new Error('usage_auth_required');
    const data=refreshResponse.parse(await tokenJson(refreshUrl,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({grant_type:'refresh_token',refresh_token:current.refresh_token})},deps));
    const access=data.access_token??data.accessToken;if(!access)throw new Error('usage_auth_required');
    return toGrant(access,data.refresh_token??data.refreshToken??null,current,(deps.now??Date.now)(),data.expires_in);
  },
  async readUsage(current,accountId,deps={}){
    const request=(method:string)=>providerJson(`${dashboardUrl}${method}`,{method:'POST',body:'{}',
      headers:{Authorization:`Bearer ${current.access_token}`,'Content-Type':'application/json','Connect-Protocol-Version':'1','x-cursor-client-type':'cli'}},deps);
    const [raw,info]=await Promise.all([request('GetCurrentPeriodUsage'),request('GetPlanInfo')]);
    return normalizeUsage(raw,accountId,new Date((deps.now??Date.now)()),info);
  },
  credentialFiles(current,platform:Platform){
    // The Linux CLI reads XDG_CONFIG_HOME/cursor/auth.json; on macOS the store is the OS user's ~/.cursor/auth.json.
    const content=JSON.stringify({accessToken:current.access_token});
    return[{path:platform==='darwin'?'~/.cursor/auth.json':'config/cursor/auth.json',content}];
  },
};
