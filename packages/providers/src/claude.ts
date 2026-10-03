import {z} from 'zod';
import {ingestSnapshot} from '@llm-usage/core';
import {grant,type Grant,type Observer,type PendingEnrollment,type Deps,type Platform} from './types';
import {pkce,providerJson,tokenJson} from './http';

/** The public OAuth client and endpoints used by the Claude Code CLI itself. */
export const clientId='9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const authorizeUrl='https://claude.ai/oauth/authorize';
export const tokenUrl='https://console.anthropic.com/v1/oauth/token';
export const redirectUri='https://console.anthropic.com/oauth/code/callback';
export const usageUrl='https://api.anthropic.com/api/oauth/usage';
const scopes='org:create_api_key user:profile user:inference';

const bucket=z.object({utilization:z.number().finite().nonnegative(),resets_at:z.iso.datetime({offset:true}).nullable()});
export function normalizeUsage(raw:unknown,accountId:string,now=new Date()){
  const data=z.record(z.string(),z.unknown()).parse(raw);
  const observed=now.toISOString();
  const definitions=[['five_hour','session','all_models',18000],['seven_day','weekly','all_models',604800],
    ['seven_day_opus','weekly','opus',604800],['seven_day_sonnet','weekly','sonnet',604800],
    ['seven_day_oauth_apps','weekly','oauth_apps',604800],['seven_day_cowork','weekly','cowork',604800]] as const;
  const limits=definitions.flatMap(([id,kind,scope,window_seconds])=>{
    if(data[id]==null)return[];
    const b=bucket.parse(data[id]);const used=Math.min(1,b.utilization/100);
    return[{id,account_id:accountId,kind,scope,unit:'fraction',window_seconds,used_fraction:used,remaining_fraction:1-used,
      observed_at:observed,reset_at:b.resets_at===null?null:new Date(b.resets_at).toISOString(),source:'official_api',confidence:'provider_reported'}];
  });
  if(!limits.some(b=>b.scope==='all_models'))throw new Error('usage_schema_unrecognized');
  // Display monthly extra-usage budget separately; it is not purchased-token inventory.
  const extra=z.object({is_enabled:z.boolean(),monthly_limit:z.number().finite().nonnegative().nullable().optional(),used_credits:z.number().finite().nonnegative().nullable().optional()}).safeParse(data.extra_usage);
  const paid=extra.success?[{id:'extra_usage',label:'Extra usage budget',kind:'spending_limit',unit:'usd_cents',
    enabled:extra.data.is_enabled,limit:extra.data.monthly_limit??null,used:extra.data.used_credits??null,
    remaining:extra.data.monthly_limit!=null&&extra.data.used_credits!=null?Math.max(0,extra.data.monthly_limit-extra.data.used_credits):null,
    observed_at:observed,reset_at:null}]:[];
  // No calendar reset is invented; extra usage never expands included capacity.
  return{allowed:null,snapshot:ingestSnapshot.parse({account_id:accountId,provider:'anthropic',observed_at:observed,
    status:data.five_hour!=null&&data.seven_day!=null?'ok':'partial',limits,metadata:{adapter_version:'claude-oauth-v3',paid_usage:paid,...(data.extra_usage!=null&&!extra.success?{paid_usage_diagnostic:'paid_usage_schema_unrecognized'}:{})}})};
}

const tokenResponse=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().finite().positive().optional(),
  scope:z.string().optional(),account:z.object({email_address:z.string().optional()}).loose().optional()}).loose();
function toGrant(data:z.infer<typeof tokenResponse>,previous:Grant|null,now:number):Grant{
  return grant.parse({access_token:data.access_token,refresh_token:data.refresh_token??previous?.refresh_token??null,
    expires_at:data.expires_in?now+data.expires_in*1000:previous?.expires_at??null,
    claims:{...(previous?.claims??{}),...(data.scope?{scopes:data.scope}:{})},extra_tokens:{}});
}

export const claude:Observer={
  provider:'anthropic',label:'Claude',
  begin(deps={}){
    const {verifier,challenge,state}=pkce(deps);
    const url=new URL(authorizeUrl);
    for(const [key,value] of Object.entries({code:'true',client_id:clientId,response_type:'code',redirect_uri:redirectUri,scope:scopes,code_challenge:challenge,code_challenge_method:'S256',state}))url.searchParams.set(key,value);
    return{authorization_url:url.toString(),pending:{verifier,state,redirect_uri:redirectUri},
      instructions:'Sign in to Claude, approve access, then paste the code Claude shows you.',input_label:'Authorization code'};
  },
  async complete(pending:PendingEnrollment,input:string,deps={}){
    // Claude shows "code#state"; accept either form and require the state to match ours.
    const trimmed=input.trim();if(!trimmed||trimmed.length>4096||/\s/.test(trimmed))throw new Error('enrollment_input_invalid');
    const [code,state]=trimmed.split('#');
    if(state!==undefined&&state!==pending.state)throw new Error('enrollment_state_mismatch');
    const data=tokenResponse.parse(await tokenJson(tokenUrl,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({grant_type:'authorization_code',code,state:pending.state,client_id:clientId,redirect_uri:pending.redirect_uri??redirectUri,code_verifier:pending.verifier})},deps));
    return toGrant(data,null,(deps.now??Date.now)());
  },
  async refresh(current,deps={}){
    if(!current.refresh_token)throw new Error('usage_auth_required');
    const data=tokenResponse.parse(await tokenJson(tokenUrl,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:clientId})},deps));
    return toGrant(data,current,(deps.now??Date.now)());
  },
  async readUsage(current,accountId,deps={}){
    const raw=await providerJson(usageUrl,{headers:{Authorization:`Bearer ${current.access_token}`,'anthropic-beta':'oauth-2025-04-20'}},deps);
    return normalizeUsage(raw,accountId,new Date((deps.now??Date.now)()));
  },
  credentialFiles(current,_platform:Platform){
    // The CLI reads this store directly; without a refresh token it cannot rotate the service's grant.
    const scopes=(current.claims.scopes??'user:inference user:profile').split(' ').filter(Boolean);
    return[{path:'.credentials.json',content:JSON.stringify({claudeAiOauth:{accessToken:current.access_token,expiresAt:current.expires_at??undefined,scopes,subscriptionType:current.claims.subscription_type??undefined}})}];
  },
};
